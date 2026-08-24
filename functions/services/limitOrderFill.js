'use strict';
// The fill itself: pricing, the user-doc write, the trade record, and the price
// move. INTERNAL MODULE — not exported through functions/index.js, same pattern
// as tradeActions.
//
// Everything here runs inside the caller's transaction. Nothing in this file
// reads; the orchestrator hands over data it already read, so the read-before-
// write rule stays the caller's to keep.

const admin = require('firebase-admin');

const { exitLoyaltyDiscount } = require('../characters');
const { MAX_DAILY_IMPACT } = require('../constants');
const {
  calculateMarginalImpact, getAccountAgeImpactFactor, pruneAndSumTradeHistory,
  appendPriceHistory, buildTradeCreditUpdates, recordTrade, spreadFor, remainingShares,
} = require('../helpers');
// Same propagation executeTrade uses, so a fill moves related characters and
// parent ETFs identically no matter which lane it came through.
const { computePriceUpdates, buildTrailingEntries } = require('./tradePricing');
const { pruneHistoryMap, appendTradeEntries } = require('./tradeState');

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * Price impact for this fill, capped by whatever is left of the user's daily
 * allowance on this ticker. Same rule as executeTrade: the fill still executes
 * once the allowance is gone, it just stops moving the price. New accounts
 * move less.
 */
const computeImpact = ({ userData, ticker, freshPrice, fillShares, cumVolume, now }) => {
  const history = userData.tickerTradeHistory || {};
  let dailyImpact = 0;
  for (const act of ['buy', 'sell', 'short', 'cover']) {
    const { totalImpact } = pruneAndSumTradeHistory(history[ticker]?.[act] || [], now);
    dailyImpact += totalImpact;
  }
  const remaining = Math.max(0, MAX_DAILY_IMPACT - dailyImpact);
  const effectiveImpact = Math.min(
    calculateMarginalImpact(freshPrice, fillShares, cumVolume) * getAccountAgeImpactFactor(userData),
    freshPrice * remaining
  );
  return { effectiveImpact, impactPercent: freshPrice > 0 ? effectiveImpact / freshPrice : 0 };
};

/**
 * Every ticker this fill moves: the traded one, anything trailing it, and the
 * parent ETFs. Empty when the fill had no impact left in the daily allowance —
 * no price change means nothing to propagate.
 */
const propagate = ({ effectiveImpact, ticker, freshPrice, newMarketPrice, freshPrices }) =>
  (effectiveImpact > 0
    ? computePriceUpdates({ ticker, currentPrice: freshPrice, newPrice: newMarketPrice, prices: freshPrices })
    : {});

/**
 * User trade history with this fill appended, plus a synthetic zero-share entry
 * per trailed ticker. Those entries feed the daily impact cap (so a fill can't
 * hand out free impact on related tickers) without counting toward the
 * 10-trades-per-ticker cap.
 */
const buildHistory = ({ userData, ticker, action, fillShares, impactPercent, trailingEntries, now }) =>
  appendTradeEntries(
    pruneHistoryMap(userData.tickerTradeHistory || {}, now),
    ticker, action,
    { ts: now, shares: fillShares, impact: impactPercent },
    trailingEntries
  );

/** Write every moved price and its chart point. Dotted paths, so a concurrent
 *  write to another ticker in the same map survives. */
const applyPriceUpdates = (transaction, marketRef, priceUpdates) => {
  const moved = Object.entries(priceUpdates);
  if (!moved.length) return;
  const updates = {};
  const historyPoints = {};
  const timestamp = Date.now();
  for (const [t, price] of moved) {
    updates[`prices.${t}`] = price;
    historyPoints[t] = { timestamp, price };
  }
  transaction.update(marketRef, updates);
  appendPriceHistory(transaction, historyPoints);
};

/**
 * BUY fill. Price goes up, the user pays the ask after impact.
 * Returns { executedPrice, tradeValue }.
 */
