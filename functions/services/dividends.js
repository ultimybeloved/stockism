'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { getDividendTier } = require('../characters');
const { ADMIN_UID } = require('../constants');
const {
  DIVIDEND_HOLD_MS,
  DIVIDEND_RATES,
  graduateCohort,
  addPendingShares,
  writeNotification,
} = require('../helpers');

// ─── Internal ────────────────────────────────────────────────────────────────

async function runDividendPayout({ source = 'scheduled' } = {}) {
  const startedAt = Date.now();

  // Read pre-halt snapshot for prices (savePreHaltPrices writes this Thu 12:55 UTC).
  // Fall back to current market prices if the snapshot is missing.
  let snapshotPrices = {};
  const snap = await db.collection('market').doc('preHaltSnapshot').get();
  if (snap.exists) {
    snapshotPrices = snap.data().prices || {};
  } else {
    const cur = await db.collection('market').doc('current').get();
    if (cur.exists) snapshotPrices = cur.data().prices || {};
  }

  // Read tier overrides so admin can change a stock's tier without a code deploy.
  const overridesDoc = await db.collection('dividendConfig').doc('tierOverrides').get();
  const tierOverrides = overridesDoc.exists ? (overridesDoc.data().tiers || {}) : {};

  const rateFor = (ticker) => DIVIDEND_RATES[getDividendTier(ticker, tierOverrides)] || 0;

  const now = Date.now();
  const usersSnap = await db.collection('users').get();

  const stats = { usersConsidered: 0, usersPaid: 0, totalPaid: 0, tickerTotals: {} };
  const BATCH_SIZE = 400;
  let batch = db.batch();
  let pendingWrites = 0;
  const commitIfFull = async () => {
    if (pendingWrites >= BATCH_SIZE) {
      await batch.commit();
      batch = db.batch();
      pendingWrites = 0;
    }
  };

  for (const userDoc of usersSnap.docs) {
    const data = userDoc.data() || {};
    if (data.isBot) continue;
    stats.usersConsidered += 1;

    const holdings = data.holdings || {};
    const cohorts = data.holdingCohorts || {};

    let totalPaid = 0;
    const payoutsByTicker = {};
    const cohortUpdates = {};

    for (const ticker of Object.keys(holdings)) {
      const shares = holdings[ticker] || 0;
      if (shares <= 0) continue;

      const rate = rateFor(ticker);
      // Always graduate pending (even on 0-rate stocks) so cohorts stay fresh.
      const graduated = graduateCohort(cohorts[ticker], now);

      // Self-heal: if cohort sum doesn't match holdings, trust holdings.
      const cohortSum = (graduated.eligible || 0)
        + graduated.pending.reduce((s, p) => s + (p.shares || 0), 0);
      if (cohortSum !== shares) {
        // Difference is likely the backfill not yet run, or an admin edit.
        // Put any unaccounted shares into a fresh pending bucket so the 10-day
        // wait still applies (no retroactive free dividends).
        const missing = shares - cohortSum;
        if (missing > 0) {
          graduated.pending.push({ shares: missing, availableAt: now + DIVIDEND_HOLD_MS });
        } else if (missing < 0) {
          // Holdings shrank without a sell path? Trim eligible first.
          let over = -missing;
          const take = Math.min(graduated.eligible, over);
          graduated.eligible -= take;
          over -= take;
          while (over > 0 && graduated.pending.length > 0) {
            const h = graduated.pending[0];
            if (h.shares <= over) { over -= h.shares; graduated.pending.shift(); }
            else { h.shares -= over; over = 0; }
          }
        }
      }

      cohortUpdates[ticker] = graduated;

      if (rate > 0 && graduated.eligible > 0) {
        const price = snapshotPrices[ticker] || 0;
        if (price > 0) {
          const payout = Math.round(graduated.eligible * price * rate * 100) / 100;
          if (payout > 0) {
            totalPaid += payout;
            payoutsByTicker[ticker] = payout;
            stats.tickerTotals[ticker] = (stats.tickerTotals[ticker] || 0) + payout;
          }
        }
      }
    }

    // Always persist graduated cohorts so pending shares move to eligible over time.
    const updates = { holdingCohorts: cohortUpdates };

    if (totalPaid > 0) {
      updates.cash = admin.firestore.FieldValue.increment(totalPaid);

      const totalRounded = Math.round(totalPaid * 100) / 100;
      const txLogEntry = {
        type: 'DIVIDEND',
        timestamp: now,
        totalAmount: totalRounded,
        breakdown: payoutsByTicker,
      };
      updates.transactionLog = admin.firestore.FieldValue.arrayUnion(txLogEntry);

      stats.usersPaid += 1;
      stats.totalPaid += totalPaid;

      // Also write to the `trades` collection so TradeHistoryModal surfaces it.
      const tradeRef = db.collection('trades').doc();
      batch.set(tradeRef, {
        uid: userDoc.id,
        action: 'dividend',
        totalAmount: totalRounded,
        breakdown: payoutsByTicker,
        tickerCount: Object.keys(payoutsByTicker).length,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source,
      });
      pendingWrites += 1;

      // Notification — fire-and-forget (we don't want a batched transactional write here).
      writeNotification(userDoc.id, {
        type: 'dividend',
        title: `Dividends paid: $${totalPaid.toFixed(2)}`,
        message: `You earned dividends on ${Object.keys(payoutsByTicker).length} holding(s).`,
        data: { total: totalRounded, breakdown: payoutsByTicker, source },
      }).catch(err => console.error('Dividend notification failed for', userDoc.id, err));
    }

    batch.update(userDoc.ref, updates);
    pendingWrites += 1;
    await commitIfFull();
  }

  if (pendingWrites > 0) {
    await batch.commit();
  }

  const durationMs = Date.now() - startedAt;
  await db.collection('dividendConfig').doc('runs').collection('log').add({
    ranAt: admin.firestore.FieldValue.serverTimestamp(),
    source,
    durationMs,
    usersConsidered: stats.usersConsidered,
    usersPaid: stats.usersPaid,
    totalPaid: Math.round(stats.totalPaid * 100) / 100,
    tickerTotals: Object.fromEntries(
      Object.entries(stats.tickerTotals).map(([t, v]) => [t, Math.round(v * 100) / 100])
    ),
  });

  console.log(`Dividend payout (${source}) complete: ${stats.usersPaid}/${stats.usersConsidered} paid, $${stats.totalPaid.toFixed(2)} total, ${durationMs}ms`);
  return stats;
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * Weekly dividend payout — Thursday 12:58 UTC
 * Runs ~3 minutes after savePreHaltPrices captures the frozen snapshot.
 * Pays holders of 'blue-chip' / 'dividend' / ETF stocks whose shares have
 * cleared the 10-day holding period.
 */
exports.payDividends = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub
  .schedule('58 12 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await runDividendPayout({ source: 'scheduled' });
      return null;
    } catch (err) {
      console.error('payDividends failed:', err);
      return null;
    }
  });

