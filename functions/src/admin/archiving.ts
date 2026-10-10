import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();
import { ONE_WEEK_MS, TWENTY_FOUR_HOURS_MS, MARGIN_INTEREST_RATE, PRICE_HISTORY_LIVE_MAX } from '../shared/constants';
import { priceHistoryRef } from '../shared/marketData';
import { writeNotification } from '../shared/notifications';
import { recordHeartbeat } from '../shared/activity';
import { reportError } from '../shared/sentry';
import { seasonMarginUpdate } from '../season/seasonTiers';
import {
  loyaltyTierFor,
  LOYALTY_TIER_LABEL,
  dividendMultiplierForAgeMs,
  exitDiscountForAgeMs,
} from '../shared/characters';
import type { PricePoint, UserData } from '../shared/types';

type TierUpgrade = { ticker: string; tier: number; shares: number };

// ─── Loyalty tier-up detection ───────────────────────────────────────────────

/**
 * Compare a user's current loyalty tiers against the last ones they were told
 * about. Returns the new map plus whatever levelled up since.
 *
 * Tier drops (sold the old shares, rebought fresh) are recorded silently so the
 * player can be congratulated again when they climb back.
 */
const diffLoyaltyTiers = (userData: UserData, now: number) => {
  const holdings = userData.holdings || {};
  const cohorts = userData.holdingCohorts || {};
  const previous = userData.loyaltyTierNotified as Record<string, number> | undefined;
  const current: Record<string, number> = {};
  const upgrades: TierUpgrade[] = [];

  for (const [ticker, shares] of Object.entries(holdings)) {
    if (!(shares > 0)) continue;
    const { tier, shares: tierShares } = loyaltyTierFor(cohorts[ticker], now);
    if (tier <= 0) continue;
    current[ticker] = tier;
    if (previous && tier > (previous[ticker] || 0)) {
      upgrades.push({ ticker, tier, shares: tierShares });
    }
  }

  const changed =
    !previous ||
    Object.keys(current).length !== Object.keys(previous).length ||
    Object.entries(current).some(([t, v]) => previous[t] !== v);

  // No previous map means this user has never been scanned. Record where they
  // stand without announcing it, otherwise the first run after deploy fires at
  // every existing player at once.
  return { current, upgrades: previous ? upgrades : [], changed };
};

const buildLoyaltyNotification = (upgrades: TierUpgrade[]) => {
  const reward = (tier: number) => {
    const mult = dividendMultiplierForAgeMs(tier * TWENTY_FOUR_HOURS_MS);
    const off = Math.round(exitDiscountForAgeMs(tier * TWENTY_FOUR_HOURS_MS) * 100);
    return { mult, off };
  };

  if (upgrades.length === 1) {
    const { ticker, tier, shares } = upgrades[0]!;
    const { mult, off } = reward(tier);
    return {
      type: 'loyalty',
      title: `$${ticker} hit the ${LOYALTY_TIER_LABEL[tier]} tier`,
      message: `${shares} share${shares === 1 ? '' : 's'} now earn ${mult}x dividends and sell with ${off}% off price impact.`,
      data: { ticker, tiers: { [ticker]: tier } },
    };
  }

  const tiers: Record<string, number> = {};
  for (const u of upgrades) tiers[u.ticker] = u.tier;
  return {
    type: 'loyalty',
    title: `${upgrades.length} holdings levelled up`,
    message: upgrades.map((u) => `$${u.ticker} → ${LOYALTY_TIER_LABEL[u.tier]}`).join(', ') + '.',
    data: { tiers },
  };
};

// ─── Internal ────────────────────────────────────────────────────────────────

