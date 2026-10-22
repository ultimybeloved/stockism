import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import {
  TWENTY_FOUR_HOURS_MS,
  WEEKLY_HALT_START_MINUTE,
  WEEKLY_HALT_END_MINUTE,
  ACTIVE_USER_WINDOW_MS,
  ACTIVE_USER_WINDOW_DAYS,
} from '../shared/constants';
import { sendDiscordMessage, sendMarketStatusAlert, pxe } from '../shared/discordApi';
import { priceHistoryRef, recordDailyCloses } from '../shared/marketData';
import { getLastActiveMs, sumMarketActivity, recordHeartbeat } from '../shared/activity';
import { isRosterTicker } from '../shared/roster';
import { reportError } from '../shared/sentry';
import { writeReviewChanges } from './reviewChanges';
import { indexConstituents, reconcileDivisor, computeIndexValue } from '../shared/indexMaintenance';
import type { DocumentData } from 'firebase-admin/firestore';
import type { PricePoint } from '../shared/types';
import { logAdminAction } from '../shared/adminLog';
import { holdForDelayedOpen } from './delayedOpenState';
import { runChapterReviewRecap } from './reviewRecap';

type Mover = { ticker: string; price: number; change: number };

// Builds and posts the daily market summary Discord embed. Shared by the
// scheduled run and the admin re-trigger. Only the scheduled run records the
// daily market-index point, so a manual re-run can't double-record it.
async function doDailyMarketSummary({ recordIndexHistory }: { recordIndexHistory: boolean }) {
  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();

  if (!marketSnap.exists) {
    logger.info('No market data found');
    return { success: false, error: 'No market data found' };
  }

  const marketData = marketSnap.data()!;
  const prices: Record<string, number> = marketData.prices || {};
  const histSnap = await priceHistoryRef().get();
  const priceHistory: Record<string, PricePoint[]> = histSnap.exists ? histSnap.data() || {} : {};

  // Get all users for stats
  const usersSnap = await db.collection('users').get();
  const users = usersSnap.docs.map((doc) => ({ id: doc.id, ...doc.data() }) as DocumentData & { id: string });

  // Calculate 24h changes
  const now = Date.now();
  const dayAgo = now - TWENTY_FOUR_HOURS_MS;
  const gainers: Mover[] = [];
  const losers: Mover[] = [];
  const athStocks: string[] = [];

  Object.entries(prices).forEach(([ticker, currentPrice]) => {
    if (!isRosterTicker(ticker)) return;
    const history = priceHistory[ticker] || [];
    if (history.length === 0) return;

    // Find price 24h ago
    let price24hAgo = history[0]!.price;
    for (let i = history.length - 1; i >= 0; i--) {
      if (history[i]!.timestamp <= dayAgo) {
        price24hAgo = history[i]!.price;
        break;
      }
    }

    const change = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
    const stock = { ticker, price: currentPrice, change };

    if (change > 0) gainers.push(stock);
    if (change < 0) losers.push(stock);

    // Check for ATH
    const highestHistorical = Math.max(...history.map((h) => h.price));
    if (currentPrice >= highestHistorical) {
      athStocks.push(ticker);
    }
  });

  gainers.sort((a, b) => b.change - a.change);
  losers.sort((a, b) => a.change - b.change);

  // Record today's market index value so the index banner can show a rolling
  // 30-day change. Stored in its own doc (not market/current) to keep the
  // frequently-read market doc small. Never trimmed — at one point per day
  // this stays tiny for decades, and the index's full arc is part of the
  // game's permanent record.
  if (recordIndexHistory)
    try {
      const idxRef = db.collection('market').doc('indexHistory');
      const idxSnap = await idxRef.get();
      const stored = idxSnap.exists ? idxSnap.data() || {} : {};
      const hist = stored.history || [];
      const lastIndexValue = hist.length ? hist[hist.length - 1].v || 0 : 0;

      // Divisor-adjusted, so adding characters to the roster can't move the
      // index on its own — see indexMaintenance.js. Season tiers are scored
      // against this line, so a phantom drop would hand everyone a free win.
      const constituents = indexConstituents();
      const { divisor, adjusted, reason } = reconcileDivisor({ prices, constituents, stored, lastIndexValue });
      const indexValue = computeIndexValue(prices, constituents, divisor);

      hist.push({ t: now, v: Math.round(indexValue * 100) / 100 });
      const idxUpdate: Record<string, unknown> = { history: hist, divisor, constituents };
      if (adjusted) {
        idxUpdate.lastDivisorAdjustment = { at: now, reason, divisor, count: constituents.length };
        logger.info(`Index divisor ${reason}: ${divisor} over ${constituents.length} constituents`);
      }
      await idxRef.set(idxUpdate, { merge: true });
    } catch (e) {
      logger.error('index history record failed:', (e as Error).message);
    }

  // Today's closing prices, one document per calendar month. The live
  // price-history doc keeps only the most recent points per ticker and
  // archives the rest, so this is the only place a clean daily series
  // exists. Idempotent — a re-run overwrites today rather than duplicating
  // it — and best-effort, because a failed archive must never take down the
  // daily summary.
  try {
    // Scheduled run only also sets the close Buy the Dip measures from.
    const closed = await recordDailyCloses(prices, now, { setDayClose: recordIndexHistory });
    logger.info(`daily closes recorded: ${closed} tickers`);
  } catch (e) {
    logger.error('daily close record failed:', (e as Error).message);
  }

  // Trading volume and counts. Bots count toward market volume but never
  // toward trader rankings — they aren't in the trades collection at all.
  const {
    trades: tradeCount,
    volume: totalVolume,
    tradesByUid: traderActivity,
  } = await sumMarketActivity({ sinceMs: dayAgo, users });

  // Headcounts. "Traded today" is a subset of the players who showed up —
  // most people check prices far more often than they trade, so the two
  // numbers are very different and both are worth posting.
  const realPlayers = users.filter((u) => !u.isBot && !u.isBanned);
  const activeToday = realPlayers.filter((u) => getLastActiveMs(u) > dayAgo).length;
  const activeInWindow = realPlayers.filter((u) => getLastActiveMs(u) > now - ACTIVE_USER_WINDOW_MS).length;

  // Banned accounts are kept out of the counts and the ranking the same way
  // bots are.
  const nameByUid = new Map(realPlayers.map((u) => [u.id, u.displayName || 'Anonymous']));
  const tradedToday = Object.keys(traderActivity).filter((uid) => nameByUid.has(uid)).length;
  const topTraders = Object.entries(traderActivity)
    .filter(([uid]) => nameByUid.has(uid))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Build Discord embed
  const embed = {
    title: `${pxe('chart')} Daily Market Summary`,
    description: `Market close - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
    color: 0xff6b35,
    fields: [
      {
        name: `${pxe('trade')} Market Activity`,
        value: `${tradeCount} trades • $${totalVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })} volume`,
        inline: false,
      },
      {
        name: `${pxe('fire')} Top Gainers (24h)`,
        value:
          gainers
            .slice(0, 3)
            .map((s) => `**${s.ticker}** $${s.price.toFixed(2)} (+${s.change.toFixed(1)}%)`)
            .join('\n') || 'None',
        inline: true,
      },
      {
        name: `${pxe('chart_down')} Top Losers (24h)`,
        value:
          losers
            .slice(0, 3)
            .map((s) => `**${s.ticker}** $${s.price.toFixed(2)} (${s.change.toFixed(1)}%)`)
            .join('\n') || 'None',
        inline: true,
      },
    ],
    timestamp: new Date().toISOString(),
  };

  if (athStocks.length > 0) {
    embed.fields.push({
      name: `${pxe('star')} New All-Time Highs`,
      value: athStocks.slice(0, 5).join(', '),
      inline: false,
    });
  }

  if (topTraders.length > 0) {
    embed.fields.push({
      name: `${pxe('bolt')} Most Active Traders`,
      value: topTraders
        .map(([uid, count], i) => `${i + 1}. ${nameByUid.get(uid)} - ${count} ${count === 1 ? 'trade' : 'trades'}`)
        .join('\n'),
      inline: false,
    });
  }

  embed.fields.push({
    name: `${pxe('cash')} Market Stats`,
    value: [
      `Total Cash: $${Math.round(users.reduce((sum, u) => sum + (u.isBot ? 0 : u.cash || 0), 0)).toLocaleString()}`,
      `Traded today: ${tradedToday}`,
      `Players active today: ${activeToday}`,
      `Active in the last ${ACTIVE_USER_WINDOW_DAYS} days: ${activeInWindow}`,
    ].join('\n'),
    inline: false,
  });

  await sendDiscordMessage(null, [embed]);
  return { success: true };
}

export const dailyMarketSummary = cf()
  .pubsub.schedule('0 21 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await doDailyMarketSummary({ recordIndexHistory: true });
      await recordHeartbeat('dailyMarketSummary');
    } catch (error) {
      reportError(error, { where: 'dailyMarketSummary' });
    }
    return null;
  });

/**
 * Save pre-halt prices snapshot every Thursday at 12:55 UTC (5 min before halt)
 */
export const savePreHaltPrices = cf()
  .pubsub.schedule('55 12 * * 4')
  .timeZone('UTC')
  .onRun(async (_context) => {
    try {
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) {
        logger.info('No market data found for pre-halt snapshot');
        return null;
      }

      const marketData = marketSnap.data()!;
      const prices = marketData.prices || {};

      await db.collection('market').doc('preHaltSnapshot').set({
        prices,
        savedAt: FieldValue.serverTimestamp(),
      });

      logger.info(`Pre-halt snapshot saved with ${Object.keys(prices).length} tickers`);
      await recordHeartbeat('savePreHaltPrices');
      return null;
    } catch (error) {
      // Dividends pay three minutes later off this snapshot, so a failure here
      // means they pay on last week's prices. It has to reach someone.
      reportError(error, { where: 'savePreHaltPrices' });
      return null;
    }
  });

/**
 * Chapter review recap - posts Discord alert every Thursday at 20:30 UTC (reviewRecap.ts)
 *
 * Lists ONLY the stocks the admin physically adjusted during the review, at the
 * amount they adjusted them by. Stocks that merely trailed one of those
 * adjustments, and anything moved by a trade or a bot, are excluded — see
 * getReviewWindowChanges. Adjustments made after this runs are not announced.
 */
export const chapterReviewRecap = cf()
  .pubsub.schedule('30 20 * * 4')
  .timeZone('UTC')
  .onRun(async (_context) => {
    if (await holdForDelayedOpen('chapterReviewRecap')) return null;
    await runChapterReviewRecap();
    return null;
  });

/**
 * Fill pending stop loss orders at market open after chapter review.
 * Also runs the opening auction for pre-market orders placed during 20:30-21:00 UTC.
 * Runs at exactly 21:00 UTC Thursday — same moment the halt ends.
 */

/**
 * Rebuild the Review tab's stored changes for the most recent halt window
 * (admin only).
 *
 * Recovery for a failed chapterReviewRecap, and the way to backfill a window
 * that already rolled out of the live price history — it stitches the permanent
 * archive in front, so it works long after the live doc has been trimmed.
 */
export const triggerReviewChanges = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAdmin(context);

  // Most recent Thursday halt, mirroring getMostRecentHaltWindow on the client.
  const now = new Date();
  const day = now.getUTCDay();
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d = new Date(now);
  if (!(day === 4 && utcMins >= WEEKLY_HALT_START_MINUTE)) {
    d.setUTCDate(d.getUTCDate() - ((day - 4 + 7) % 7 || 7));
  }
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  const haltStart = dayStart + WEEKLY_HALT_START_MINUTE * 60 * 1000;
  const haltEnd = dayStart + WEEKLY_HALT_END_MINUTE * 60 * 1000;

  // The pre-halt snapshot is deleted once the recap posts, so it is usually
  // gone by the time this runs. Use it when it happens to still be there.
  const snapshotSnap = await db.collection('market').doc('preHaltSnapshot').get();
  const fallbackPrices = snapshotSnap.exists ? snapshotSnap.data()!.prices || {} : {};

  const payload = await writeReviewChanges({ haltStart, haltEnd, fallbackPrices, includeArchive: true });
  return { success: true, tickerCount: payload.tickerCount, windowEnd: payload.windowEnd };
});

/**
 * Manual trigger for daily market summary (admin only)
 */
export const triggerDailyMarketSummary = cf().https.onCall(async (data, context) => {
  // Admin check
  requireAdmin(context);

  try {
    return await doDailyMarketSummary({ recordIndexHistory: false });
  } catch (error) {
    logger.error('Error in triggerDailyMarketSummary:', error);
    return { success: false, error: (error as Error).message };
  }
});

/**
 * Weekly Market Summary - Runs Mondays at 00:00 UTC
 */

// ============================================
// MARKET STATUS ALERTS (Discord)
// ============================================

// Weekly halt begins — Thursday 13:00 UTC
export const marketClosedAlert = cf()
  .pubsub.schedule('0 13 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    await sendMarketStatusAlert('closed');
    return null;
  });

// Pre-market queue opens — Thursday 20:30 UTC
export const preMarketOpenAlert = cf()
  .pubsub.schedule('30 20 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    if (await holdForDelayedOpen('preMarketOpenAlert')) return null;
    await sendMarketStatusAlert('premarket');
    return null;
  });

// Trading resumes — Thursday 21:00 UTC
export const marketOpenAlert = cf()
  .pubsub.schedule('0 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    if (await holdForDelayedOpen('marketOpenAlert')) return null;
    await sendMarketStatusAlert('open');
    return null;
  });

/**
 * Admin: manually halt or resume the market. Sets the flag and announces it on Discord.
 */
export const setMarketHalt = cf().https.onCall(async (data, context) => {
  requireAdmin(context, 'Only admin can halt the market.');

  const halted = !!data.halted;
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';

  if (halted && !reason) {
    throw new functions.https.HttpsError('invalid-argument', 'A halt reason is required.');
  }

  await db
    .collection('market')
    .doc('current')
    .update({
      marketHalted: halted,
      haltReason: halted ? reason : '',
      haltedAt: halted ? Date.now() : null,
      haltedBy: halted ? context.auth!.uid : null,
    });

  try {
    await sendMarketStatusAlert(halted ? 'halted' : 'resumed', reason);
  } catch (err) {
    logger.error('Failed to send market status alert:', err);
  }

  await logAdminAction(context, { action: halted ? 'halt_market' : 'resume_market', detail: { reason } });
  return { success: true, halted };
});
