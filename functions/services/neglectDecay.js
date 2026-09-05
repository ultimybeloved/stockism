'use strict';
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
const { cf } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { SHORT_INTEREST_MAX_AGE_MS, isWeeklyTradingHalt } = require('../constants');
const { priceHistoryRef, tickerStatsRef } = require('../helpers');
const { decayTarget } = require('./neglectDecayRules');

/**
 * Runs daily at 21:40 UTC.
 *
 * After dailyMarketSummary (21:00) and the archive ping (21:30) on purpose, so
 * the recorded daily close is the day's real trading rather than a number this
 * job just moved.
 */
exports.applyNeglectDecay = cf().pubsub
  .schedule('40 21 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    if (isWeeklyTradingHalt()) {
      console.log('applyNeglectDecay: skipping — weekly halt active');
      return null;
    }

    try {
      const marketRef = db.collection('market').doc('current');
      const [marketSnap, statsSnap, histSnap] = await Promise.all([
        marketRef.get(), tickerStatsRef().get(), priceHistoryRef().get(),
      ]);

      if (!marketSnap.exists) {
        console.log('applyNeglectDecay: no market document');
        return null;
      }
      const marketData = marketSnap.data();
      if (marketData.marketHalted) {
        console.log('applyNeglectDecay: skipping — manual halt active');
        return null;
      }

      const now = Date.now();
      const stats = statsSnap.exists ? (statsSnap.data() || {}) : {};
      const shortInterest = stats.shortInterest || {};
      const measuredAt = stats.shortInterestAt || 0;

      // Decaying on a stale "nobody is short" reading is the exact hole the
      // pause exists to close, so a stale reading skips the run entirely.
      if (now - measuredAt > SHORT_INTEREST_MAX_AGE_MS) {
        console.warn(`applyNeglectDecay: short interest is stale (${Math.round((now - measuredAt) / 60000)} min old) — skipping`);
        return null;
      }

      const prices = marketData.prices || {};
      const priceHistory = histSnap.exists ? (histSnap.data() || {}) : {};

      const updates = {};
      const historyPoints = {};
      const moved = [];

      for (const character of CHARACTERS) {
        const target = decayTarget({
          character,
          price: prices[character.ticker],
          stats: stats[character.ticker],
          shortInterest,
          priceHistory,
          now,
        });
        if (target === null) continue;

        updates[`prices.${character.ticker}`] = target;
        // Tagged, and this matters: an untagged point is read as a real player
        // trade by the review-change classifier on both the client and here.
        historyPoints[character.ticker] = { timestamp: now, price: target, source: 'decay' };
        moved.push(`${character.ticker} ${prices[character.ticker]}->${target}`);
      }

      if (!moved.length) {
        console.log('applyNeglectDecay: nothing neglected');
        return null;
      }

      const batch = db.batch();
      batch.update(marketRef, updates);
      const histUpdates = {};
      for (const [t, point] of Object.entries(historyPoints)) {
        histUpdates[t] = admin.firestore.FieldValue.arrayUnion(point);
      }
      batch.set(priceHistoryRef(), histUpdates, { merge: true });
      await batch.commit();

      console.log(`applyNeglectDecay: ${moved.length} stocks decayed — ${moved.join(', ')}`);
      return null;
    } catch (err) {
      console.error('applyNeglectDecay error:', err);
      return null;
    }
  });
