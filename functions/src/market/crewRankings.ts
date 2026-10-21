// The weekly crew rankings: active-member counts, underdog multipliers, crew
// head rotation (and its Discord role), and the Discord post. Split out of
// marketWeekly.ts. INTERNAL MODULE: exports no Cloud Functions.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { TWENTY_FOUR_HOURS_MS, CREWS, CREW_UNDERDOG_MULT_MAX, CREW_HEAD_DYNASTY_WEEKS } from '../shared/constants';
import { writeNotification } from '../shared/notifications';
import { sendDiscordMessage, crewEmoji, pxe } from '../shared/discordApi';
import { getWeekId } from '../shared/tradeRecords';
import { missionWeekStartMs, weeklyMissionsOpen } from '../shared/rules/missions';
import { netWorthOf, tradingNetWorthOf, snapshotNetWorth, netEquityAt } from '../shared/equity';
import { reportError } from '../shared/sentry';
import { syncCrewHeadRoles, preflightCrewRoles } from '../discord/discordRoles';
import { settleRivalryWeek, pairRivalryWeek, type RivalryResult } from '../crews/rivalries';
import { buildWeeklyRecap } from './weeklyRecap';
import { rivalryQualified, type WeeklyProgress } from '../shared/rules/missionProgress';
import type { DocumentData } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

/** One player's line in a crew's weekly ranking. */
export interface CrewMember {
  uid: string;
  username: string;
  portfolioValue: number;
  gain: number;
  active: boolean;
  discordId: string | null;
  isBankrupt: boolean;
  wasHead: boolean;
  headStreak: number;
  /** Longest reign ever, in weeks: the trophy-case record. */
  bestReign: number;
  achievements: string[];
}

export interface CrewTally {
  id: string;
  name: string;
  emblem: string;
  members: CrewMember[];
  activeCount: number;
  totalValue: number;
  weeklyGain: number;
  activeGain: number;
}
/**
 * Weekly Crew Rankings - Runs at the Thursday reopen (21:05 UTC), when the
 * mission week turns over (rules/missions). The jobs, in order:
 * 0. Record the week-open prices (Bargain Hunter) and settle last week's Crew
 *    Rivalries, paid at last week's multipliers.
 * 1. Compute each crew's active-player count for the week that just ended and
 *    derive the underdog reward multiplier for the new week. Written to the
 *    public market/crewStats doc, which every mission claim path reads.
 * 2. Pair the new week's rivalries.
 * 3. Post the Discord rankings, ranked by average weekly gain per ACTIVE
 *    member so small crews compete on equal footing with big ones.
 *
 * "Active" = made a trade, claimed any mission, or checked in during the week.
 * Counting claims and check-ins (not just trades) stops a crew from farming a
 * high multiplier by holding positions and claiming composition missions
 * without ever showing up in trade counts.
 */
