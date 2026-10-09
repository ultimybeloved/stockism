import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { ONE_WEEK_MS, ACTIVE_USER_WINDOW_MS, ACTIVE_USER_WINDOW_DAYS } from '../shared/constants';
import { sendDiscordMessage } from '../shared/discordApi';
import { getLastActiveMs, sumMarketActivity, recordHeartbeat } from '../shared/activity';
import { priceHistoryRef } from '../shared/marketData';
import { reportError } from '../shared/sentry';
import { isRosterTicker } from '../shared/roster';
import type { DocumentData } from 'firebase-admin/firestore';
import type { PricePoint } from '../shared/types';
import { runWeeklyCrewRankings, runCrewRoleSyncOnly } from './crewRankings';

type UserRow = DocumentData & { id: string };

// Every system worth knowing the reach of, and the tag its callables pass to
// touchLastActive. Add a feature here and stamp it at the callable; nothing else
// needs to change. `trading` is special-cased — trades are already counted from
// the trades collection, so executeTrade needs no stamp.
const TRACKED_FEATURES = [
  'ladder',
  'predictions',
  'eventMarket',
  'missions',
  'crew',
  'crewMissions',
  'margin',
  'limitOrders',
  'preMarket',
  'ipo',
  'cosmetics',
  'pins',
  'dailyCheckin',
  'portfolio',
];

// Distinct non-bot users per system over the window, written to admin/featureUsage
// for the admin Stats tab. Best-effort: a failure here must never take down the
// weekly report, which is the actual job.
async function writeFeatureUsage({
  users,
  tradesByUid,
  since,
  now,
}: {
  users: UserRow[];
  tradesByUid: Record<string, unknown> | null | undefined;
  since: number;
  now: number;
}) {
  try {
    const humans = users.filter((u) => !u.isBot);
    const counts: Record<string, number> = { trading: Object.keys(tradesByUid || {}).length };
    for (const feature of TRACKED_FEATURES) {
      counts[feature] = humans.filter((u) => (u.lastUsed?.[feature] || 0) >= since).length;
    }
    await db.collection('admin').doc('featureUsage').set({
      counts,
      totalUsers: humans.length,
      windowDays: 7,
      generatedAt: now,
    });
  } catch (err) {
    logger.error('Failed to write feature usage report:', err);
  }
}

// Builds and posts the weekly market report. Read-only apart from the Discord
// post, so it is safe to re-run by hand (see triggerWeeklyMarketSummary).
async function runWeeklyMarketSummary() {
  try {
    const marketRef = db.collection('market').doc('current');
    const marketSnap = await marketRef.get();

    if (!marketSnap.exists) return { posted: false, error: 'No market data.' };

    const marketData = marketSnap.data()!;
    const prices: Record<string, number> = marketData.prices || {};
    const histSnap = await priceHistoryRef().get();
    const priceHistory: Record<string, PricePoint[]> = histSnap.exists ? histSnap.data() || {} : {};

    // Get all users
    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as UserRow);

    // Calculate weekly stats
    const now = Date.now();
    const weekAgo = now - ONE_WEEK_MS;

    // Weekly price changes
    const weeklyChanges: { ticker: string; change: number; price: number; priceWeekAgo: number }[] = [];
    Object.entries(prices).forEach(([ticker, currentPrice]) => {
      if (!isRosterTicker(ticker)) return;
      const history = priceHistory[ticker] || [];
      if (history.length === 0) return;

      let priceWeekAgo = history[0]!.price;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i]!.timestamp <= weekAgo) {
          priceWeekAgo = history[i]!.price;
          break;
        }
      }

      const change = priceWeekAgo > 0 ? ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100 : 0;
      weeklyChanges.push({ ticker, price: currentPrice, change, priceWeekAgo });
    });

    weeklyChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const topGainer = weeklyChanges.find((s) => s.change > 0);
    const topLoser = weeklyChanges.find((s) => s.change < 0);

    // Weekly volume
    const {
      trades: weeklyTrades,
      volume: weeklyVolume,
      tradesByUid,
    } = await sumMarketActivity({ sinceMs: weekAgo, users });

    // Active users — opened the app, traded, checked in, or took any other
    // action within the window
    const activeCutoff = now - ACTIVE_USER_WINDOW_MS;
    const activeUsers = users.filter((u) => !u.isBot && getLastActiveMs(u) >= activeCutoff).length;

    // How many distinct people touched each system this week. Rides entirely
    // on data already in hand: the `users` array above and the tradesByUid map
    // sumMarketActivity already built, so the report costs no extra reads.
    // Per-feature stamps come from touchLastActive(uid, feature).
    await writeFeatureUsage({ users, tradesByUid, since: weekAgo, now });

    // Top portfolios — bots and banned accounts are excluded from all
    // user-facing rankings
    const topPortfolios = users
      .filter((u) => !u.isBot && !u.isBanned && u.portfolioValue > 0)
      .sort((a, b) => b.portfolioValue - a.portfolioValue)
      .slice(0, 5);

    // Build comprehensive embed
    const embed = {
      title: '📈 Weekly Market Report',
      description: `Week ending ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
      color: 0x4ecdc4,
      fields: [
        {
          name: '📊 Weekly Activity',
          value: `${weeklyTrades} trades\n$${weeklyVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} total volume\n${activeUsers} active users (last ${ACTIVE_USER_WINDOW_DAYS} days)`,
          inline: false,
        },
        {
          name: '🚀 Biggest Mover (Up)',
          value: topGainer
            ? `**${topGainer.ticker}**\n$${topGainer.priceWeekAgo.toFixed(2)} → $${topGainer.price.toFixed(2)}\n+${topGainer.change.toFixed(1)}%`
            : 'None',
          inline: true,
        },
        {
          name: '📉 Biggest Mover (Down)',
          value: topLoser
            ? `**${topLoser.ticker}**\n$${topLoser.priceWeekAgo.toFixed(2)} → $${topLoser.price.toFixed(2)}\n${topLoser.change.toFixed(1)}%`
            : 'None',
          inline: true,
        },
        {
          name: '🏆 Top 5 Portfolios',
          value:
            topPortfolios
              .map(
                (u, i) =>
                  `${i + 1}. ${u.displayName || 'Anonymous'} - $${u.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
              )
              .join('\n') || 'None',
          inline: false,
        },
      ],
      footer: {
        text: 'Next report: same time next week',
      },
      timestamp: new Date().toISOString(),
    };

    await sendDiscordMessage(null, [embed]);
    return { posted: true, activeUsers, weeklyTrades };
  } catch (error) {
    logger.error('Error in weeklyMarketSummary:', error);
    return { posted: false, error: (error as Error).message };
  }
}

