// Neglect decay: stocks no real player trades slowly drift down.
//
// Before this, a stock nobody touched simply sat at whatever price it was last
// left at forever. Nothing in the game ever went down on its own, so there was
// no way for the market to fall.
//
// Three things make this safe rather than just destructive:
//
// 1. IT PAUSES ON OPEN SHORT INTEREST. A predictable daily decline would
//    otherwise be a risk-free printer: short a stock nobody will ever trade,
//    wait, cover. Pausing while anyone is short makes the farm cancel itself —
//    setting it up is the thing that switches the decay off.
//
// 2. THE FLOOR IS NOT A ROUND NUMBER. Each character stops at its own fraction
//    of basePrice, drawn from a hash. A fixed percentage would be public the
//    first time someone noticed two dead stocks halting at the same level.
//
// 3. IT NEVER PUSHES A PRICE UP. The floor is a clamp on the target, so a
//    recomputed floor landing above the current price simply stops the decay
//    rather than handing holders a free gain.
//
// Deliberately does NOT propagate through trailing factors. Those link
// characters to each other (the GAP/JIN/SHNG triangle among them), so a
// neglected character would drag live ones down every single day. The knock-on
// consequence is that funds do not drift down when their members do; that is a
// known gap, not an oversight.
import { cf } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { CHARACTERS } from '../shared/characters';
import { SHORT_INTEREST_MAX_AGE_MS, isWeeklyTradingHalt } from '../shared/constants';
import { priceHistoryRef, tickerStatsRef } from '../shared/marketData';
import { recordHeartbeat } from '../shared/activity';
import type { PricePoint } from '../shared/types';
import { decayTarget } from './neglectDecayRules';

/**
 * Runs daily at 21:40 UTC.
 *
 * After dailyMarketSummary (21:00) and the archive ping (21:30) on purpose, so
 * the recorded daily close is the day's real trading rather than a number this
 * job just moved.
 */
export const applyNeglectDecay = cf()
  .pubsub.schedule('40 21 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    if (isWeeklyTradingHalt()) {
      logger.info('applyNeglectDecay: skipping — weekly halt active');
      return null;
    }

    try {
      const marketRef = db.collection('market').doc('current');
      const [marketSnap, statsSnap, histSnap] = await Promise.all([
        marketRef.get(),
        tickerStatsRef().get(),
        priceHistoryRef().get(),
      ]);

      if (!marketSnap.exists) {
        logger.info('applyNeglectDecay: no market document');
        return null;
      }
      const marketData = marketSnap.data()!;
      if (marketData.marketHalted) {
        logger.info('applyNeglectDecay: skipping — manual halt active');
        return null;
      }

      const now = Date.now();
      const stats = statsSnap.exists ? statsSnap.data() || {} : {};
      const shortInterest = stats.shortInterest || {};
      const measuredAt = stats.shortInterestAt || 0;

      // Decaying on a stale "nobody is short" reading is the exact hole the
      // pause exists to close, so a stale reading skips the run entirely.
      if (now - measuredAt > SHORT_INTEREST_MAX_AGE_MS) {
        logger.warn(
          `applyNeglectDecay: short interest is stale (${Math.round((now - measuredAt) / 60000)} min old) — skipping`,
        );
        return null;
      }

      // First run establishes when neglect tracking began and decays nothing.
      // Nothing can be called neglected before we were watching it.
      if (!stats.neglectTrackingStartedAt) {
        await tickerStatsRef().set({ neglectTrackingStartedAt: now }, { merge: true });
        logger.info('applyNeglectDecay: tracking start recorded, no decay on the first run');
        return null;
      }

      const prices: Record<string, number> = marketData.prices || {};
      const priceHistory = histSnap.exists ? histSnap.data() || {} : {};

      const updates: Record<string, number> = {};
      const historyPoints: Record<string, PricePoint> = {};
      const moved: string[] = [];

      for (const character of CHARACTERS) {
        const target = decayTarget({
          character,
          price: prices[character.ticker],
          stats: stats[character.ticker],
          shortInterest,
          priceHistory,
          now,
          trackingStartedAt: stats.neglectTrackingStartedAt,
          haltedTickers: marketData.haltedTickers,
        });
        if (target === null) continue;

        updates[`prices.${character.ticker}`] = target;
        // Tagged, and this matters: an untagged point is read as a real player
        // trade by the review-change classifier on both the client and here.
        historyPoints[character.ticker] = { timestamp: now, price: target, source: 'decay' };
        moved.push(`${character.ticker} ${prices[character.ticker]}->${target}`);
      }

      if (!moved.length) {
        logger.info('applyNeglectDecay: nothing neglected');
        return null;
      }

      const batch = db.batch();
      batch.update(marketRef, updates);
      const histUpdates: Record<string, admin.firestore.FieldValue> = {};
      for (const [t, point] of Object.entries(historyPoints)) {
        histUpdates[t] = admin.firestore.FieldValue.arrayUnion(point);
      }
      batch.set(priceHistoryRef(), histUpdates, { merge: true });
      await batch.commit();

      logger.info(`applyNeglectDecay: ${moved.length} stocks decayed — ${moved.join(', ')}`);
      await recordHeartbeat('applyNeglectDecay');
      return null;
    } catch (err) {
      logger.error('applyNeglectDecay error:', err);
      return null;
    }
  });
