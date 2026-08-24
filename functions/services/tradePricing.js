'use strict';
// Price propagation for executeTrade: trailing effects between related
// characters, stock → ETF reverse propagation, and the synthetic trade-history
// entries that stop trailing moves from bypassing the daily impact cap.
// Internal module — required by trading.js, not exported through index.js.
const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const { MIN_PRICE, TRAILING_MAX_DEPTH } = require('../constants');

// Reverse lookup: stockTicker → [{ etfTicker, coefficient }]. Built once at
// module load; the roster never changes at runtime.
const REVERSE_ETF_MAP = {};
CHARACTERS.filter(c => c.isETF && c.trailingFactors).forEach(etf => {
  etf.trailingFactors.forEach(({ ticker: stockTicker, coefficient }) => {
    if (!REVERSE_ETF_MAP[stockTicker]) REVERSE_ETF_MAP[stockTicker] = [];
    REVERSE_ETF_MAP[stockTicker].push({ etfTicker: etf.ticker, coefficient });
  });
});

/**
 * Trailing effects, walked level by level out from the traded ticker.
 *
 * This used to be depth-first, which let the ORDER of trailingFactors in
 * characters.js decide the result. Trading $JIN reached $GAP first, $GAP's own
 * link to $SHNG fired (0.2 x 0.2), $SHNG was marked visited, and $JIN's own 0.2
 * link to $SHNG was then skipped — so $SHNG moved a fifth of what $GAP moved off
 * identical coefficients, purely because $GAP is typed first in the roster.
 * Going level by level makes every direct link fire at full strength before an
 * indirect one can claim the stock.
 *
 * Same fix and same reasoning as buildTrailingCascade in
 * src/hooks/admin/trailingCascade.js — keep the two in step.
 *
 * A stock moves at most once per trade, at the shortest distance from the traded
 * ticker. That is what stops mutual links (GAP, JIN and SHNG all point at each
 * other) from looping forever.
 */
function applyTrailingEffects({ ticker, currentPrice, newPrice, prices, priceUpdates }) {
  // No price change or zero price = no trailing effects (prevents division by zero)
  if (!(currentPrice > 0) || currentPrice === newPrice) return;

  const settled = new Set([ticker]);
  let frontier = [{ ticker, oldPrice: currentPrice, newPrice }];

  for (let depth = 0; depth < TRAILING_MAX_DEPTH && frontier.length > 0; depth++) {
    // Total the whole level's pushes before applying any of them, so two stocks
    // the same distance away both count instead of the first one winning and
    // shutting the other out.
    const pushes = new Map();
    for (const node of frontier) {
      const character = CHARACTER_MAP[node.ticker];
      if (!character?.trailingFactors) continue;
      const changePercent = (node.newPrice - node.oldPrice) / node.oldPrice;
      for (const { ticker: linked, coefficient } of character.trailingFactors) {
        if (settled.has(linked)) continue;
        pushes.set(linked, (pushes.get(linked) || 0) + changePercent * coefficient);
      }
    }

    const nextFrontier = [];
    for (const [linked, change] of pushes) {
      settled.add(linked);
      const oldLinkedPrice = prices[linked];
      if (!oldLinkedPrice || oldLinkedPrice <= 0) continue;
      const settledPrice = Math.max(MIN_PRICE, Math.round(oldLinkedPrice * (1 + change) * 100) / 100);
      if (settledPrice === oldLinkedPrice) continue;
      priceUpdates[linked] = settledPrice;
      nextFrontier.push({ ticker: linked, oldPrice: oldLinkedPrice, newPrice: settledPrice });
    }
    frontier = nextFrontier;
  }
}

/**
 * Stock → ETF reverse propagation: when a non-ETF stock changes price, its
 * parent ETFs follow proportionally.
 *
 * Every constituent's contribution is totalled before the ETF price is written,
 * for the same reason the trailing walk totals a level: applying them one at a
 * time compounded each move onto the last rounded result, so the roster order of
 * the constituents leaked into the ETF price.
 *
 * Updated ETFs are NOT fed back into the trailing walk (prevents an
 * ETF → stock → ETF loop).
 */
function applyEtfPropagation({ ticker, currentPrice, prices, priceUpdates }) {
  const etfPushes = new Map();

  for (const [updatedTicker, updatedPrice] of Object.entries(priceUpdates)) {
    if (CHARACTER_MAP[updatedTicker]?.isETF) continue; // Skip ETFs themselves

    const originalPrice = updatedTicker === ticker ? currentPrice : prices[updatedTicker];
    if (!originalPrice || originalPrice <= 0 || originalPrice === updatedPrice) continue;

    const parentETFs = REVERSE_ETF_MAP[updatedTicker];
    if (!parentETFs) continue;

    const stockChangePercent = (updatedPrice - originalPrice) / originalPrice;
    for (const { etfTicker, coefficient } of parentETFs) {
      // Skip if this ETF is the ticker being directly traded (prevents feedback loop)
      if (etfTicker === ticker) continue;
      etfPushes.set(etfTicker, (etfPushes.get(etfTicker) || 0) + stockChangePercent * coefficient);
    }
  }

  for (const [etfTicker, change] of etfPushes) {
    // Trailing may already have moved this ETF; that price is the base here.
    const etfOldPrice = priceUpdates[etfTicker] || prices[etfTicker];
    if (!etfOldPrice || etfOldPrice <= 0) continue;
    priceUpdates[etfTicker] = Math.max(MIN_PRICE, Math.round(etfOldPrice * (1 + change) * 100) / 100);
  }
}

// Returns { ticker: newPrice } for the traded ticker plus every related ticker
// moved by trailing effects and ETF reverse propagation.
function computePriceUpdates({ ticker, currentPrice, newPrice, prices }) {
  const priceUpdates = { [ticker]: newPrice };
  applyTrailingEffects({ ticker, currentPrice, newPrice, prices, priceUpdates });
  applyEtfPropagation({ ticker, currentPrice, prices, priceUpdates });
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
