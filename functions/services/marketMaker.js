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
  ONE_WEEK_MS,
  ADMIN_PRICE_PROTECTION_MS,
  isWeeklyTradingHalt,
} = require('../constants');
const { calculateMarginalImpact, isPriceProtected } = require('../helpers');

// Trigger if price deviates more than 12% from the 7-day rolling average
const DEVIATION_THRESHOLD = 0.12;
// Intervention size: 6 shares per cycle
const INTERVENTION_SHARES = 6;
// Only look back 7 days for the rolling average
const SEVEN_DAYS_MS = ONE_WEEK_MS;

// Non-ETF tickers eligible for market maker stabilization
const NON_ETF_TICKERS = new Set(
  CHARACTERS.filter((c) => !c.isETF).map((c) => c.ticker)
);

/**
 * Runs every 15 minutes. For each non-ETF ticker, computes a 7-day rolling
 * average price and nudges the current price toward it if it has drifted more
 * than 12% in either direction. Uses the same marginal-impact formula as real
 * trades so the correction is proportionate and can't overshoot.
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
      const priceHistory = marketData.priceHistory || {};

      const now = Date.now();
      const cutoff = now - SEVEN_DAYS_MS;

      const updates = {};
      let interventionCount = 0;

      for (const ticker of NON_ETF_TICKERS) {
        const currentPrice = prices[ticker];
        if (!currentPrice || currentPrice <= 0) continue;

        // Don't claw back a recent admin price adjustment
        if (isPriceProtected(priceHistory, ticker, ADMIN_PRICE_PROTECTION_MS, now)) {
          continue;
        }

        const history = (priceHistory[ticker] || []).filter(
          (h) => h.timestamp >= cutoff
        );
        if (history.length < 2) continue; // not enough history to compute a trend

        const avgPrice =
          history.reduce((sum, h) => sum + h.price, 0) / history.length;
        if (avgPrice <= 0) continue;

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

        // Only write if the price actually changed
        if (newPrice === currentPrice) continue;

        updates[`prices.${ticker}`] = newPrice;
        updates[`priceHistory.${ticker}`] = admin.firestore.FieldValue.arrayUnion({
          timestamp: now,
          price: newPrice,
          source: 'market_maker',
        });

        interventionCount++;
        console.log(
          `marketMakerCycle: ${ticker} ${isSell ? 'SELL' : 'BUY'} ` +
          `avg=${avgPrice.toFixed(2)} cur=${currentPrice.toFixed(2)} ` +
          `dev=${(deviation * 100).toFixed(1)}% new=${newPrice.toFixed(2)}`
        );
      }

      if (interventionCount > 0) {
        await marketRef.update(updates);
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
