'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { ADMIN_UID, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MAX_DAILY_IMPACT, MAX_PRICE_CHANGE_PERCENT, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS, ACTIVE_USER_WINDOW_MS, ACTIVE_USER_WINDOW_DAYS, CREWS, CREW_UNDERDOG_MULT_MAX, CREW_HEAD_DYNASTY_WEEKS } = require('../constants');
const { writeNotification, writeFeedEntry, sendDiscordMessage, calculateMarginalImpact, pruneAndSumTradeHistory, getLastActiveMs, sumMarketActivity, priceHistoryRef, getWeekId, reportError, isRosterTicker } = require('../helpers');
const { syncCrewHeadRoles, preflightCrewRoles } = require('./discordRoles');


// Every system worth knowing the reach of, and the tag its callables pass to
// touchLastActive. Add a feature here and stamp it at the callable; nothing else
// needs to change. `trading` is special-cased — trades are already counted from
// the trades collection, so executeTrade needs no stamp.
const TRACKED_FEATURES = [
  'ladder', 'predictions', 'eventMarket', 'missions', 'crew', 'crewMissions',
  'margin', 'limitOrders', 'preMarket', 'ipo', 'cosmetics', 'pins',
  'dailyCheckin', 'portfolio',
];

// Distinct non-bot users per system over the window, written to admin/featureUsage
// for the admin Stats tab. Best-effort: a failure here must never take down the
// weekly report, which is the actual job.
async function writeFeatureUsage({ users, tradesByUid, since, now }) {
  try {
    const humans = users.filter(u => !u.isBot);
    const counts = { trading: Object.keys(tradesByUid || {}).length };
    for (const feature of TRACKED_FEATURES) {
      counts[feature] = humans.filter(u => (u.lastUsed?.[feature] || 0) >= since).length;
    }
    await db.collection('admin').doc('featureUsage').set({
      counts,
      totalUsers: humans.length,
      windowDays: 7,
      generatedAt: now,
    });
  } catch (err) {
    console.error('Failed to write feature usage report:', err);
  }
}

