'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const {
  CHARACTERS,
  computeRarityTiers,
  getDividendRate,
  dividendWeightedShares,
} = require('../characters');
const { ADMIN_UID } = require('../constants');
const {
  DIVIDEND_HOLD_MS,
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

  // Base yield follows market standing: rank the roster on the same frozen
  // snapshot the payout prices come from.
  const rarityTiers = computeRarityTiers(CHARACTERS, snapshotPrices);
  const rateFor = (ticker) => getDividendRate(ticker, rarityTiers, tierOverrides);

  const now = Date.now();
  const usersSnap = await db.collection('users').get();

  const stats = { usersConsidered: 0, usersPaid: 0, totalPaid: 0, totalReinvested: 0, tickerTotals: {} };
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
    const drip = data.drip || {};

    let totalPaid = 0;
    const payoutsByTicker = {};
    const reinvestedBreakdown = {};
    const cohortUpdates = {};
    const holdingIncrements = {};

    for (const ticker of Object.keys(holdings)) {
      const shares = holdings[ticker] || 0;
      if (shares <= 0) continue;

      const rate = rateFor(ticker);
      // Always graduate pending (even on 0-rate stocks) so cohorts stay fresh.
      const graduated = graduateCohort(cohorts[ticker], now);

      // Self-heal: if cohort sum doesn't match holdings, trust holdings.
      // Compare rounded to 4 dp — share math is floating point, and epsilon
      // noise would otherwise spawn a phantom pending bucket every run.
      const cohortSum = (graduated.eligible || 0)
        + graduated.pending.reduce((s, p) => s + (p.shares || 0), 0);
      const missing = Math.round((shares - cohortSum) * 10000) / 10000;
      if (missing !== 0) {
        // Difference is likely the backfill not yet run, or an admin edit.
        // Put any unaccounted shares into a fresh pending bucket so the 10-day
        // wait still applies (no retroactive free dividends).
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

      // Loyalty-weighted share count: matured `eligible` at the top multiplier,
      // each pending lot at its own rung (0 while inside the hold gate).
      const weightedShares = dividendWeightedShares(graduated, now);
      if (rate > 0 && weightedShares > 0) {
        const price = snapshotPrices[ticker] || 0;
        if (price > 0) {
          const payout = Math.round(weightedShares * price * rate * 100) / 100;
          if (payout > 0) {
            stats.tickerTotals[ticker] = (stats.tickerTotals[ticker] || 0) + payout;
            if (drip[ticker] && price > 0) {
              // DRIP: buy shares instead of paying cash
              const sharesToAdd = Math.floor((payout / price) * 100) / 100;
              const cashRemainder = Math.round((payout - sharesToAdd * price) * 100) / 100;
              if (sharesToAdd > 0) {
                holdingIncrements[ticker] = sharesToAdd;
                graduated.pending.push({ shares: sharesToAdd, availableAt: now + DIVIDEND_HOLD_MS });
                reinvestedBreakdown[ticker] = { shares: sharesToAdd, value: payout };
                stats.totalReinvested += payout;
              }
              if (cashRemainder > 0) {
                totalPaid += cashRemainder;
                payoutsByTicker[ticker] = cashRemainder;
              }
            } else {
              totalPaid += payout;
              payoutsByTicker[ticker] = payout;
            }
          }
        }
      }
    }

    // Always persist graduated cohorts so pending shares move to eligible over time.
    const updates = { holdingCohorts: cohortUpdates };

    // Apply DRIP holding increments
    for (const [ticker, sharesToAdd] of Object.entries(holdingIncrements)) {
      updates[`holdings.${ticker}`] = admin.firestore.FieldValue.increment(sharesToAdd);
    }

    const hasCashPayout = totalPaid > 0;
    const hasDrip = Object.keys(reinvestedBreakdown).length > 0;

    if (hasCashPayout || hasDrip) {
      if (hasCashPayout) {
        updates.cash = admin.firestore.FieldValue.increment(totalPaid);
      }

      const totalRounded = Math.round(totalPaid * 100) / 100;
      const txLogEntry = {
        type: 'DIVIDEND',
        timestamp: now,
        totalAmount: totalRounded,
        breakdown: payoutsByTicker,
        ...(hasDrip && { reinvestedBreakdown }),
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
        ...(hasDrip && { reinvested: reinvestedBreakdown }),
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        source,
      });
      pendingWrites += 1;

      // Notification — fire-and-forget
      const dripCount = Object.keys(reinvestedBreakdown).length;
      const cashCount = Object.keys(payoutsByTicker).length;
      const notifParts = [];
      if (hasCashPayout) notifParts.push(`$${totalRounded.toFixed(2)} cash`);
      if (hasDrip) notifParts.push(`${dripCount} DRIP reinvestment${dripCount > 1 ? 's' : ''}`);
      writeNotification(userDoc.id, {
        type: 'dividend',
        title: `Dividends paid`,
        message: notifParts.join(' + ') + ` across ${cashCount + dripCount} holding(s).`,
        data: { total: totalRounded, breakdown: payoutsByTicker, reinvestedBreakdown, source },
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
    totalReinvested: Math.round(stats.totalReinvested * 100) / 100,
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
 * Every stock pays: base yield from its market-standing tier (ETFs flat),
 * multiplied per purchase lot by the loyalty ladder once the lot clears the
 * 10-day holding period.
 */
exports.payDividends = cf({ timeoutSeconds: 540, memory: '512MB' })
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
exports.runDividendPayoutNow = cf({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
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
exports.backfillHoldingCohorts = cf({ timeoutSeconds: 540, memory: '512MB' })
  .https.onCall(async (data, context) => {
    requireAppCheck(context);
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
