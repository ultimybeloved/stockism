import { cf, requireAdmin } from '../shared/fnConfig';
import { withAdminLog } from '../shared/adminLog';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import {
  ONE_WEEK_MS,
  FOURTEEN_DAYS_MS,
  ACTIVE_USER_WINDOW_MS,
  ACTIVE_USER_WINDOW_DAYS,
  LEADERBOARD_PERCENT_MIN_BASELINE,
} from '../shared/constants';
import { sendDiscordMessage, crewEmoji, pxe } from '../shared/discordApi';
import { CREW_MAP } from '../shared/crews';
import { weekInReviewEmbed } from './weekInReview';
import { getLastActiveMs, sumMarketActivity, recordHeartbeat } from '../shared/activity';
import { priceHistoryRef } from '../shared/marketData';
import { reportError } from '../shared/sentry';
import { isRosterTicker } from '../shared/roster';
import { netWorthOf, tradingNetWorthOf, snapshotNetWorth, netReturnPercent, grantedSince } from '../shared/equity';
import type { DocumentData } from 'firebase-admin/firestore';
import type { PricePoint } from '../shared/types';
import { runWeeklyCrewRankings, runCrewRoleSyncOnly } from './crewRankings';
import { holdForDelayedOpen } from './delayedOpenState';
import { COSMETIC_CATALOG, COSMETIC_PRICE_LIST } from '../shared/constants/cosmetics';
import { featuredCosmeticId, featuredPrice } from '../shared/rules/shop';

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

// Players by weekly percent gain, net of margin debt and free money: the same
// sums as the site's Top Gainers board (users/leaderboard.ts).
function weeklyClimbers(players: UserRow[], now: number) {
  const out: { name: string; percent: number }[] = [];
  for (const u of players) {
    const snap = u.portfolioSnapshot7d;
    if (!snap || snap.timestamp < now - FOURTEEN_DAYS_MS) continue;
    const before = snapshotNetWorth(snap, u.marginUsed || 0);
    if (before < LEADERBOARD_PERCENT_MIN_BASELINE) continue;
    const percent = netReturnPercent(
      tradingNetWorthOf(u as DocumentData),
      before,
      grantedSince(u as DocumentData, ONE_WEEK_MS),
    );
    if (percent > 0) out.push({ name: u.displayName || 'Anonymous', percent });
  }
  return out.sort((x, y) => y.percent - x.percent).slice(0, 5);
}

// Builds and posts the Week in Review (weekInReview.ts). Read-only apart from the Discord
// post, so it is safe to re-run by hand (see triggerWeeklyMarketSummary).
export async function runWeeklyMarketSummary() {
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

    const gainers = weeklyChanges.filter((c) => c.change > 0).sort((x, y) => y.change - x.change);
    const losers = weeklyChanges.filter((c) => c.change < 0).sort((x, y) => x.change - y.change);

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

    // Bots and banned accounts are excluded from all user-facing rankings.
    // Net worth (margin debt off), matching the site's board.
    const ranked = users.filter((u) => !u.isBot && !u.isBanned);
    const portfolios = ranked
      .filter((u) => !u.isBankrupt && u.portfolioValue > 0)
      .map((u) => ({ name: u.displayName || 'Anonymous', worth: netWorthOf(u as DocumentData) }))
      .sort((x, y) => y.worth - x.worth)
      .slice(0, 5);

    // Recruiters paid for a recruit since the last report.
    const recruiters = ranked
      .filter((u) => (u.recruiting?.lastPaidAt || 0) >= weekAgo && u.recruiting?.paid > 0)
      .sort((x, y) => y.recruiting.paid - x.recruiting.paid)
      .map((u) => ({ name: u.displayName || 'Anonymous', total: u.recruiting.paid as number }));

    // Written by the crew rankings five minutes before this runs.
    const crewStats = (await db.collection('market').doc('crewStats').get()).data();

    // The shop's featured item turns over at the Thursday reopen, just before
    // this runs, so the report announces the new one.
    const featuredId = featuredCosmeticId(COSMETIC_PRICE_LIST, now + 60 * 1000);
    const featured = featuredId ? COSMETIC_CATALOG[featuredId] : null;

    const embed = weekInReviewEmbed(
      {
        weekEndUnix: Math.floor(now / 1000),
        trades: weeklyTrades,
        volume: weeklyVolume,
        activePlayers: activeUsers,
        activeWindowDays: ACTIVE_USER_WINDOW_DAYS,
        gainers,
        losers,
        climbers: weeklyClimbers(ranked, now),
        portfolios,
        rivalryWinners: crewStats?.rivalryWinners || [],
        recruiters,
        featured: featured
          ? { name: featured.name, price: featured.price, salePrice: featuredPrice(featured.price) }
          : null,
      },
      pxe,
      (id) => `${crewEmoji(id)} ${CREW_MAP[id]?.name || id}`,
    );

    await sendDiscordMessage(null, [embed]);
    return { posted: true, activeUsers, weeklyTrades };
  } catch (error) {
    logger.error('Error in weeklyMarketSummary:', error);
    return { posted: false, error: (error as Error).message };
  }
}

export const weeklyMarketSummary = cf()
  .pubsub.schedule('10 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    if (await holdForDelayedOpen('weeklyMarketSummary')) return null;
    const result = await runWeeklyMarketSummary();
    // Only a summary that actually posted counts. A failure is caught inside and
    // returned as posted: false, so beating unconditionally hid every failure.
    if (result.posted) await recordHeartbeat('weeklyMarketSummary');
    else
      reportError(new Error(`weeklyMarketSummary did not post: ${result.error ?? 'no reason given'}`), {
        where: 'weeklyMarketSummary',
      });
    return null;
  });

/**
 * Admin-only manual re-run of the Week in Review. Posts the same embed to
 * Discord immediately. Nothing else is written, so extra runs are harmless.
 */
export const triggerWeeklyMarketSummary = cf().https.onCall(async (data, context) => {
  requireAdmin(context, 'Admin only.');
  return runWeeklyMarketSummary();
});

// 5 min rather than the 60s default: this scans every user doc and then makes
// up to 18 Discord round-trips. Billed on actual runtime, so the headroom is
// free unless something is genuinely slow.
export const weeklyCrewRankings = cf({ timeoutSeconds: 300 })
  .pubsub.schedule('5 21 * * 4')
  .timeZone('UTC')
  .onRun(async (_context) => {
    try {
      if (await holdForDelayedOpen('weeklyCrewRankings')) return null;
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
 * after a deploy or if the Thursday run failed.
 * Pass { skipDiscord: true } to only recompute the stats doc.
 * Pass { rolesOnly: true } to only re-sync the crew head Discord roles, or
 * { rolesOnly: true, dryRun: true } to just check the Discord setup.
 */
export const triggerWeeklyCrewRankings = cf({ timeoutSeconds: 300 }).https.onCall(
  withAdminLog('trigger_weekly_crew_rankings', async (data, context) => {
    requireAdmin(context, 'Admin only.');
    if (data && data.rolesOnly) return runCrewRoleSyncOnly({ dryRun: !!data.dryRun });
    return runWeeklyCrewRankings({ postToDiscord: !(data && data.skipDiscord) });
  }),
);

// Exposed for tests/emulator/crewRoles.test.ts. Not a Cloud Function —
// serviceLoader only copies exports carrying a trigger, so this never reaches
// the deployed surface (same pattern as runLimitOrderCheck in limitOrders.js).
export { runWeeklyCrewRankings };
