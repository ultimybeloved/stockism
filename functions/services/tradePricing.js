'use strict';
// Price propagation for executeTrade: trailing effects between related
// characters, stock → ETF reverse propagation, and the synthetic trade-history
// entries that stop trailing moves from bypassing the daily impact cap.
// Internal module — required by trading.js, not exported through index.js.
const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const { MIN_PRICE } = require('../constants');

// Returns { ticker: newPrice } for the traded ticker plus every related ticker
// moved by trailing effects and ETF reverse propagation.
function computePriceUpdates({ ticker, currentPrice, newPrice, prices }) {
  const applyTrailingEffects = (sourceTicker, sourceOldPrice, sourceNewPrice, priceUpdates, depth = 0, visited = new Set()) => {
    if (depth > 3 || visited.has(sourceTicker)) {
      return; // Max 3 levels deep, prevent cycles
    }
    visited.add(sourceTicker);

    const character = CHARACTER_MAP[sourceTicker];
    if (!character?.trailingFactors) {
      return;
    }

    // No price change or zero price = no trailing effects (prevents division by zero)
    if (sourceOldPrice <= 0 || sourceOldPrice === sourceNewPrice) return;

    const priceChangePercent = (sourceNewPrice - sourceOldPrice) / sourceOldPrice;

    character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
      if (visited.has(relatedTicker)) {
        return; // Skip already visited
      }

      // Get current price - check priceUpdates first, then fall back to prices
      const oldRelatedPrice = priceUpdates[relatedTicker] || prices[relatedTicker];
      if (oldRelatedPrice) {
        const trailingChange = priceChangePercent * coefficient;
        const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
        const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

        priceUpdates[relatedTicker] = settledRelatedPrice;

        // Recursively apply trailing effects
        applyTrailingEffects(relatedTicker, oldRelatedPrice, settledRelatedPrice, priceUpdates, depth + 1, visited);
      }
    });
  };

  // Start with the traded ticker's price change
  const priceUpdates = { [ticker]: newPrice };
  applyTrailingEffects(ticker, currentPrice, newPrice, priceUpdates);

  // Stock → ETF reverse propagation: when a non-ETF stock changes price,
  // update any parent ETFs proportionally using their trailing coefficients.
  // Build reverse lookup: stockTicker → [{etfTicker, coefficient}]
  const reverseETFMap = {};
  CHARACTERS.filter(c => c.isETF && c.trailingFactors).forEach(etf => {
    etf.trailingFactors.forEach(({ ticker: stockTicker, coefficient }) => {
      if (!reverseETFMap[stockTicker]) reverseETFMap[stockTicker] = [];
      reverseETFMap[stockTicker].push({ etfTicker: etf.ticker, coefficient });
    });
  });

  // For each changed non-ETF ticker, propagate to parent ETFs
  Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
    const updatedChar = CHARACTER_MAP[updatedTicker];
    if (updatedChar?.isETF) return; // Skip ETFs themselves

    const originalPrice = updatedTicker === ticker ? currentPrice : prices[updatedTicker];
    if (!originalPrice || originalPrice <= 0 || originalPrice === updatedPrice) return;

    const parentETFs = reverseETFMap[updatedTicker];
    if (!parentETFs) return;

    const stockChangePercent = (updatedPrice - originalPrice) / originalPrice;

    parentETFs.forEach(({ etfTicker, coefficient }) => {
      // Skip if this ETF is the ticker being directly traded (prevents feedback loop)
      if (etfTicker === ticker) return;

      const etfOldPrice = priceUpdates[etfTicker] || prices[etfTicker];
      if (!etfOldPrice || etfOldPrice <= 0) return;

      const etfChange = stockChangePercent * coefficient;
      const etfNewPrice = Math.max(MIN_PRICE, Math.round(etfOldPrice * (1 + etfChange) * 100) / 100);
      priceUpdates[etfTicker] = etfNewPrice;
      // Do NOT call applyTrailingEffects on updated ETFs (prevents ETF→stock→ETF loop)
    });
  });

  return priceUpdates;
}

// Track trailing effects in tickerTradeHistory so users can't bypass the 10%
// limit by trading one ticker and getting free impact on related tickers.
// Returns synthetic entries (shares: 0, just impact) for affected tickers:
// { ticker: { action, entry } }
function buildTrailingEntries({ priceUpdates, ticker, prices, action, now }) {
  const trailingEntries = {};
  Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
    if (updatedTicker === ticker) return; // Already tracked via main entry
    const originalPrice = prices[updatedTicker];
    if (originalPrice && originalPrice > 0) {
      const trailingImpactPercent = Math.abs(updatedPrice - originalPrice) / originalPrice;
      // Use buy direction for trailing effects (they represent buy-side pressure)
      const trailingAction = (action === 'buy' || action === 'cover') ? 'buy' : 'sell';
      trailingEntries[updatedTicker] = { action: trailingAction, entry: { ts: now, shares: 0, impact: trailingImpactPercent } };
    }
  });
  return trailingEntries;
}

module.exports = { computePriceUpdates, buildTrailingEntries };