/**
 * Admin-only manual trigger for dividend payouts. Useful for testing, or to
 * re-run if the scheduled function failed.
 */
exports.runDividendPayoutNow = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || context.auth.uid !== ADMIN_UID) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only.');
    }
    return runDividendPayout({ source: 'manual-admin' });
  });

/**
 * One-time backfill: initialize `holdingCohorts` for every existing user.
 * Grandfathers all existing shares straight into `eligible` (no 10-day wait).
 * Safe to re-run — users who already have a non-empty `holdingCohorts` are
 * skipped unless `force: true` is passed.
 */
exports.backfillHoldingCohorts = functions
  .runWith({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || context.auth.uid !== ADMIN_UID) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only.');
    }

    const force = Boolean(data && data.force);

    const usersSnap = await db.collection('users').get();
    const stats = { scanned: 0, updated: 0, skipped: 0 };

    const BATCH_SIZE = 400;
    let batch = db.batch();
    let pending = 0;

    for (const userDoc of usersSnap.docs) {
      stats.scanned += 1;
      const d = userDoc.data() || {};
      const existing = d.holdingCohorts || {};
      const hasExisting = Object.keys(existing).length > 0;

      if (hasExisting && !force) {
        stats.skipped += 1;
        continue;
      }

      const holdings = d.holdings || {};
      const cohorts = {};
      for (const [ticker, shares] of Object.entries(holdings)) {
        if (!shares || shares <= 0) continue;
        cohorts[ticker] = { eligible: shares, pending: [] };
      }

      batch.update(userDoc.ref, { holdingCohorts: cohorts });
      pending += 1;
      stats.updated += 1;

      if (pending >= BATCH_SIZE) {
        await batch.commit();
        batch = db.batch();
        pending = 0;
      }
    }

    if (pending > 0) await batch.commit();

    console.log(`Backfill complete: ${stats.updated} updated, ${stats.skipped} skipped, ${stats.scanned} scanned`);
    return stats;
  });