async function doArchivePriceHistory(ticker: string | null = null) {
  // Per-ticker cap on the LIVE doc. The real constraint is the whole
  // document's ~40k index-entry limit shared by all tickers — see the
  // constant's comment. Was 1000, which let the doc grow until Firestore
  // rejected every trade's history append (2026-07-22 incident).
  const MAX_HISTORY_SIZE = PRICE_HISTORY_LIVE_MAX;
  // Live history lives in its own doc; older points are MOVED (never deleted)
  // to the permanent archive at market/current/price_history/{ticker}.
  const marketRef = db.collection('market').doc('current');
  const histRef = priceHistoryRef();
  const histSnap = await histRef.get();

  if (!histSnap.exists) {
    return { success: false, error: 'Price history document not found' };
  }

  const priceHistory = histSnap.data() || {};
  const tickersToArchive = ticker ? [ticker] : Object.keys(priceHistory);
  let archivedCount = 0;

  // Archive docs are written per ticker, but every live-doc trim is collected
  // and applied at the end: fewer round trips (the first post-incident run
  // touches dozens of tickers and must finish inside the function timeout).
  // Archive-before-trim order means a failure mid-run only leaves points
  // duplicated in both docs — harmless, the chart merge de-dupes by timestamp.
  //
  // The trim REMOVES the archived points rather than writing back the array we
  // want to keep. That distinction is the whole ballgame: every trade appends
  // to this same document with arrayUnion, and the read at the top of this
  // function is already stale by the time the loop finishes. Writing back an
  // absolute array silently dropped every price point written while the archive
  // run was in flight — the points were not in the archive either, because the
  // archive only received the OLD ones. arrayRemove commutes with the appends,
  // so a concurrent trade's point survives.
  const liveRemovals: Record<string, PricePoint[]> = {};

  for (const t of tickersToArchive) {
    const history: PricePoint[] = priceHistory[t] || [];

    if (history.length > MAX_HISTORY_SIZE) {
      const toArchive = history.slice(0, history.length - MAX_HISTORY_SIZE);
      const toKeep = history.slice(history.length - MAX_HISTORY_SIZE);

      const archiveRef = marketRef.collection('price_history').doc(t);
      const archiveSnap = await archiveRef.get();
      const existingArchive = archiveSnap.exists ? archiveSnap.data()!.history || [] : [];

      await archiveRef.set({
        history: [...existingArchive, ...toArchive].sort((a: PricePoint, b: PricePoint) => a.timestamp - b.timestamp),
        lastUpdated: FieldValue.serverTimestamp(),
      });

      liveRemovals[t] = toArchive;
      archivedCount++;
      logger.info(`Archived ${toArchive.length} entries for ${t}, keeping ${toKeep.length} recent entries`);
    }
  }

  if (archivedCount > 0) {
    // One arrayRemove per field per update, so the removals are chunked across
    // as few updates as possible. A single run usually needs exactly one.
    const CHUNK = 250;
    const longest = Math.max(...Object.values(liveRemovals).map((pts) => pts.length));
    for (let start = 0; start < longest; start += CHUNK) {
      const update: Record<string, FieldValue> = {};
      for (const [t, pts] of Object.entries(liveRemovals)) {
        const slice = pts.slice(start, start + CHUNK);
        if (slice.length) update[t] = FieldValue.arrayRemove(...slice);
      }
      if (Object.keys(update).length) await histRef.update(update);
    }
  }

  return { success: true, archivedTickers: archivedCount, message: `Archived ${archivedCount} tickers` };
}