const applyBuyFill = (transaction, ctx) => {
  const { order, orderId, userRef, marketRef, userData, freshPrice, freshPrices, fillShares, now,
    effectiveImpact, impactPercent, fillSource } = ctx;
  const ticker = order.ticker;

  const newMarketPrice = round2(freshPrice + effectiveImpact);
  const askPrice = newMarketPrice * (1 + spreadFor(ticker) / 2);
  const executedPrice = round2(askPrice);

  // Limit semantics: never fill above the user's limit price. The trigger
  // checks the mid price, but execution pays the ask after impact — defer
  // until the ask itself is within the limit.
  if (executedPrice > order.limitPrice) {
    throw new Error('Ask price exceeds limit after impact and spread');
  }

  const totalCost = askPrice * fillShares;
  if (userData.cash < totalCost) throw new Error('Insufficient cash after price impact');

  const currentHoldings = userData.holdings?.[ticker] || 0;
  const currentCostBasis = userData.costBasis?.[ticker] || 0;
  const newHoldings = currentHoldings + fillShares;
  const newCostBasis = currentHoldings > 0
    ? (newHoldings > 0 ? ((currentCostBasis * currentHoldings) + (askPrice * fillShares)) / newHoldings : askPrice)
    : askPrice;

  const priceUpdates = propagate({ effectiveImpact, ticker, freshPrice, newMarketPrice, freshPrices });
  const trailingEntries = buildTrailingEntries({ priceUpdates, ticker, prices: freshPrices, action: 'buy', now });
  const updatedHistory = buildHistory({
    userData, ticker, action: 'buy', fillShares, impactPercent, trailingEntries, now,
  });

  // Mission/stat credit — same fields executeTrade writes, so limit fills count
  // toward missions like regular trades.
  const { updates: creditUpdates } = buildTradeCreditUpdates({
    userData, ticker, action: 'buy', shares: fillShares,
    totalValue: totalCost, executionPrice: executedPrice, marketPrice: freshPrice, now,
  });

  transaction.update(userRef, {
    cash: admin.firestore.FieldValue.increment(-totalCost),
    [`holdings.${ticker}`]: newHoldings,
    [`costBasis.${ticker}`]: round2(newCostBasis),
    lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
    tickerTradeHistory: updatedHistory,
    ...creditUpdates,
  });

  // Same trade record executeTrade writes, so the fill shows up in the player's
  // trade history and the market reports.
  recordTrade(transaction, {
    uid: order.userId,
    ticker,
    action: 'buy',
    amount: fillShares,
    price: executedPrice,
    priceImpact: impactPercent,
    totalValue: totalCost,
    cashBefore: userData.cash,
    cashAfter: round2(userData.cash - totalCost),
    source: fillSource,
    orderId,
  });

  applyPriceUpdates(transaction, marketRef, priceUpdates);

  console.log(`Executed BUY: ${fillShares} ${ticker} @ $${askPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
  return { executedPrice, tradeValue: totalCost };
};

/**
 * SELL / STOP_LOSS fill. Price goes down and the market takes the FULL impact,
 * but a long-held position is priced against a reduced one (exit loyalty, same
 * rule as tradeActions.computeSell).
 * Returns { executedPrice, tradeValue }.
 */
const applySellFill = (transaction, ctx) => {
  const { order, orderId, userRef, marketRef, userData, freshPrice, freshPrices, fillShares, now,
    effectiveImpact, impactPercent, fillSource } = ctx;
  const ticker = order.ticker;

  const newMarketPrice = Math.max(0.01, round2(freshPrice - effectiveImpact));

  const loyalty = exitLoyaltyDiscount(userData.holdingCohorts?.[ticker], fillShares, now);
  const sellerMid = Math.max(0.01, round2(freshPrice - effectiveImpact * (1 - loyalty)));
  const bidPrice = sellerMid * (1 - spreadFor(ticker) / 2);
  const executedPrice = round2(bidPrice);

  // Limit semantics for SELL only: never fill below the user's limit price.
  // Stop losses are exempt — they sell on the way down by design.
  if (order.type === 'SELL' && executedPrice < order.limitPrice) {
    throw new Error('Bid price below limit after impact and spread');
  }

  const totalRevenue = bidPrice * fillShares;
  const currentHoldings = userData.holdings?.[ticker] || 0;
  // Six decimals, with anything under the minimum sellable size dropped. Raw
  // subtraction left float specks like 1e-17 sitting on the position, which read
  // as "still holding" and could never be sold off.
  const newHoldings = remainingShares(currentHoldings, fillShares);

  const priceUpdates = propagate({ effectiveImpact, ticker, freshPrice, newMarketPrice, freshPrices });
  const trailingEntries = buildTrailingEntries({ priceUpdates, ticker, prices: freshPrices, action: 'sell', now });
  const updatedHistory = buildHistory({
    userData, ticker, action: 'sell', fillShares, impactPercent, trailingEntries, now,
  });

  const { updates: creditUpdates } = buildTradeCreditUpdates({
    userData, ticker, action: 'sell', shares: fillShares,
    totalValue: totalRevenue, executionPrice: executedPrice, marketPrice: freshPrice, now,
  });

  const updates = {
    cash: admin.firestore.FieldValue.increment(totalRevenue),
    [`holdings.${ticker}`]: newHoldings,
    lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
    tickerTradeHistory: updatedHistory,
    ...creditUpdates,
  };
  if (!newHoldings) {
    updates[`holdings.${ticker}`] = admin.firestore.FieldValue.delete();
    updates[`costBasis.${ticker}`] = admin.firestore.FieldValue.delete();
    updates[`lowestWhileHolding.${ticker}`] = admin.firestore.FieldValue.delete();
  }
  transaction.update(userRef, updates);

  recordTrade(transaction, {
    uid: order.userId,
    ticker,
    action: 'sell',
    amount: fillShares,
    price: executedPrice,
    priceImpact: impactPercent,
    totalValue: totalRevenue,
    cashBefore: userData.cash,
    cashAfter: round2(userData.cash + totalRevenue),
    source: fillSource,
    orderId,
  });

  applyPriceUpdates(transaction, marketRef, priceUpdates);

  console.log(`Executed ${order.type}: ${fillShares} ${ticker} @ $${bidPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
  return { executedPrice, tradeValue: totalRevenue };
};

/**
 * Mark the order filled. Runs in the same transaction as the balance change, so
 * a crash here can't leave it PENDING and double-fill it on the next cycle.
 */
const markOrderFilled = (transaction, orderRef, { freshFilled, fillShares, totalShares, allowPartialFills, executedPrice }) => {
  const newFilledTotal = freshFilled + fillShares;
  const isPartialFill = allowPartialFills && newFilledTotal < totalShares;
  transaction.update(orderRef, {
    status: isPartialFill ? 'PARTIALLY_FILLED' : 'FILLED',
    filledShares: newFilledTotal,
    executedPrice,
    executedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
};

module.exports = {
  computeImpact,
  applyBuyFill,
  applySellFill,
  markOrderFilled,
};