// Builds and posts the weekly market report. Read-only apart from the Discord
// post, so it is safe to re-run by hand (see triggerWeeklyMarketSummary).
async function runWeeklyMarketSummary() {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) return { posted: false, error: 'No market data.' };

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const histSnap = await priceHistoryRef().get();
      const priceHistory = histSnap.exists ? (histSnap.data() || {}) : {};

      // Get all users
      const usersSnap = await db.collection('users').get();
      const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate weekly stats
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

      // Weekly price changes
      const weeklyChanges = [];
      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        if (!isRosterTicker(ticker)) return;
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        let priceWeekAgo = history[0].price;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= weekAgo) {
            priceWeekAgo = history[i].price;
            break;
          }
        }

        const change = priceWeekAgo > 0 ? ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100 : 0;
        weeklyChanges.push({ ticker, price: currentPrice, change, priceWeekAgo });
      });

      weeklyChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      const topGainer = weeklyChanges.find(s => s.change > 0);
      const topLoser = weeklyChanges.find(s => s.change < 0);

      // Weekly volume
      const { trades: weeklyTrades, volume: weeklyVolume, tradesByUid } =
        await sumMarketActivity({ sinceMs: weekAgo, users });

      // Active users — opened the app, traded, checked in, or took any other
      // action within the window
      const activeCutoff = now - ACTIVE_USER_WINDOW_MS;
      const activeUsers = users.filter(u => !u.isBot && getLastActiveMs(u) >= activeCutoff).length;

      // How many distinct people touched each system this week. Rides entirely
      // on data already in hand: the `users` array above and the tradesByUid map
      // sumMarketActivity already built, so the report costs no extra reads.
      // Per-feature stamps come from touchLastActive(uid, feature).
      await writeFeatureUsage({ users, tradesByUid, since: weekAgo, now });

      // Top portfolios — bots are excluded from all user-facing rankings
      const topPortfolios = users
        .filter(u => !u.isBot && u.portfolioValue > 0)
        .sort((a, b) => b.portfolioValue - a.portfolioValue)
        .slice(0, 5);

      // Build comprehensive embed
      const embed = {
        title: '📈 Weekly Market Report',
        description: `Week ending ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        color: 0x4ECDC4,
        fields: [
          {
            name: '📊 Weekly Activity',
            value: `${weeklyTrades} trades\n$${weeklyVolume.toLocaleString(undefined, {maximumFractionDigits: 0})} total volume\n${activeUsers} active users (last ${ACTIVE_USER_WINDOW_DAYS} days)`,
            inline: false
          },
          {
            name: '🚀 Biggest Mover (Up)',
            value: topGainer ? `**${topGainer.ticker}**\n$${topGainer.priceWeekAgo.toFixed(2)} → $${topGainer.price.toFixed(2)}\n+${topGainer.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '📉 Biggest Mover (Down)',
            value: topLoser ? `**${topLoser.ticker}**\n$${topLoser.priceWeekAgo.toFixed(2)} → $${topLoser.price.toFixed(2)}\n${topLoser.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '🏆 Top 5 Portfolios',
            value: topPortfolios.map((u, i) =>
              `${i + 1}. ${u.displayName || 'Anonymous'} - $${u.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`
            ).join('\n') || 'None',
            inline: false
          }
        ],
        footer: {
          text: 'Next report: Monday 00:00 UTC'
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      return { posted: true, activeUsers, weeklyTrades };
    } catch (error) {
      console.error('Error in weeklyMarketSummary:', error);
      return { posted: false, error: error.message };
    }
}

exports.weeklyMarketSummary = cf().pubsub
  .schedule('0 0 * * 1')
  .timeZone('UTC')
  .onRun(async () => {
    await runWeeklyMarketSummary();
    return null;
  });

/**
 * Admin-only manual re-run of the weekly market report. Posts the same embed to
 * Discord immediately. Nothing else is written, so extra runs are harmless.
 */
exports.triggerWeeklyMarketSummary = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  return runWeeklyMarketSummary();
});

/**
 * Weekly Leaderboard - Runs Mondays at 01:00 UTC
 */
exports.weeklyLeaderboard = cf().pubsub
  .schedule('0 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // Calculate portfolio values and sort
      const activeCutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
      let activeCount = 0;
      const traders = [];
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if (!user.isBot && getLastActiveMs(user) >= activeCutoff) activeCount++;
        // Bots are excluded from all user-facing rankings
        if (!user.isBankrupt && !user.isBot) {
          traders.push({
            username: user.displayName,
            portfolioValue: user.portfolioValue || user.cash || 0
          });
        }
      });

      traders.sort((a, b) => b.portfolioValue - a.portfolioValue);
      const top5 = traders.slice(0, 5);

      const leaderboardText = top5.map((trader, idx) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][idx];
        return `${medal} **${trader.username}** - $${trader.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
      }).join('\n');

      const embed = {
        color: 0xFFD700, // Gold
        title: '🏆 Weekly Leaderboard',
        description: leaderboardText,
        footer: {
          text: `Total Active Users (last ${ACTIVE_USER_WINDOW_DAYS} days): ${activeCount}`
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      console.log('Weekly leaderboard sent');
      return null;
    } catch (error) {
      console.error('Error in weekly leaderboard:', error);
      return null;
    }
  });

/**
 * Weekly Crew Rankings - Runs Mondays at 01:30 UTC
 *
 * Two jobs:
 * 1. Compute each crew's active-player count for the week that just ended and
 *    derive the underdog reward multiplier for the new week. Written to the
 *    public market/crewStats doc, which every mission claim path reads.
 * 2. Post the Discord rankings, ranked by average weekly gain per ACTIVE
 *    member so small crews compete on equal footing with big ones.
 *
 * "Active" = made a trade, claimed any mission, or checked in during the week.
 * Counting claims and check-ins (not just trades) stops a crew from farming a
 * high multiplier by holding positions and claiming composition missions
 * without ever showing up in trade counts.
 */
async function runWeeklyCrewRankings({ postToDiscord = true } = {}) {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // The week that just ended (this runs Monday 01:30 UTC, so 48h back
      // lands safely inside last week).
      const prevWeekId = getWeekId(new Date(Date.now() - 2 * TWENTY_FOUR_HOURS_MS));
      const prevWeekDates = [...Array(7)].map((_, i) => {
        const d = new Date(`${prevWeekId}T00:00:00Z`); // prevWeekId is that Monday
        d.setUTCDate(d.getUTCDate() + i);
        return d.toISOString().split('T')[0];
      });

      const wasActiveLastWeek = (user) => {
        const wm = user.weeklyMissions?.[prevWeekId];
        if (wm) {
          if ((wm.tradeCount || 0) > 0) return true;
          if (wm.claimed && Object.keys(wm.claimed).length > 0) return true;
          if (wm.checkinDays && Object.keys(wm.checkinDays).length > 0) return true;
        }
        return prevWeekDates.some((date) => {
          const dm = user.dailyMissions?.[date];
          return dm && dm.claimed && Object.keys(dm.claimed).length > 0;
        });
      };

      const crews = {};
      Object.values(CREWS).forEach((c) => {
        crews[c.id] = {
          id: c.id, name: c.name, emblem: c.emblem,
          members: [], activeCount: 0, totalValue: 0, weeklyGain: 0, activeGain: 0,
        };
      });

      // Users flagged as crew head who no longer belong to a (valid) crew —
      // their crown is stale and gets cleared in the rotation below.
      const staleHeads = [];

      usersSnapshot.forEach(doc => {
        const user = doc.data();
        const crew = user.crew;

        // Bots are excluded from all user-facing rankings
        if (!user.isBot && crew && crews[crew]) {
          const portfolioValue = user.portfolioValue || user.cash || 0;
          // Weekly gain from the rolling 7-day reference snapshot
          // (portfolio history lives in a subcollection now, not on the doc)
          const snap7d = user.portfolioSnapshot7d;
          const baseline = (snap7d && snap7d.value > 0) ? snap7d.value : 0;
          const gain = baseline > 0 ? portfolioValue - baseline : 0;
          const active = wasActiveLastWeek(user);

          const c = crews[crew];
          c.members.push({
            uid: doc.id,
            username: user.displayName,
            portfolioValue, gain, active,
            // Only ever used to hand out the crew head Discord role. MUST NOT
            // reach market/crewStats — that doc is world-readable.
            discordId: user.discordId || null,
            isBankrupt: !!user.isBankrupt,
            wasHead: !!user.isCrewHead,
            headStreak: user.crewHeadStreak || 0,
            achievements: Array.isArray(user.achievements) ? user.achievements : [],
          });
          c.totalValue += portfolioValue;
          c.weeklyGain += gain;
          if (active) {
            c.activeCount += 1;
            c.activeGain += gain;
          }
        } else if (user.isCrewHead && !user.isBot) {
          staleHeads.push(doc.id);
        }
      });

      // Underdog multipliers for the new week: the most active crew gets 1x,
      // an empty crew gets CREW_UNDERDOG_MULT_MAX, everyone else in between.
      const maxActive = Math.max(1, ...Object.values(crews).map((c) => c.activeCount));
      const multipliers = {};
      const activeCounts = {};
      const memberCounts = {};
      Object.values(crews).forEach((c) => {
        activeCounts[c.id] = c.activeCount;
        memberCounts[c.id] = c.members.length;
        const raw = 1 + ((maxActive - c.activeCount) / maxActive) * (CREW_UNDERDOG_MULT_MAX - 1);
        multipliers[c.id] = Math.round(Math.min(CREW_UNDERDOG_MULT_MAX, Math.max(1, raw)) * 100) / 100;
      });

      // ── Crew head rotation ("top dog") ─────────────────────────────────
      // The crown goes to the crew member with the biggest PORTFOLIO among
      // last week's active members. Staying active is still required, so a
      // dormant account can't sit on the crown forever. No eligible member =
      // vacant crown that week.
      const heads = {};          // crewId -> { uid, displayName, portfolioValue }
      // Kept SEPARATE from `heads` on purpose: `heads` is written verbatim to
      // market/crewStats, which anyone can read. Discord IDs stay private.
      const headDiscordIds = {}; // crewId -> discordId | null
      const userUpdates = [];    // [{ uid, update, note }]
      Object.values(crews).forEach((c) => {
        const prevHead = c.members.find((m) => m.wasHead) || null;
        const eligible = c.members.filter((m) => m.active && !m.isBankrupt);
        const winner = eligible.length > 0
          ? eligible.reduce((best, m) => (m.portfolioValue > best.portfolioValue ? m : best))
          : null;

        if (winner) {
          const kept = prevHead && prevHead.uid === winner.uid;
          const newStreak = kept ? prevHead.headStreak + 1 : 1;
          heads[c.id] = { uid: winner.uid, displayName: winner.username || 'Anonymous', portfolioValue: Math.round(winner.portfolioValue * 100) / 100 };
          headDiscordIds[c.id] = winner.discordId || null;

          const newAch = [];
          if (!winner.achievements.includes('CROWNED')) newAch.push('CROWNED');
          if (newStreak >= CREW_HEAD_DYNASTY_WEEKS && !winner.achievements.includes('DYNASTY')) newAch.push('DYNASTY');
          if (!kept && prevHead && prevHead.headStreak >= CREW_HEAD_DYNASTY_WEEKS && !winner.achievements.includes('USURPER')) newAch.push('USURPER');

          const update = { isCrewHead: true, crewHeadStreak: newStreak };
          if (newAch.length > 0) update.achievements = FieldValue.arrayUnion(...newAch);
          userUpdates.push({
            uid: winner.uid,
            update,
            note: {
              type: 'system',
              title: `🔱 Crew Head of ${c.name}`,
              message: kept
                ? `You kept the crown. ${newStreak} weeks running.`
                : `Biggest portfolio in your crew. The crown is yours.`,
            },
          });

          if (prevHead && !kept) {
            userUpdates.push({
              uid: prevHead.uid,
              update: { isCrewHead: false, crewHeadStreak: 0 },
              note: {
                type: 'system',
                title: 'Crown lost',
                message: `${winner.username || 'A crewmate'} now has the biggest portfolio in ${c.name}.`,
              },
            });
          }
        } else if (prevHead) {
          // Vacant week: nobody qualified, the old crown comes off quietly.
          userUpdates.push({ uid: prevHead.uid, update: { isCrewHead: false, crewHeadStreak: 0 }, note: null });
        }
      });
      staleHeads.forEach((uid) => {
        userUpdates.push({ uid, update: { isCrewHead: false, crewHeadStreak: 0 }, note: null });
      });

      // Write the stats doc BEFORE the Discord send so a webhook failure
      // can't leave the week without multipliers.
      await db.collection('market').doc('crewStats').set({
        weekId: getWeekId(),        // the week these multipliers apply to
        basedOnWeekId: prevWeekId,  // the activity week they were computed from
        computedAt: Date.now(),
        activeCounts,
        memberCounts,
        multipliers,
        heads,
      });

      // Apply crown updates. Isolated so one bad user doc can't take down
      // the multipliers (already written) or the Discord post.
      for (const { uid, update, note } of userUpdates) {
        try {
          await db.collection('users').doc(uid).update(update);
          if (note) await writeNotification(uid, note);
        } catch (err) {
          console.error(`Crew head update failed for ${uid}:`, err.message);
        }
      }

      // Rank by average weekly gain per active member; crews with no active
      // members sink to the bottom.
      const sortedCrews = Object.values(crews)
        .filter((c) => c.members.length > 0)
        .map((c) => ({ ...c, avgActiveGain: c.activeCount > 0 ? c.activeGain / c.activeCount : null }))
        .sort((a, b) => {
          if (a.avgActiveGain === null && b.avgActiveGain === null) return b.totalValue - a.totalValue;
          if (a.avgActiveGain === null) return 1;
          if (b.avgActiveGain === null) return -1;
          return b.avgActiveGain - a.avgActiveGain;
        });

      const fmtMoney = (n) => `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

      const fields = sortedCrews.map((crew, idx) => {
        const topGainers = crew.members
          .filter((m) => m.active)
          .sort((a, b) => b.gain - a.gain)
          .slice(0, 3);
        const gainersText = topGainers.length > 0
          ? topGainers.map((m, i) => `${i + 1}. ${m.username} ${fmtMoney(m.gain)}`).join('\n')
          : 'No active members this week';

        const avgText = crew.avgActiveGain === null ? 'n/a' : fmtMoney(crew.avgActiveGain);
        const mult = multipliers[crew.id];
        const head = heads[crew.id];
        const headText = head
          ? `🔱 ${head.displayName} ($${head.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })})`
          : 'Vacant';

        return {
          name: `${idx + 1}. ${crew.emblem} ${crew.name}`,
          value: `**Crew Head:** ${headText}\n` +
                 `**Active Members:** ${crew.activeCount} of ${crew.members.length}\n` +
                 `**Avg Gain per Active Member:** ${avgText}\n` +
                 `**Crew Weekly Gain:** ${fmtMoney(crew.weeklyGain)}\n` +
                 `**Total Value:** $${crew.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n` +
                 `**Reward Bonus This Week:** x${mult}${mult > 1 ? ' 🔥' : ''}\n\n` +
                 `**Top Gainers:**\n${gainersText}`,
          inline: false
        };
      });

      const embed = {
        color: 0x5865F2, // Discord blurple
        title: '⚔️ Weekly Crew Rankings',
        description: '*Crews ranked by average weekly gain per active member. Less active crews get a mission reward bonus this week. Join one and cash in. The biggest active portfolio in each crew takes the crown.*',
        fields: fields,
        footer: {
          text: 'Reward bonus applies to daily, weekly, and crew mission payouts. It recalculates every Monday from crew activity.'
        },
        timestamp: new Date().toISOString()
      };

      if (postToDiscord) {
        await sendDiscordMessage(null, [embed]);
        console.log('Weekly crew rankings sent');
      }

      // Crew head Discord roles. Deliberately LAST: multipliers, crowns,
      // achievements, notifications and the announcement are all committed
      // before a single Discord role call is made, so a Discord outage can
      // never cost a player a payout. The sync also diffs against its own
      // stored state, not against this run, so a skipped or failed week
      // simply self-heals on the next one.
      let roleSync = null;
      if (postToDiscord) {
        try {
          roleSync = await syncCrewHeadRoles({ heads, discordIds: headDiscordIds, weekId: getWeekId() });
        } catch (err) {
          reportError(err, { where: 'runWeeklyCrewRankings.syncCrewHeadRoles' });
        }
      }
      return { multipliers, activeCounts, memberCounts, roleSync };
}

// 5 min rather than the 60s default: this scans every user doc and then makes
// up to 18 Discord round-trips. Billed on actual runtime, so the headroom is
// free unless something is genuinely slow.
exports.weeklyCrewRankings = cf({ timeoutSeconds: 300 }).pubsub
  .schedule('30 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      await runWeeklyCrewRankings();
    } catch (error) {
      console.error('Error in weekly crew rankings:', error);
    }
    return null;
  });

/**
 * Re-hand the crew head Discord roles from the CURRENT market/crewStats,
 * without recomputing anything. Used by the admin buttons so setup can be
 * checked and fixed without waiting for Monday.
 */
async function runCrewRoleSyncOnly({ dryRun = false } = {}) {
  if (dryRun) return preflightCrewRoles();

  const statsSnap = await db.collection('market').doc('crewStats').get();
  const stats = statsSnap.exists ? (statsSnap.data() || {}) : {};
  const heads = stats.heads || {};

  // At most 9 docs, so a single getAll beats nine reads.
  const entries = Object.entries(heads).filter(([, h]) => h && h.uid);
  const discordIds = {};
  if (entries.length > 0) {
    const docs = await db.getAll(...entries.map(([, h]) => db.collection('users').doc(h.uid)));
    entries.forEach(([crewId], i) => {
      discordIds[crewId] = docs[i].exists ? (docs[i].data().discordId || null) : null;
    });
  }
  return syncCrewHeadRoles({ heads, discordIds, weekId: stats.weekId || getWeekId() });
}

/**
 * Admin-only manual re-run. Seeds/refreshes market/crewStats (underdog
 * multipliers) and optionally re-posts the Discord rankings. Useful right
 * after a deploy or if the Monday run failed.
 * Pass { skipDiscord: true } to only recompute the stats doc.
 * Pass { rolesOnly: true } to only re-sync the crew head Discord roles, or
 * { rolesOnly: true, dryRun: true } to just check the Discord setup.
 */
exports.triggerWeeklyCrewRankings = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  if (data && data.rolesOnly) return runCrewRoleSyncOnly({ dryRun: !!data.dryRun });
  return runWeeklyCrewRankings({ postToDiscord: !(data && data.skipDiscord) });
});

// Exposed for scripts/test-crew-roles-emulator.cjs. Not a Cloud Function —
// serviceLoader only copies exports carrying a trigger, so this never reaches
// the deployed surface (same pattern as runLimitOrderCheck in limitOrders.js).
exports.runWeeklyCrewRankings = runWeeklyCrewRankings;


/**
 * Create bot traders - Admin only
 */