async function doCleanupAlertedThresholds() {
  const MAX_AGE_MS = ONE_WEEK_MS;
  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();

  if (!marketSnap.exists) {
    return { success: false, error: 'Market document not found' };
  }

  const marketData = marketSnap.data()!;
  const alertedThresholds: Record<string, number> = marketData.alertedThresholds || {};
  const now = Date.now();
  const updates: Record<string, FieldValue> = {};
  let cleanedCount = 0;

  for (const [key, timestamp] of Object.entries(alertedThresholds)) {
    if (now - timestamp > MAX_AGE_MS) {
      updates[`alertedThresholds.${key}`] = FieldValue.delete();
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    await marketRef.update(updates);
    logger.info(`Cleaned up ${cleanedCount} old alertedThresholds entries`);
  }

  return { success: true, cleanedCount, message: `Cleaned up ${cleanedCount} old threshold alerts` };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

export const archivePriceHistory = cf().https.onCall(async (data, context) => {
  // Admin-only: prevents unauthorized users from modifying market data
  requireAdmin(context, 'Admin only.');

  try {
    return await doArchivePriceHistory(data.ticker || null);
  } catch (error) {
    logger.error('Archive error:', error);
    return { success: false, error: (error as Error).message };
  }
});

// Alert-cooldown cleanup has no callable form on purpose: scheduledArchiving
// below runs doCleanupAlertedThresholds() every 24h, so a manual trigger would
// only be doing the same job a few hours early.

// Scheduled function: Auto-archive every 24 hours
export const scheduledArchiving = cf()
  .pubsub.schedule('every 24 hours')
  .timeZone('America/New_York')
  .onRun(async (_context) => {
    logger.info('Running scheduled archiving...');

    // This is what keeps the live chart doc under Firestore's size limit. When
    // that doc filled up on 2026-07-22, every trade failed, so a dead archiver
    // is an outage waiting to happen.
    try {
      const archiveResult = await doArchivePriceHistory();
      logger.info('Archive result:', archiveResult);
      if (archiveResult?.success) await recordHeartbeat('scheduledArchiving');
    } catch (error) {
      reportError(error, { where: 'scheduledArchiving' });
    }

    try {
      const cleanupResult = await doCleanupAlertedThresholds();
      logger.info('Cleanup result:', cleanupResult);
    } catch (error) {
      logger.error('Scheduled cleanup failed:', error);
    }

    return null;
  });

/**
 * Sync All Portfolio Values
 * Runs every 24 hours to recalculate and update all users' portfolio values
 * Ensures leaderboards and rankings reflect current market prices
 */
export const syncAllPortfolios = cf()
  .pubsub.schedule('every 24 hours')
  .timeZone('UTC')
  .onRun(async (_context) => {
    try {
      logger.info('Starting portfolio sync for all users...');
      const startTime = Date.now();

      // Get current market prices
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        logger.error('Market data not found');
        return { success: false, error: 'Market data missing' };
      }

      const marketData = marketSnap.data()!;
      const prices: Record<string, number> = marketData.prices || {};

      // Get all users
      const usersSnapshot = await db.collection('users').get();
      logger.info(`Found ${usersSnapshot.size} users to sync`);

      let syncedCount = 0;
      let errorCount = 0;
      let loyaltyNotified = 0;
      const loyaltyWrites = [];
      let batch = db.batch();
      let batchCount = 0;

      for (const userDoc of usersSnapshot.docs) {
        try {
          const userData = userDoc.data() as UserData;
          const userId = userDoc.id;

          // Calculate holdings value
          const holdings = userData.holdings || {};
          const holdingsValue = Object.entries(holdings).reduce((sum, [ticker, shares]) => {
            if (!shares || shares <= 0) return sum;
            const currentPrice = prices[ticker] || 0;
            return sum + shares * currentPrice;
          }, 0);

          // Calculate shorts value
          const shorts = userData.shorts || {};
          const shortsValue = Object.entries(shorts).reduce((sum, [ticker, position]) => {
            if (!position || position.shares <= 0) return sum;
            const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
            const currentPrice = prices[ticker] || entryPrice;
            const collateral = Number(position.margin) || 0;
            let value;
            if ((position.system || 'v2') === 'v2') {
              // v2: margin + unrealized P&L (no proceeds in cash)
              value = collateral + (entryPrice - currentPrice) * position.shares;
            } else {
              // Legacy: margin collateral - cost to buy back shares
              value = collateral - currentPrice * position.shares;
            }
            return sum + (isNaN(value) ? 0 : value);
          }, 0);

          // Calculate total portfolio value
          const cash = userData.cash || 0;
          const portfolioValue = Math.round((cash + holdingsValue + shortsValue) * 100) / 100;

          // Charge margin interest if due (piggybacks on the daily sync)

          let marginInterest = 0;
          const marginUsed = userData.marginUsed || 0;
          if (userData.marginEnabled && marginUsed > 0) {
            const lastCharge = (userData.lastMarginInterestCharge as number) || 0;
            if (startTime - lastCharge >= TWENTY_FOUR_HOURS_MS) {
              marginInterest = marginUsed * MARGIN_INTEREST_RATE;
            }
          }

          // Loyalty tier-ups ride along on this scan: it already holds the whole
          // user doc, so detection costs no extra reads. Bots are skipped for
          // notifications only — their portfolio sync above is untouched.
          const loyalty = userData.isBot
            ? { current: {}, upgrades: [], changed: false }
            : diffLoyaltyTiers(userData, startTime);

          // Only update if different from stored value (avoid unnecessary writes)
          const storedValue = userData.portfolioValue || 0;
          const isDifferent = Math.abs(portfolioValue - storedValue) > 0.01 || marginInterest > 0;

          if (isDifferent || loyalty.changed) {
            const userRef = db.collection('users').doc(userId);
            const updateFields: Record<string, unknown> = {
              portfolioValue: portfolioValue,
              lastSyncedAt: FieldValue.serverTimestamp(),
            };
            if (marginInterest > 0) {
              updateFields.marginUsed = marginUsed + marginInterest;
              updateFields.lastMarginInterestCharge = startTime;
              Object.assign(updateFields, seasonMarginUpdate(userData, marginUsed + marginInterest, startTime));
            }
            if (loyalty.changed) {
              updateFields.loyaltyTierNotified = loyalty.current;
            }
            batch.update(userRef, updateFields);

            if (loyalty.upgrades.length > 0) {
              // Collected rather than fired and forgotten: the container can be
              // frozen the moment this handler returns, which would drop the
              // write. Awaited together after the loop.
              loyaltyWrites.push(
                writeNotification(userId, buildLoyaltyNotification(loyalty.upgrades)).catch((err) =>
                  logger.error('Loyalty notification failed for', userId, err),
                ),
              );
              loyaltyNotified++;
            }
            batchCount++;
            syncedCount++;

            // Commit batch every 500 operations (Firestore limit). A committed
            // WriteBatch can't be reused — start a fresh one.
            if (batchCount >= 500) {
              await batch.commit();
              logger.info(`Committed batch of ${batchCount} updates`);
              batch = db.batch();
              batchCount = 0;
            }
          }
        } catch (error) {
          logger.error(`Error syncing user ${userDoc.id}:`, error);
          errorCount++;
        }
      }

      // Commit remaining updates
      if (batchCount > 0) {
        await batch.commit();
        logger.info(`Committed final batch of ${batchCount} updates`);
      }

      if (loyaltyWrites.length > 0) {
        await Promise.all(loyaltyWrites);
        logger.info(`Sent ${loyaltyNotified} loyalty tier-up notification(s)`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const result = {
        success: true,
        totalUsers: usersSnapshot.size,
        synced: syncedCount,
        skipped: usersSnapshot.size - syncedCount - errorCount,
        errors: errorCount,
        loyaltyNotified,
        elapsedSeconds: elapsed,
      };

      logger.info('Portfolio sync complete:', result);
      await recordHeartbeat('syncAllPortfolios');
      return result;
    } catch (error) {
      reportError(error, { where: 'syncAllPortfolios' });
      return { success: false, error: (error as Error).message };
    }
  });

/**
 * Create a Limit Order (server-side validation)
 * Replaces direct client addDoc() to enforce business logic
 */
