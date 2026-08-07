'use strict';
// The fill itself: pricing, the user-doc write, the trade record, and the price
// move. INTERNAL MODULE — not exported through functions/index.js, same pattern
// as tradeActions.
//
// Everything here runs inside the caller's transaction. Nothing in this file
// reads; the orchestrator hands over data it already read, so the read-before-
// write rule stays the caller's to keep.

const admin = require('firebase-admin');

const { CHARACTER_MAP, exitLoyaltyDiscount } = require('../characters');
const {
  BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, TWENTY_FOUR_HOURS_MS, MAX_DAILY_IMPACT,
} = require('../constants');
const {
  calculateMarginalImpact, getAccountAgeImpactFactor, pruneAndSumTradeHistory,
  appendPriceHistory, buildTradeCreditUpdates, recordTrade,
} = require('../helpers');

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

/** tickerTradeHistory with this fill appended and entries older than 24h dropped. */
const appendTradeHistory = (tickerTradeHistory, ticker, action, entry, now) => {
  const updated = JSON.parse(JSON.stringify(tickerTradeHistory));
  if (!updated[ticker]) updated[ticker] = {};
  if (!updated[ticker][action]) updated[ticker][action] = [];
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  updated[ticker][action] = updated[ticker][action].filter((e) => e.ts > cutoff);
  updated[ticker][action].push(entry);
  return updated;
};

const spreadFor = (ticker) =>
  (CHARACTER_MAP[ticker]?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD);

/** Move the market price and chart, but only when the fill actually had impact. */
const applyPriceMove = (transaction, marketRef, ticker, newMarketPrice, effectiveImpact) => {
  if (effectiveImpact <= 0) return;
  transaction.update(marketRef, { [`prices.${ticker}`]: newMarketPrice });
  appendPriceHistory(transaction, { [ticker]: { timestamp: Date.now(), price: newMarketPrice } });
};

/**
 * BUY fill. Price goes up, the user pays the ask after impact.
 * Returns { executedPrice, tradeValue }.
 */
const applyBuyFill = (transaction, ctx) => {
  const { order, orderId, userRef, marketRef, userData, freshPrice, fillShares, now,
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

  const updatedHistory = appendTradeHistory(
    userData.tickerTradeHistory || {}, ticker, 'buy',
    { ts: now, shares: fillShares, impact: impactPercent }, now
  );

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

  applyPriceMove(transaction, marketRef, ticker, newMarketPrice, effectiveImpact);

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
  const { order, orderId, userRef, marketRef, userData, freshPrice, fillShares, now,
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
  const newHoldings = currentHoldings - fillShares;

  const updatedHistory = appendTradeHistory(
    userData.tickerTradeHistory || {}, ticker, 'sell',
    { ts: now, shares: fillShares, impact: impactPercent }, now
  );

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
  if (newHoldings <= 0) {
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

  applyPriceMove(transaction, marketRef, ticker, newMarketPrice, effectiveImpact);

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
