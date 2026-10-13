import { cf, requireAdmin } from '../shared/fnConfig';
import { withAdminLog } from '../shared/adminLog';
import * as admin from 'firebase-admin';
import { FieldValue, type DocumentData, type DocumentReference } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import {
  CHARACTERS,
  computeRarityTiers,
  getDividendRate,
  dividendWeightedShares,
  DIVIDEND_HOLD_MS,
} from '../shared/characters';
import { graduateCohort } from '../shared/cohorts';
import type { Cohort, TxLogEntry } from '../shared/types';
import { writeNotification } from '../shared/notifications';
import { reportError } from '../shared/sentry';
import { recordHeartbeat } from '../shared/activity';
import { grantedValueUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';

// ─── Internal ────────────────────────────────────────────────────────────────

// The Thursday (UTC date) that starts the dividend week containing `now`. Every
// run in the same week shares it, so a re-run can't pay anyone twice. A manual
// run earlier on a Thursday than the 12:58 schedule claims that week too.
export const dividendWeekKey = (now: number): string => {
  const d = new Date(now);
  const daysSinceThursday = (d.getUTCDay() - 4 + 7) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - daysSinceThursday))
    .toISOString()
    .slice(0, 10);
};

export interface DividendResult {
  cohortUpdates: Record<string, Cohort>;
  holdingIncrements: Record<string, number>;
  payoutsByTicker: Record<string, number>;
  reinvestedBreakdown: Record<string, { shares: number; value: number }>;
  tickerTotals: Record<string, number>;
  totalPaid: number;
  totalReinvested: number;
  grantedTotal: number;
}

// One player's payout, worked out from their current doc. Pure: no reads or writes.
export function computeDividend(
  data: DocumentData,
  now: number,
  snapshotPrices: Record<string, number>,
  rateFor: (ticker: string) => number,
): DividendResult {
  const holdings: Record<string, number> = data.holdings || {};
  const cohorts: Record<string, Cohort> = data.holdingCohorts || {};
  const drip: Record<string, boolean> = data.drip || {};

  const r: DividendResult = {
    cohortUpdates: {},
    holdingIncrements: {},
    payoutsByTicker: {},
    reinvestedBreakdown: {},
    tickerTotals: {},
    totalPaid: 0,
    totalReinvested: 0,
    grantedTotal: 0,
  };

  for (const ticker of Object.keys(holdings)) {
    const shares = holdings[ticker] || 0;
    if (shares <= 0) continue;

    const rate = rateFor(ticker);
    // Always graduate pending (even on 0-rate stocks) so cohorts stay fresh.
    const graduated = graduateCohort(cohorts[ticker], now);

    // Self-heal: if cohort sum doesn't match holdings, trust holdings.
    // Compare rounded to 4 dp — share math is floating point, and epsilon
    // noise would otherwise spawn a phantom pending bucket every run.
    const cohortSum = (graduated.eligible || 0) + graduated.pending.reduce((s, p) => s + (p.shares || 0), 0);
    const missing = Math.round((shares - cohortSum) * 10000) / 10000;
    if (missing > 0) {
      // Difference is likely the backfill not yet run, or an admin edit.
      // Put any unaccounted shares into a fresh pending bucket so the 10-day
      // wait still applies (no retroactive free dividends).
      graduated.pending.push({ shares: missing, availableAt: now + DIVIDEND_HOLD_MS });
    } else if (missing < 0) {
      // Holdings shrank without a sell path? Trim eligible first.
      let over = -missing;
      const take = Math.min(graduated.eligible, over);
      graduated.eligible -= take;
      over -= take;
      while (over > 0 && graduated.pending.length > 0) {
        const h = graduated.pending[0]!;
        if (h.shares <= over) {
          over -= h.shares;
          graduated.pending.shift();
        } else {
          h.shares -= over;
          over = 0;
        }
      }
    }

    r.cohortUpdates[ticker] = graduated;

    // Loyalty-weighted share count: matured `eligible` aged from the ladder
    // epoch (see dividendWeightedShares in characters.ts), each pending lot
    // at its own rung (0 while inside the hold gate).
    const weightedShares = dividendWeightedShares(graduated, now);
    if (!(rate > 0 && weightedShares > 0)) continue;
    const price = snapshotPrices[ticker] || 0;
    if (!(price > 0)) continue;
    const payout = Math.round(weightedShares * price * rate * 100) / 100;
    if (!(payout > 0)) continue;

    r.tickerTotals[ticker] = (r.tickerTotals[ticker] || 0) + payout;
    // A dividend is a faucet, not a return. The shares appear at an admin-set
    // rate and never move a price, so every holder's portfolio grows while the
    // index stands still — on a percent board that reads as beating the market
    // for doing nothing, and the loyalty ladder pays MOST to whoever trades
    // least. Booked so season and percent returns net it out. Whole payout,
    // cash and DRIP alike: free shares are still free money.
    r.grantedTotal += payout;
    if (drip[ticker]) {
      // DRIP: buy shares instead of paying cash
      const sharesToAdd = Math.floor((payout / price) * 100) / 100;
      const cashRemainder = Math.round((payout - sharesToAdd * price) * 100) / 100;
      if (sharesToAdd > 0) {
        r.holdingIncrements[ticker] = sharesToAdd;
        graduated.pending.push({ shares: sharesToAdd, availableAt: now + DIVIDEND_HOLD_MS });
        r.reinvestedBreakdown[ticker] = { shares: sharesToAdd, value: payout };
        r.totalReinvested += payout;
      }
      if (cashRemainder > 0) {
        r.totalPaid += cashRemainder;
        r.payoutsByTicker[ticker] = cashRemainder;
      }
    } else {
      r.totalPaid += payout;
      r.payoutsByTicker[ticker] = payout;
    }
  }
  return r;
}

