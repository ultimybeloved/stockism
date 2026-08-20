'use strict';
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();
const { ADMIN_UID, ONE_WEEK_MS, TWENTY_FOUR_HOURS_MS, MARGIN_INTEREST_RATE, PRICE_HISTORY_LIVE_MAX } = require('../constants');
const { priceHistoryRef, writeNotification } = require('../helpers');
const {
  loyaltyTierFor, LOYALTY_TIER_LABEL,
  dividendMultiplierForAgeMs, exitDiscountForAgeMs,
} = require('../characters');

// ─── Loyalty tier-up detection ───────────────────────────────────────────────

/**
 * Compare a user's current loyalty tiers against the last ones they were told
 * about. Returns the new map plus whatever levelled up since.
 *
 * Tier drops (sold the old shares, rebought fresh) are recorded silently so the
 * player can be congratulated again when they climb back.
 */
const diffLoyaltyTiers = (userData, now) => {
  const holdings = userData.holdings || {};
  const cohorts = userData.holdingCohorts || {};
  const previous = userData.loyaltyTierNotified;
  const current = {};
  const upgrades = [];

  for (const [ticker, shares] of Object.entries(holdings)) {
    if (!(shares > 0)) continue;
    const { tier, shares: tierShares } = loyaltyTierFor(cohorts[ticker], now);
    if (tier <= 0) continue;
    current[ticker] = tier;
    if (previous && tier > (previous[ticker] || 0)) {
      upgrades.push({ ticker, tier, shares: tierShares });
    }
  }

  const changed = !previous
    || Object.keys(current).length !== Object.keys(previous).length
    || Object.entries(current).some(([t, v]) => previous[t] !== v);

  // No previous map means this user has never been scanned. Record where they
  // stand without announcing it, otherwise the first run after deploy fires at
  // every existing player at once.
  return { current, upgrades: previous ? upgrades : [], changed };
};

const buildLoyaltyNotification = (upgrades) => {
  const day = 24 * 60 * 60 * 1000;
  const reward = (tier) => {
    const mult = dividendMultiplierForAgeMs(tier * day);
    const off = Math.round(exitDiscountForAgeMs(tier * day) * 100);
    return { mult, off };
  };

  if (upgrades.length === 1) {
    const { ticker, tier, shares } = upgrades[0];
    const { mult, off } = reward(tier);
    return {
      type: 'loyalty',
      title: `$${ticker} hit the ${LOYALTY_TIER_LABEL[tier]} tier`,
      message: `${shares} share${shares === 1 ? '' : 's'} now earn ${mult}x dividends and sell with ${off}% off price impact.`,
      data: { ticker, tiers: { [ticker]: tier } },
    };
  }

  const tiers = {};
  for (const u of upgrades) tiers[u.ticker] = u.tier;
  return {
    type: 'loyalty',
    title: `${upgrades.length} holdings levelled up`,
    message: upgrades
      .map((u) => `$${u.ticker} → ${LOYALTY_TIER_LABEL[u.tier]}`)
      .join(', ') + '.',
    data: { tiers },
  };
};

// ─── Internal ────────────────────────────────────────────────────────────────