export async function runWeeklyCrewRankings({ postToDiscord = true } = {}) {
  const usersSnapshot = await db.collection('users').get();

  if (usersSnapshot.empty) {
    logger.info('No users found');
    return null;
  }

  // The last full week, whenever this runs (the admin can re-run it mid-week).
  // A week starts Thursday 21:00, so it touches 8 UTC dates.
  const prevWeekId = getWeekId(missionWeekStartMs() - 1);
  const prevWeekDates = [...Array(8)].map((_, i) => {
    const d = new Date(`${prevWeekId}T00:00:00Z`); // prevWeekId is that Thursday
    d.setUTCDate(d.getUTCDate() + i);
    return d.toISOString().split('T')[0]!;
  });
  // Weeks were keyed by their Monday until 2026-10-22, so the first run after
  // the switch finds last week's activity under Monday keys inside the window.
  // Later, only prevWeekId itself falls in it.
  const prevDayMs = Date.parse(`${prevWeekId}T00:00:00Z`);
  const prevWeekKeys = (wms: Record<string, unknown> | undefined) =>
    Object.keys(wms || {}).filter((k) => {
      const ms = Date.parse(`${k}T00:00:00Z`);
      return ms >= prevDayMs - 3 * TWENTY_FOUR_HOURS_MS && ms < prevDayMs + 7 * TWENTY_FOUR_HOURS_MS;
    });

  const wasActiveLastWeek = (user: DocumentData) => {
    for (const key of prevWeekKeys(user.weeklyMissions)) {
      const wm = user.weeklyMissions[key];
      if ((wm.tradeCount || 0) > 0) return true;
      if (wm.claimed && Object.keys(wm.claimed).length > 0) return true;
      if (wm.checkinDays && Object.keys(wm.checkinDays).length > 0) return true;
    }
    return prevWeekDates.some((date) => {
      const dm = user.dailyMissions?.[date];
      return dm && dm.claimed && Object.keys(dm.claimed).length > 0;
    });
  };

  const crews: Record<string, CrewTally> = {};
  Object.values(CREWS).forEach((c) => {
    crews[c.id] = {
      id: c.id,
      name: c.name,
      emblem: c.emblem,
      members: [],
      activeCount: 0,
      totalValue: 0,
      weeklyGain: 0,
      activeGain: 0,
    };
  });

  // Users flagged as crew head who no longer belong to a (valid) crew —
  // their crown is stale and gets cleared in the rotation below.
  const staleHeads: string[] = [];

  usersSnapshot.forEach((doc) => {
    const user = doc.data()!;
    const crew = user.crew;

    // Bots and banned accounts are excluded from all user-facing rankings
    if (!user.isBot && !user.isBanned && crew && crews[crew]) {
      // Net worth (margin debt taken off), like every leaderboard since
      // 2026-10-14: the crown and the crew totals went to whoever borrowed most.
      const marginUsed = user.marginUsed || 0;
      const portfolioValue = user.portfolioValue != null ? netWorthOf(user) : user.cash || 0;
      // Weekly gain from the rolling 7-day reference snapshot
      // (portfolio history lives in a subcollection now, not on the doc),
      // net of the debt at both ends so a margin buy isn't a gain.
      const snap7d = user.portfolioSnapshot7d;
      const baseline = snap7d && snap7d.value > 0 ? snapshotNetWorth(snap7d, marginUsed) : 0;
      // Long-term positions stay out of the gain: prediction money is a flow.
      const gain = snap7d && snap7d.value > 0 ? tradingNetWorthOf(user) - baseline : 0;
      const active = wasActiveLastWeek(user);

      const c = crews[crew]!;
      c.members.push({
        uid: doc.id,
        username: user.displayName,
        portfolioValue,
        gain,
        active,
        // Only ever used to hand out the crew head Discord role. MUST NOT
        // reach market/crewStats — that doc is world-readable.
        discordId: user.discordId || null,
        isBankrupt: !!user.isBankrupt,
        wasHead: !!user.isCrewHead,
        headStreak: user.crewHeadStreak || 0,
        bestReign: Number(user.crewHeadBest?.weeks) || 0,
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

  // Week-open prices, which Bargain Hunter measures "down this week" from.
  // Runs after the opening auction has filled, so the week opens where trading did.
  // Only the first run of a week: a mid-week re-run must not move the mark.
  // The first run of a week also sends everyone their "Your week" recap, priced
  // from last week's open to now.
  let recapPrices: { open: Record<string, number>; now: Record<string, number> } | null = null;
  try {
    const market = await db.collection('market').doc('current').get();
    if (market.exists && market.data()?.weekOpenId !== getWeekId()) {
      recapPrices = { open: market.data()?.weekOpenPrices || {}, now: market.data()?.prices || {} };
      await market.ref.update({ weekOpenPrices: market.data()?.prices || {}, weekOpenId: getWeekId() });
    }
  } catch (err) {
    reportError(err, { where: 'runWeeklyCrewRankings.weekOpenPrices' });
  }

  // Last week's rivalries, paid at last week's multipliers (still in crewStats
  // until the write below). Isolated: a failure must not cost the crowns.
  let rivalry: { results: Record<string, RivalryResult>; winners: string[] } | null = null;
  try {
    const oldStats = (await db.collection('market').doc('crewStats').get()).data();
    const users = usersSnapshot.docs.map((d) => ({ id: d.id, data: d.data() }));
    rivalry = await settleRivalryWeek(prevWeekId, users, oldStats);
  } catch (err) {
    reportError(err, { where: 'runWeeklyCrewRankings.settleRivalryWeek', prevWeekId });
  }

  // Underdog multipliers for the new week: the most active crew gets 1x,
  // an empty crew gets CREW_UNDERDOG_MULT_MAX, everyone else in between.
  const maxActive = Math.max(1, ...Object.values(crews).map((c) => c.activeCount));
  const multipliers: Record<string, number> = {};
  const activeCounts: Record<string, number> = {};
  const memberCounts: Record<string, number> = {};
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
  // weeks = how many weeks running they've held it (the crew page's reign).
  const heads: Record<string, { uid: string; displayName?: string | null; portfolioValue: number; weeks: number }> = {};
  // Kept SEPARATE from `heads` on purpose: `heads` is written verbatim to
  // market/crewStats, which anyone can read. Discord IDs stay private.
  const headDiscordIds: Record<string, string | null> = {}; // crewId -> discordId | null
  const userUpdates: {
    uid: string;
    update: Record<string, unknown>;
    note: Parameters<typeof writeNotification>[1] | null;
  }[] = []; // [{ uid, update, note }]
  Object.values(crews).forEach((c) => {
    const prevHead = c.members.find((m) => m.wasHead) || null;
    const eligible = c.members.filter((m) => m.active && !m.isBankrupt);
    const winner =
      eligible.length > 0
        ? eligible.reduce((best: CrewMember, m) => (m.portfolioValue > best.portfolioValue ? m : best))
        : null;

    if (winner) {
      const kept = prevHead && prevHead.uid === winner.uid;
      const newStreak = kept ? prevHead.headStreak + 1 : 1;
      heads[c.id] = {
        uid: winner.uid,
        displayName: winner.username || 'Anonymous',
        portfolioValue: Math.round(winner.portfolioValue * 100) / 100,
        weeks: newStreak,
      };
      headDiscordIds[c.id] = winner.discordId || null;

      const newAch = [];
      if (!winner.achievements.includes('CROWNED')) newAch.push('CROWNED');
      if (newStreak >= CREW_HEAD_DYNASTY_WEEKS && !winner.achievements.includes('DYNASTY')) newAch.push('DYNASTY');
      if (
        !kept &&
        prevHead &&
        prevHead.headStreak >= CREW_HEAD_DYNASTY_WEEKS &&
        !winner.achievements.includes('USURPER')
      )
        newAch.push('USURPER');

      const update: Record<string, unknown> = { isCrewHead: true, crewHeadStreak: newStreak };
      // The record outlives the crown, so the trophy case can show it after it's lost.
      if (newStreak > winner.bestReign) update.crewHeadBest = { weeks: newStreak, crew: c.id };
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

  // This week's rivalries: every crew with members, matched on last week's activity.
  let matches: string[][] = [];
  try {
    const withMembers = Object.values(crews)
      .filter((c) => c.members.length > 0)
      .map((c) => c.id);
    matches = await pairRivalryWeek(getWeekId(), prevWeekId, withMembers, activeCounts);
  } catch (err) {
    reportError(err, { where: 'runWeeklyCrewRankings.pairRivalryWeek' });
  }

  // Write the stats doc BEFORE the Discord send so a webhook failure
  // can't leave the week without multipliers.
  await db
    .collection('market')
    .doc('crewStats')
    .set({
      weekId: getWeekId(), // the week these multipliers apply to
      basedOnWeekId: prevWeekId, // the activity week they were computed from
      computedAt: Date.now(),
      activeCounts,
      memberCounts,
      multipliers,
      heads,
      // Last week's rivalry winners: their crest glows this week.
      rivalryWinners: rivalry?.winners || [],
    });

  // Apply crown updates. Isolated so one bad user doc can't take down
  // the multipliers (already written) or the Discord post.
  for (const { uid, update, note } of userUpdates) {
    try {
      await db.collection('users').doc(uid).update(update);
      if (note) await writeNotification(uid, note);
    } catch (err) {
      logger.error(`Crew head update failed for ${uid}:`, (err as Error).message);
    }
  }

  // No recap for the stub week before the first Thursday week: it was only the
  // hours between the deploy and the reopen.
  if (recapPrices && weeklyMissionsOpen(prevWeekId)) {
    try {
      await sendWeeklyRecaps(
        usersSnapshot.docs,
        prevWeekId,
        rivalry?.results || {},
        recapPrices,
        (id) => crews[id]?.name || id,
      );
    } catch (err) {
      reportError(err, { where: 'runWeeklyCrewRankings.sendWeeklyRecaps', prevWeekId });
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

  const fmtMoney = (n: number) =>
    `${n < 0 ? '-' : '+'}$${Math.abs(n).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  const fields = sortedCrews.map((crew, idx) => {
    const topGainers = crew.members
      .filter((m) => m.active)
      .sort((a, b) => b.gain - a.gain)
      .slice(0, 3);
    const gainersText =
      topGainers.length > 0
        ? topGainers.map((m, i) => `${i + 1}. ${m.username} ${fmtMoney(m.gain)}`).join('\n')
        : 'No active members this week';

    const avgText = crew.avgActiveGain === null ? 'n/a' : fmtMoney(crew.avgActiveGain);
    const mult = multipliers[crew.id];
    const head = heads[crew.id];
    const headText = head
      ? `${pxe('crew_head')} ${head.displayName} ($${head.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })})`
      : 'Vacant';

    return {
      name: `${idx + 1}. ${crewEmoji(crew.id)} ${crew.name}`,
      value:
        `**Crew Head:** ${headText}\n` +
        `**Active Members:** ${crew.activeCount} of ${crew.members.length}\n` +
        `**Avg Gain per Active Member:** ${avgText}\n` +
        `**Crew Weekly Gain:** ${fmtMoney(crew.weeklyGain)}\n` +
        `**Total Value:** $${crew.totalValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}\n` +
        `**Reward Bonus This Week:** x${mult}${mult! > 1 ? ` ${pxe('fire')}` : ''}\n\n` +
        `**Top Gainers:**\n${gainersText}`,
      inline: false,
    };
  });

  // Rivalries: last week's results, then this week's matches.
  const crewLabel = (id: string) => `${crewEmoji(id)} ${crews[id]?.name || id}`;
  const settled = rivalry?.results || {};
  const seenMatches = new Set<string>();
  const resultLines: string[] = [];
  for (const [id, r] of Object.entries(settled)) {
    const match = [id, ...r.opponents].sort();
    if (seenMatches.has(match.join('|'))) continue;
    seenMatches.add(match.join('|'));
    resultLines.push(
      match
        .map((c) => {
          const cr = settled[c];
          return `${cr?.won ? `${pxe('trophy')} ` : ''}**${crews[c]?.name || c}** ${Math.round((cr?.score || 0) * 100)}%`;
        })
        .join(' vs '),
    );
  }
  if (resultLines.length > 0) {
    fields.push({ name: 'Rivalry Results', value: resultLines.join('\n').slice(0, 1024), inline: false });
  }
  if (matches.length > 0) {
    fields.push({
      name: "This Week's Rivalries",
      value: matches
        .map((m) => m.map(crewLabel).join(' vs '))
        .join('\n')
        .slice(0, 1024),
      inline: false,
    });
  }

  const embed = {
    color: 0x5865f2, // Discord blurple
    title: `${pxe('swords')} Weekly Crew Rankings`,
    description:
      '*Crews ranked by average weekly gain per active member. Less active crews get a mission reward bonus this week. Join one and cash in. The biggest active portfolio in each crew takes the crown.*',
    fields: fields,
    footer: {
      text: 'Reward bonus applies to missions and rivalry payouts. It recalculates every Thursday reopen from crew activity.',
    },
    timestamp: new Date().toISOString(),
  };

  if (postToDiscord) {
    await sendDiscordMessage(null, [embed]);
    logger.info('Weekly crew rankings sent');
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
/** "Your week" bells for everyone who did anything last week. */
async function sendWeeklyRecaps(
  docs: admin.firestore.QueryDocumentSnapshot[],
  weekId: string,
  results: Record<string, RivalryResult>,
  prices: { open: Record<string, number>; now: Record<string, number> },
  crewName: (id: string) => string,
) {
  let sent = 0;
  for (const d of docs) {
    const u = d.data();
    if (u.isBot || u.isBanned) continue;
    const wp: WeeklyProgress | undefined = u.weeklyMissions?.[weekId];
    const active = !!wp && ((wp.tradeCount || 0) > 0 || Object.keys(wp.claimed || {}).length > 0 || !!wp.checkinDays);
    if (!active) continue;
    const crew: string | null = u.crew || null;
    const lines = buildWeeklyRecap({
      netWorth: netEquityAt(u, prices.now) + Math.max(0, u.eventPositionsValue || 0),
      grantedValue: u.grantedValue || 0,
      holdings: u.holdings,
      wp,
      crew,
      qualified: rivalryQualified(wp, crew),
      rivalry: crew && results[crew] ? results[crew]! : null,
      crewName,
      openPrices: prices.open,
      prices: prices.now,
    });
    if (!lines) continue;
    await writeNotification(d.id, { type: 'system', title: 'Your week', message: lines.join(' ') });
    sent++;
  }
  logger.info(`Weekly recaps ${weekId}: ${sent} sent`);
}

/**
 * Re-hand the crew head Discord roles from the CURRENT market/crewStats,
 * without recomputing anything. Used by the admin buttons so setup can be
 * checked and fixed without waiting for Thursday.
 */
export async function runCrewRoleSyncOnly({ dryRun = false } = {}) {
  if (dryRun) return preflightCrewRoles();

  const statsSnap = await db.collection('market').doc('crewStats').get();
  const stats = statsSnap.exists ? statsSnap.data() || {} : {};
  const heads: Record<string, { uid: string } | null> = stats.heads || {};

  // At most 10 docs (one per crew), so a single getAll beats ten reads.
  const entries = Object.entries(heads).filter(([, h]) => h && h.uid);
  const discordIds: Record<string, string | null> = {};
  if (entries.length > 0) {
    const docs = await db.getAll(...entries.map(([, h]) => db.collection('users').doc(h!.uid)));
    entries.forEach(([crewId], i) => {
      discordIds[crewId] = docs[i]!.exists ? docs[i]!.data()!.discordId || null : null;
    });
  }
  return syncCrewHeadRoles({ heads, discordIds, weekId: stats.weekId || getWeekId() });
}