export const weeklyMarketSummary = cf()
  .pubsub.schedule('0 0 * * 1')
  .timeZone('UTC')
  .onRun(async () => {
    await runWeeklyMarketSummary();
    await recordHeartbeat('weeklyMarketSummary');
    return null;
  });

/**
 * Admin-only manual re-run of the weekly market report. Posts the same embed to
 * Discord immediately. Nothing else is written, so extra runs are harmless.
 */
export const triggerWeeklyMarketSummary = cf().https.onCall(async (data, context) => {
  requireAdmin(context, 'Admin only.');
  return runWeeklyMarketSummary();
});

/**
 * Weekly Leaderboard - Runs Mondays at 01:00 UTC
 */
export const weeklyLeaderboard = cf()
  .pubsub.schedule('0 1 * * 1')
  .timeZone('UTC')
  .onRun(async (_context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        logger.info('No users found');
        return null;
      }

      // Calculate portfolio values and sort
      const activeCutoff = Date.now() - ACTIVE_USER_WINDOW_MS;
      let activeCount = 0;
      const traders: { username: string; portfolioValue: number }[] = [];
      usersSnapshot.forEach((doc) => {
        const user = doc.data()!;
        if (!user.isBot && getLastActiveMs(user) >= activeCutoff) activeCount++;
        // Bots are excluded from all user-facing rankings
        if (!user.isBankrupt && !user.isBot) {
          traders.push({
            username: user.displayName,
            portfolioValue: user.portfolioValue || user.cash || 0,
          });
        }
      });

      traders.sort((a, b) => b.portfolioValue - a.portfolioValue);
      const top5 = traders.slice(0, 5);

      const leaderboardText = top5
        .map((trader, idx) => {
          const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][idx];
          return `${medal} **${trader.username}** - $${trader.portfolioValue.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
        })
        .join('\n');

      const embed = {
        color: 0xffd700, // Gold
        title: '🏆 Weekly Leaderboard',
        description: leaderboardText,
        footer: {
          text: `Total Active Users (last ${ACTIVE_USER_WINDOW_DAYS} days): ${activeCount}`,
        },
        timestamp: new Date().toISOString(),
      };

      await sendDiscordMessage(null, [embed]);
      logger.info('Weekly leaderboard sent');
      await recordHeartbeat('weeklyLeaderboard');
      return null;
    } catch (error) {
      reportError(error, { where: 'weeklyLeaderboard' });
      return null;
    }
  });

// 5 min rather than the 60s default: this scans every user doc and then makes
// up to 18 Discord round-trips. Billed on actual runtime, so the headroom is
// free unless something is genuinely slow.
export const weeklyCrewRankings = cf({ timeoutSeconds: 300 })
  .pubsub.schedule('30 1 * * 1')
  .timeZone('UTC')
  .onRun(async (_context) => {
    try {
      await runWeeklyCrewRankings();
      await recordHeartbeat('weeklyCrewRankings');
    } catch (error) {
      // This sets every crew's mission multiplier and crowns the crew heads, so
      // a failure leaves last week's numbers in place with nothing looking wrong.
      reportError(error, { where: 'weeklyCrewRankings' });
    }
    return null;
  });

/**
 * Admin-only manual re-run. Seeds/refreshes market/crewStats (underdog
 * multipliers) and optionally re-posts the Discord rankings. Useful right
 * after a deploy or if the Monday run failed.
 * Pass { skipDiscord: true } to only recompute the stats doc.
 * Pass { rolesOnly: true } to only re-sync the crew head Discord roles, or
 * { rolesOnly: true, dryRun: true } to just check the Discord setup.
 */
export const triggerWeeklyCrewRankings = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAdmin(context, 'Admin only.');
  if (data && data.rolesOnly) return runCrewRoleSyncOnly({ dryRun: !!data.dryRun });
  return runWeeklyCrewRankings({ postToDiscord: !(data && data.skipDiscord) });
});

// Exposed for scripts/test-crew-roles-emulator.cjs. Not a Cloud Function —
// serviceLoader only copies exports carrying a trigger, so this never reaches
// the deployed surface (same pattern as runLimitOrderCheck in limitOrders.js).
export { runWeeklyCrewRankings };
