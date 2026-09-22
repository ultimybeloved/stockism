'use strict';

const { cf } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  MAX_PRICE_CHANGE_PERCENT,
  MIN_PRICE,
  ADMIN_PRICE_PROTECTION_MS,
  isWeeklyTradingHalt,
} = require('../constants');
const {
  calculateMarginalImpact, isPriceProtected, isTickerPaused, priceHistoryRef,
  dailyClosesRef, monthIdOf, round2,
} = require('../helpers');

// Trigger if price deviates more than 12% from the 7-day rolling average
const DEVIATION_THRESHOLD = 0.12;
// Intervention size: 6 shares per cycle
const INTERVENTION_SHARES = 6;
// How many daily closes the reference price averages over.
const LOOKBACK_DAYS = 7;
// Below this many closes a ticker has no trustworthy baseline yet (new
// character, or a gap in the daily summary), so it is left alone.
const MIN_CLOSE_DAYS = 3;

// Non-ETF tickers eligible for market maker stabilization
const NON_ETF_TICKERS = new Set(
  CHARACTERS.filter((c) => !c.isETF).map((c) => c.ticker)
);

/**
 * The reference price each ticker is measured against: the mean of its last
 * LOOKBACK_DAYS daily closes.
 *
 * This deliberately does NOT read market/priceHistory. That doc holds the most
 * recent PRICE_HISTORY_LIVE_MAX points per ticker regardless of when they
 * happened, so on a busy stock "the last 7 days" collapsed into the last few
 * hours, and every trade a player made was another vote on the yardstick they
 * were being measured against. Twenty trades in an afternoon could drag the
 * reference down with the price and switch the stabiliser off exactly when it
 * was needed. Daily closes give every day one vote, so bending the reference
 * now costs real days instead of volume.
 *
 * Returns { [ticker]: avgPrice }. Tickers with too little history are absent.
 */
const buildReferencePrices = async (now) => {
  // Two months so a lookback that straddles the 1st still sees a full week.
  const monthIds = [...new Set([monthIdOf(now - LOOKBACK_DAYS * 86400000), monthIdOf(now)])];
  const snaps = await Promise.all(monthIds.map((m) => dailyClosesRef(m).get()));

  // { 'YYYY-MM-DD': { ticker: price } }, newest day last.
  const byDay = {};
  for (const snap of snaps) {
    if (!snap.exists) continue;
    Object.assign(byDay, snap.data().closes || {});
  }
  const days = Object.keys(byDay).sort().slice(-LOOKBACK_DAYS);
  if (!days.length) return {};

  const sums = {};
  for (const d of days) {
    for (const [ticker, price] of Object.entries(byDay[d] || {})) {
      if (!(price > 0)) continue;
      const s = sums[ticker] || (sums[ticker] = { total: 0, n: 0 });
      s.total += price;
      s.n += 1;
    }
  }

  const refs = {};
  for (const [ticker, { total, n }] of Object.entries(sums)) {
    if (n >= MIN_CLOSE_DAYS) refs[ticker] = total / n;
  }
  return refs;
};

/**
 * Runs hourly. For each non-ETF ticker, compares the live price to the mean of
 * its last 7 daily closes and nudges it back if it has drifted more than 12% in
 * either direction. Uses the same marginal-impact formula as real trades so the
 * correction is proportionate and can't overshoot.
 */