async function doArchivePriceHistory(ticker = null) {
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
  // into ONE final update: fewer round trips (the first post-incident run
  // touches dozens of tickers and must finish inside the function timeout)
  // and the live doc shrinks atomically. Archive-before-trim order means a
  // failure mid-run only leaves points duplicated in both docs — harmless,
  // the chart merge de-dupes by timestamp.
  const liveTrims = {};

  for (const t of tickersToArchive) {
    const history = priceHistory[t] || [];

    if (history.length > MAX_HISTORY_SIZE) {
      const toArchive = history.slice(0, history.length - MAX_HISTORY_SIZE);
      const toKeep = history.slice(history.length - MAX_HISTORY_SIZE);

      const archiveRef = marketRef.collection('price_history').doc(t);
      const archiveSnap = await archiveRef.get();
      const existingArchive = archiveSnap.exists ? archiveSnap.data().history || [] : [];

      await archiveRef.set({
        history: [...existingArchive, ...toArchive].sort((a, b) => a.timestamp - b.timestamp),
        lastUpdated: FieldValue.serverTimestamp()
      });

      liveTrims[t] = toKeep;
      archivedCount++;
      console.log(`Archived ${toArchive.length} entries for ${t}, keeping ${toKeep.length} recent entries`);
    }
  }

  if (archivedCount > 0) {
    await histRef.update(liveTrims);
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

  const marketData = marketSnap.data();
  const alertedThresholds = marketData.alertedThresholds || {};
  const now = Date.now();
  const updates = {};
  let cleanedCount = 0;

  for (const [key, timestamp] of Object.entries(alertedThresholds)) {
    if (now - timestamp > MAX_AGE_MS) {
      updates[`alertedThresholds.${key}`] = admin.firestore.FieldValue.delete();
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    await marketRef.update(updates);
    console.log(`Cleaned up ${cleanedCount} old alertedThresholds entries`);
  }

  return { success: true, cleanedCount, message: `Cleaned up ${cleanedCount} old threshold alerts` };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

exports.archivePriceHistory = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  // Admin-only: prevents unauthorized users from modifying market data
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  try {
    return await doArchivePriceHistory(data.ticker || null);
  } catch (error) {
    console.error('Archive error:', error);
    return { success: false, error: error.message };
  }
});

// Alert-cooldown cleanup has no callable form on purpose: scheduledArchiving
// below runs doCleanupAlertedThresholds() every 24h, so a manual trigger would
// only be doing the same job a few hours early.

// Scheduled function: Auto-archive every 6 hours
exports.scheduledArchiving = cf().pubsub
  .schedule('every 24 hours')
  .timeZone('America/New_York')
  .onRun(async (context) => {
    console.log('Running scheduled archiving...');

    try {
      const archiveResult = await doArchivePriceHistory();
      console.log('Archive result:', archiveResult);
    } catch (error) {
      console.error('Scheduled archive failed:', error);
    }

    try {
      const cleanupResult = await doCleanupAlertedThresholds();
      console.log('Cleanup result:', cleanupResult);
    } catch (error) {
      console.error('Scheduled cleanup failed:', error);
    }

    return null;
  });

/**
 * Sync All Portfolio Values
 * Runs every 6 hours to recalculate and update all users' portfolio values
 * Ensures leaderboards and rankings reflect current market prices
 */
exports.syncAllPortfolios = cf().pubsub
  .schedule('every 24 hours')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      console.log('Starting portfolio sync for all users...');
      const startTime = Date.now();

      // Get current market prices
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return { success: false, error: 'Market data missing' };
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};

      // Get all users
      const usersSnapshot = await db.collection('users').get();
      console.log(`Found ${usersSnapshot.size} users to sync`);

      let syncedCount = 0;
      let errorCount = 0;
      let loyaltyNotified = 0;
      const loyaltyWrites = [];
      let batch = db.batch();
      let batchCount = 0;

      for (const userDoc of usersSnapshot.docs) {
        try {
          const userData = userDoc.data();
          const userId = userDoc.id;

          // Calculate holdings value
          const holdings = userData.holdings || {};
          const holdingsValue = Object.entries(holdings).reduce((sum, [ticker, shares]) => {
            if (!shares || shares <= 0) return sum;
            const currentPrice = prices[ticker] || 0;
            return sum + (shares * currentPrice);
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
              value = collateral - (currentPrice * position.shares);
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
            const lastCharge = userData.lastMarginInterestCharge || 0;
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
            const updateFields = {
              portfolioValue: portfolioValue,
              lastSyncedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            if (marginInterest > 0) {
              updateFields.marginUsed = marginUsed + marginInterest;
              updateFields.lastMarginInterestCharge = startTime;
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
                writeNotification(userId, buildLoyaltyNotification(loyalty.upgrades))
                  .catch(err => console.error('Loyalty notification failed for', userId, err))
              );
              loyaltyNotified++;
            }
            batchCount++;
            syncedCount++;

            // Commit batch every 500 operations (Firestore limit). A committed
            // WriteBatch can't be reused — start a fresh one.
            if (batchCount >= 500) {
              await batch.commit();
              console.log(`Committed batch of ${batchCount} updates`);
              batch = db.batch();
              batchCount = 0;
            }
          }
        } catch (error) {
          console.error(`Error syncing user ${userDoc.id}:`, error);
          errorCount++;
        }
      }

      // Commit remaining updates
      if (batchCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${batchCount} updates`);
      }

      if (loyaltyWrites.length > 0) {
        await Promise.all(loyaltyWrites);
        console.log(`Sent ${loyaltyNotified} loyalty tier-up notification(s)`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const result = {
        success: true,
        totalUsers: usersSnapshot.size,
        synced: syncedCount,
        skipped: usersSnapshot.size - syncedCount - errorCount,
        errors: errorCount,
        loyaltyNotified,
        elapsedSeconds: elapsed
      };

      console.log('Portfolio sync complete:', result);
      return result;

    } catch (error) {
      console.error('Portfolio sync failed:', error);
      return { success: false, error: error.message };
    }
  });

/**
 * Create a Limit Order (server-side validation)
 * Replaces direct client addDoc() to enforce business logic
 */