async function runDividendPayout({ source = 'scheduled' } = {}) {
  const startedAt = Date.now();

  // Read pre-halt snapshot for prices (savePreHaltPrices writes this Thu 12:55 UTC).
  // Fall back to current market prices if the snapshot is missing.
  let snapshotPrices: Record<string, number> = {};
  const snap = await db.collection('market').doc('preHaltSnapshot').get();
  if (snap.exists) {
    snapshotPrices = snap.data()!.prices || {};
  } else {
    const cur = await db.collection('market').doc('current').get();
    if (cur.exists) snapshotPrices = cur.data()!.prices || {};
  }

  // Read tier overrides so admin can change a stock's tier without a code deploy.
  const overridesDoc = await db.collection('dividendConfig').doc('tierOverrides').get();
  const tierOverrides = overridesDoc.exists ? overridesDoc.data()!.tiers || {} : {};

  // Base yield follows market standing: rank the roster on the same frozen
  // snapshot the payout prices come from.
  const rarityTiers = computeRarityTiers(CHARACTERS, snapshotPrices);
  const rateFor = (ticker: string) => getDividendRate(ticker, rarityTiers, tierOverrides);

  const now = Date.now();
  // One payout per week per player, however many times this runs. A run that
  // dies halfway gets re-run by hand; without this stamp everyone the first run
  // already reached was paid twice.
  const week = dividendWeekKey(now);
  // Only the ids are used from this read. Each player is re-read inside their own
  // transaction, because the run starts before the 13:00 halt: a trade at 12:59
  // used to be overwritten by a stale copy of the player's cohorts and log.
  const usersSnap = await db.collection('users').select().get();

  const stats = {
    usersConsidered: 0,
    usersPaid: 0,
    usersSkippedAlreadyPaid: 0,
    usersFailed: 0,
    totalPaid: 0,
    totalReinvested: 0,
    tickerTotals: {} as Record<string, number>,
  };

  const payOne = async (userRef: DocumentReference) => {
    const result = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) return null; // deleted since the scan
      const data = userSnap.data() || {};
      // Banned accounts had their holdings wiped and earn nothing further.
      if (data.isBot || data.isBanned) return null;
      if (data.lastDividendWeek === week) return { alreadyPaid: true as const };

      const payout = computeDividend(data, now, snapshotPrices, rateFor);
      // Always persist graduated cohorts so pending shares move to eligible over time.
      const updates: Record<string, unknown> = { holdingCohorts: payout.cohortUpdates, lastDividendWeek: week };
      for (const [ticker, sharesToAdd] of Object.entries(payout.holdingIncrements)) {
        updates[`holdings.${ticker}`] = FieldValue.increment(sharesToAdd);
      }
      Object.assign(updates, grantedValueUpdate(payout.grantedTotal));

      const hasCashPayout = payout.totalPaid > 0;
      const hasDrip = Object.keys(payout.reinvestedBreakdown).length > 0;
      const totalRounded = Math.round(payout.totalPaid * 100) / 100;
      if (hasCashPayout || hasDrip) {
        if (hasCashPayout) updates.cash = FieldValue.increment(payout.totalPaid);
        const txLogEntry = {
          type: 'DIVIDEND',
          timestamp: now,
          totalAmount: totalRounded,
          breakdown: payout.payoutsByTicker,
          ...(hasDrip && { reinvestedBreakdown: payout.reinvestedBreakdown }),
        };
        // Same 100-entry cap every other writer applies (tradeState, dailyCheckin,
        // botTrader). An arrayUnion here never trimmed, so a holder who never
        // traded grew their user doc every week forever.
        updates.transactionLog = [...((data.transactionLog as TxLogEntry[]) || []), txLogEntry].slice(-100);

        // Also write to the `trades` collection so TradeHistoryModal surfaces it.
        const tradeRef = db.collection('trades').doc();
        tx.set(tradeRef, {
          uid: userRef.id,
          action: 'dividend',
          totalAmount: totalRounded,
          breakdown: payout.payoutsByTicker,
          tickerCount: Object.keys(payout.payoutsByTicker).length,
          ...(hasDrip && { reinvested: payout.reinvestedBreakdown }),
          timestamp: FieldValue.serverTimestamp(),
          source,
        });
        if (hasCashPayout) {
          recordLedger(tx, {
            uid: userRef.id,
            type: 'dividend',
            amount: payout.totalPaid,
            ref: `trades/${tradeRef.id}`,
            detail: { source, week },
          });
        }
        // DRIP shares are handed out without a trade, so they get a shares entry
        // the way the daily drop does.
        for (const [ticker, drip] of Object.entries(payout.reinvestedBreakdown)) {
          recordLedger(tx, {
            uid: userRef.id,
            type: 'dividend_drip',
            account: 'shares',
            amount: drip.value,
            ref: ticker,
            detail: { shares: drip.shares, week },
          });
        }
      }
      tx.update(userRef, updates);
      return { alreadyPaid: false as const, payout, hasCashPayout, hasDrip, totalRounded };
    });

    if (!result) return;
    stats.usersConsidered += 1;
    if (result.alreadyPaid) {
      stats.usersSkippedAlreadyPaid += 1;
      return;
    }
    const { payout, hasCashPayout, hasDrip, totalRounded } = result;
    for (const [t, v] of Object.entries(payout.tickerTotals)) stats.tickerTotals[t] = (stats.tickerTotals[t] || 0) + v;
    stats.totalReinvested += payout.totalReinvested;
    if (!hasCashPayout && !hasDrip) return;
    stats.usersPaid += 1;
    stats.totalPaid += payout.totalPaid;

    // Notification — fire-and-forget, only once the payout has committed.
    const dripCount = Object.keys(payout.reinvestedBreakdown).length;
    const cashCount = Object.keys(payout.payoutsByTicker).length;
    const notifParts = [];
    if (hasCashPayout) notifParts.push(`$${totalRounded.toFixed(2)} cash`);
    if (hasDrip) notifParts.push(`${dripCount} DRIP reinvestment${dripCount > 1 ? 's' : ''}`);
    writeNotification(userRef.id, {
      type: 'dividend',
      title: `Dividends paid`,
      message: notifParts.join(' + ') + ` across ${cashCount + dripCount} holding(s).`,
      data: {
        total: totalRounded,
        breakdown: payout.payoutsByTicker,
        reinvestedBreakdown: payout.reinvestedBreakdown,
        source,
      },
    }).catch((err) => reportError(err, { where: 'payDividends.notification', uid: userRef.id }));
  };

  // A few players at a time, one transaction each, so a failure (an account
  // deleted mid-run, contention) costs that player alone instead of the run.
  const CONCURRENCY = 10;
  const refs = usersSnap.docs.map((d) => d.ref);
  for (let i = 0; i < refs.length; i += CONCURRENCY) {
    await Promise.all(
      refs.slice(i, i + CONCURRENCY).map((ref) =>
        payOne(ref).catch((err) => {
          stats.usersFailed += 1;
          reportError(err, { where: 'payDividends.user', uid: ref.id });
        }),
      ),
    );
  }

  const durationMs = Date.now() - startedAt;
  await db
    .collection('dividendConfig')
    .doc('runs')
    .collection('log')
    .add({
      ranAt: FieldValue.serverTimestamp(),
      source,
      week,
      durationMs,
      usersConsidered: stats.usersConsidered,
      usersPaid: stats.usersPaid,
      usersSkippedAlreadyPaid: stats.usersSkippedAlreadyPaid,
      usersFailed: stats.usersFailed,
      totalPaid: Math.round(stats.totalPaid * 100) / 100,
      totalReinvested: Math.round(stats.totalReinvested * 100) / 100,
      tickerTotals: Object.fromEntries(
        Object.entries(stats.tickerTotals).map(([t, v]) => [t, Math.round(v * 100) / 100]),
      ),
    });

  logger.info(
    `Dividend payout (${source}) week ${week}: ${stats.usersPaid}/${stats.usersConsidered} paid, ${stats.usersSkippedAlreadyPaid} already paid, ${stats.usersFailed} failed, $${stats.totalPaid.toFixed(2)} total, ${durationMs}ms`,
  );
  if (stats.usersFailed > 0) {
    // Surfaced so a partial run gets noticed; a re-run pays only the ones missed.
    reportError(new Error(`Dividend payout: ${stats.usersFailed} players failed`), { where: 'payDividends', week });
  }
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
export const payDividends = cf({ timeoutSeconds: 540, memory: '512MB' })
  .pubsub.schedule('58 12 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await runDividendPayout({ source: 'scheduled' });
      await recordHeartbeat('payDividends');
      return null;
    } catch (err) {
      // Scheduled and unattended: without this a whole payout run can be
      // skipped with nothing to show for it.
      reportError(err, { where: 'payDividends' });
      return null;
    }
  });

/**
 * Admin-only manual trigger for dividend payouts. Safe to re-run if the
 * scheduled run failed: players already paid this week are skipped.
 */
export const runDividendPayoutNow = cf({ timeoutSeconds: 540, memory: '512MB' }).https.onCall(
  withAdminLog('run_dividend_payout_now', async (data, context) => {
    requireAdmin(context, 'Admin only.');
    return runDividendPayout({ source: 'manual-admin' });
  }),
);

/**
 * One-time backfill: initialize `holdingCohorts` for every existing user.
 * Grandfathers all existing shares straight into `eligible` (no 10-day wait).
 * Safe to re-run — users who already have a non-empty `holdingCohorts` are
 * skipped unless `force: true` is passed.
 */
export const backfillHoldingCohorts = cf({ timeoutSeconds: 540, memory: '512MB' }).https.onCall(
  async (data, context) => {
    requireAdmin(context, 'Admin only.');

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

      const holdings: Record<string, number> = d.holdings || {};
      const cohorts: Record<string, Cohort> = {};
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

    logger.info(`Backfill complete: ${stats.updated} updated, ${stats.skipped} skipped, ${stats.scanned} scanned`);
    return stats;
  },
);