exports.marketMakerCycle = cf().pubsub
  .schedule('0 * * * *')
  .timeZone('UTC')
  .onRun(async () => {
    // Never run during the weekly Thursday halt (13:00–21:00 UTC)
    if (isWeeklyTradingHalt()) {
      console.log('marketMakerCycle: skipping — weekly halt active');
      return null;
    }

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.log('marketMakerCycle: no market document found');
        return null;
      }

      const marketData = marketSnap.data();
      if (marketData.marketHalted) {
        console.log('marketMakerCycle: skipping — manual halt active');
        return null;
      }

      const prices = marketData.prices || {};
      const historySnap = await priceHistoryRef().get();
      const priceHistory = historySnap.exists ? (historySnap.data() || {}) : {};

      const now = Date.now();
      const referencePrices = await buildReferencePrices(now);
      if (!Object.keys(referencePrices).length) {
        // No daily closes yet. Stabilising against the live history instead is
        // what this function was changed to stop doing, so do nothing and say
        // so rather than fall back to a reference a player can bend.
        console.warn('marketMakerCycle: no daily closes available — skipping cycle');
        return null;
      }

      const updates = {};
      const historyPoints = {};
      let interventionCount = 0;

      for (const ticker of NON_ETF_TICKERS) {
        const currentPrice = prices[ticker];
        if (!currentPrice || currentPrice <= 0) continue;

        // Respect the circuit breaker — a paused ticker is closed to everyone
        // else, and stabilising it mid-pause moves the very price the pause is
        // meant to hold still. The next cycle picks it up.
        if (isTickerPaused(marketData.haltedTickers, ticker, now)) {
          continue;
        }

        // Don't claw back a recent admin price adjustment
        if (isPriceProtected(priceHistory, ticker, ADMIN_PRICE_PROTECTION_MS, now)) {
          continue;
        }

        const avgPrice = referencePrices[ticker];
        if (!avgPrice || avgPrice <= 0) continue; // no trustworthy baseline yet

        const deviation = (currentPrice - avgPrice) / avgPrice;

        if (Math.abs(deviation) < DEVIATION_THRESHOLD) continue; // within normal range

        // Positive deviation → price too high → market maker sells (pushes price down)
        // Negative deviation → price too low → market maker buys (pushes price up)
        const isSell = deviation > 0;

        const impact = calculateMarginalImpact(currentPrice, INTERVENTION_SHARES, 0);
        const clampedImpact = Math.min(
          impact,
          currentPrice * MAX_PRICE_CHANGE_PERCENT
        );

        let newPrice;
        if (isSell) {
          newPrice = Math.max(MIN_PRICE, currentPrice - clampedImpact);
        } else {
          newPrice = currentPrice + clampedImpact;
        }

        // Safety: never overshoot the average on a single intervention
        if (isSell) {
          newPrice = Math.max(newPrice, avgPrice);
        } else {
          newPrice = Math.min(newPrice, avgPrice);
        }

        // To the cent, like every other price writer. This was the one that
        // did not, and it left values such as 75.83813448773768 sitting in the
        // price map and on the chart — every downstream portfolio value and
        // leaderboard position was then computed on a sub-cent price until the
        // next real trade rounded it off.
        newPrice = round2(newPrice);

        // Only write if the price actually changed
        if (newPrice === currentPrice) continue;

        updates[`prices.${ticker}`] = newPrice;
        historyPoints[ticker] = {
          timestamp: now,
          price: newPrice,
          source: 'market_maker',
        };

        interventionCount++;
        console.log(
          `marketMakerCycle: ${ticker} ${isSell ? 'SELL' : 'BUY'} ` +
          `avg=${avgPrice.toFixed(2)} cur=${currentPrice.toFixed(2)} ` +
          `dev=${(deviation * 100).toFixed(1)}% new=${newPrice.toFixed(2)}`
        );
      }

      if (interventionCount > 0) {
        // Batch so the price change and its history point land atomically
        const batch = db.batch();
        batch.update(marketRef, updates);
        const histUpdates = {};
        for (const [t, p] of Object.entries(historyPoints)) {
          histUpdates[t] = admin.firestore.FieldValue.arrayUnion(p);
        }
        batch.set(priceHistoryRef(), histUpdates, { merge: true });
        await batch.commit();
        console.log(`marketMakerCycle: ${interventionCount} interventions applied`);
      } else {
        console.log('marketMakerCycle: no interventions needed');
      }

      return null;
    } catch (err) {
      console.error('marketMakerCycle error:', err);
      return null;
    }
  });
