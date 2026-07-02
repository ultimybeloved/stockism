'use strict';
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { ADMIN_UID, ONE_WEEK_MS, TWENTY_FOUR_HOURS_MS, MARGIN_INTEREST_RATE } = require('../constants');
const { priceHistoryRef } = require('../helpers');

// ─── Internal ────────────────────────────────────────────────────────────────

async function doArchivePriceHistory(ticker = null) {
  const MAX_HISTORY_SIZE = 1000;
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
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });

      await histRef.update({
        [t]: toKeep
      });

      archivedCount++;
      console.log(`Archived ${toArchive.length} entries for ${t}, kept ${toKeep.length} recent entries`);
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

// Clean up old alertedThresholds (Discord alert cooldowns don't need long-term storage)
exports.cleanupAlertedThresholds = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  // Admin-only: prevents unauthorized cleanup of alert state
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  try {
    return await doCleanupAlertedThresholds();
  } catch (error) {
    console.error('Cleanup error:', error);
    return { success: false, error: error.message };
  }
});

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
      const batch = db.batch();
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

          // Charge margin interest if due (piggybacks on 6-hour sync)
          
          let marginInterest = 0;
          const marginUsed = userData.marginUsed || 0;
          if (userData.marginEnabled && marginUsed > 0) {
            const lastCharge = userData.lastMarginInterestCharge || 0;
            if (startTime - lastCharge >= TWENTY_FOUR_HOURS_MS) {
              marginInterest = marginUsed * MARGIN_INTEREST_RATE;
            }
          }

          // Only update if different from stored value (avoid unnecessary writes)
          const storedValue = userData.portfolioValue || 0;
          const isDifferent = Math.abs(portfolioValue - storedValue) > 0.01 || marginInterest > 0;

          if (isDifferent) {
            const userRef = db.collection('users').doc(userId);
            const updateFields = {
              portfolioValue: portfolioValue,
              lastSyncedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            if (marginInterest > 0) {
              updateFields.marginUsed = marginUsed + marginInterest;
              updateFields.lastMarginInterestCharge = startTime;
            }
            batch.update(userRef, updateFields);
            batchCount++;
            syncedCount++;

            // Commit batch every 500 operations (Firestore limit)
            if (batchCount >= 500) {
              await batch.commit();
              console.log(`Committed batch of ${batchCount} updates`);
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

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const result = {
        success: true,
        totalUsers: usersSnapshot.size,
        synced: syncedCount,
        skipped: usersSnapshot.size - syncedCount - errorCount,
        errors: errorCount,
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

