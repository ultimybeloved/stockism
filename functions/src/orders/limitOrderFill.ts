// The fill itself: pricing, the user-doc write, the trade record, and the price
// move. INTERNAL MODULE — not exported through functions/src/index.js, same pattern
// as tradeActions.
//
// Everything here runs inside the caller's transaction. Nothing in this file
// reads; the orchestrator hands over data it already read, so the read-before-
// write rule stays the caller's to keep.

import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';

import { exitLoyaltyDiscount, CHARACTER_MAP } from '../shared/characters';
import { MAX_DAILY_IMPACT } from '../shared/constants';
import {
  liquidityFor,
  calculateMarginalImpact,
  traderMarginalImpact,
  getAccountAgeImpactFactor,
  sumDirectionalImpact,
  impactDirectionOf,
} from '../shared/impact';
import type { ImpactEntry } from '../shared/impact';
import { appendPriceHistory } from '../shared/marketData';
import { buildTradeCreditUpdates, recordTrade } from '../shared/tradeRecords';
import { spreadFor } from '../shared/roster';
import { remainingShares, cohortAddUpdate, cohortRemoveUpdate } from '../shared/cohorts';
import { round2 } from '../shared/money';
import type { LimitOrder, PricePoint, UserData } from '../shared/types';
import type { TrailingEntries } from '../trading/tradePricing';
// Same propagation executeTrade uses, so a fill moves related characters and
// parent ETFs identically no matter which lane it came through.
import { computePriceUpdates, buildTrailingEntries } from '../trading/tradePricing';
import { pruneHistoryMap, appendTradeEntries } from '../trading/tradeState';

/** Everything a fill needs, all of it read by the orchestrator before any write. */
export interface FillCtx {
  order: LimitOrder;
  orderId: string;
  userRef: admin.firestore.DocumentReference;
  marketRef: admin.firestore.DocumentReference;
  userData: UserData;
  freshPrice: number;
  freshPrices: Record<string, number>;
  fillShares: number;
  now: number;
  effectiveImpact: number;
  traderImpact: number;
  impactPercent: number;
  fillSource: string;
}

/** A committed fill: the price paid and what goes into the connection's history. */
export interface FillResult {
  executedPrice: number;
  tradeValue: number;
  historyEntry: ImpactEntry;
  trailingEntries: TrailingEntries;
}

/**
 * Price impact for this fill, capped by whatever is left of the user's daily
 * allowance on this ticker IN THE DIRECTION THIS FILL PUSHES. Same rule as
 * executeTrade: the fill still executes once the allowance is gone, it just
 * stops moving the price. New accounts move less. `networkSpent` is what every
 * account on the order's connection has used (orderNetwork.js); the larger of
 * the two applies, same as executeTrade.
 */
export const computeImpact = ({
  userData,
  ticker,
  action,
  freshPrice,
  fillShares,
  cumVolume,
  now,
  networkSpent = 0,
}: {
  userData: UserData;
  ticker: string;
  action: string;
  freshPrice: number;
  fillShares: number;
  cumVolume: number;
  now: number;
  networkSpent?: number;
}) => {
  const history = userData.tickerTradeHistory || {};
  const spent = Math.max(sumDirectionalImpact(history[ticker], now)[impactDirectionOf(action)], networkSpent);
  const remaining = Math.max(0, MAX_DAILY_IMPACT - spent);
  const ageFactor = getAccountAgeImpactFactor(userData);
  const effectiveImpact = Math.min(
    calculateMarginalImpact(freshPrice, fillShares, cumVolume, liquidityFor(ticker)) * ageFactor,
    freshPrice * remaining,
  );
  // What the trader is charged, as opposed to how far the market moves. Same
  // split executeTrade applies — without it here, an oversized LIMIT order
  // would still get the volume discount that was removed from market orders,
  // which is simply a slower way to do the same trade.
  const traderImpact = traderMarginalImpact(freshPrice, fillShares, cumVolume, liquidityFor(ticker)) * ageFactor;
  return {
    effectiveImpact,
    traderImpact,
    impactPercent: freshPrice > 0 ? effectiveImpact / freshPrice : 0,
  };
};

/**
 * Every ticker this fill moves: the traded one, anything trailing it, and the
 * parent ETFs. Empty when the fill had no impact left in the daily allowance —
 * no price change means nothing to propagate.
 */
const propagate = ({
  effectiveImpact,
  ticker,
  freshPrice,
  newMarketPrice,
  freshPrices,
}: {
  effectiveImpact: number;
  ticker: string;
  freshPrice: number;
  newMarketPrice: number;
  freshPrices: Record<string, number>;
}): Record<string, number> =>
  effectiveImpact > 0
    ? computePriceUpdates({ ticker, currentPrice: freshPrice, newPrice: newMarketPrice, prices: freshPrices })
    : {};

/**
 * User trade history with this fill appended, plus a synthetic zero-share entry
 * per trailed ticker. Those entries feed the daily impact cap (so a fill can't
 * hand out free impact on related tickers) without counting toward the
 * 10-trades-per-ticker cap.
 */
const buildHistory = ({
  userData,
  ticker,
  action,
  fillShares,
  impactPercent,
  trailingEntries,
  now,
}: {
  userData: UserData;
  ticker: string;
  action: string;
  fillShares: number;
  impactPercent: number;
  trailingEntries: TrailingEntries;
  now: number;
}) =>
  appendTradeEntries(
    pruneHistoryMap(userData.tickerTradeHistory || {}, now),
    ticker,
    action,
    { ts: now, shares: fillShares, impact: impactPercent },
    trailingEntries,
  );

/** Write every moved price and its chart point. Dotted paths, so a concurrent
 *  write to another ticker in the same map survives. */
const applyPriceUpdates = (
  transaction: admin.firestore.Transaction,
  marketRef: admin.firestore.DocumentReference,
  priceUpdates: Record<string, number>,
) => {
  const moved = Object.entries(priceUpdates);
  if (!moved.length) return;
  const updates: Record<string, number> = {};
  const historyPoints: Record<string, PricePoint> = {};
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
 * Returns { executedPrice, tradeValue, historyEntry, trailingEntries }; the last
 * two go to the connection's shared history too.
 */
export const applyBuyFill = (transaction: admin.firestore.Transaction, ctx: FillCtx): FillResult => {
  const {
    order,
    orderId,
    userRef,
    marketRef,
    userData,
    freshPrice,
    freshPrices,
    fillShares,
    now,
    effectiveImpact,
    traderImpact,
    impactPercent,
    fillSource,
  } = ctx;
  const ticker = order.ticker;

  const newMarketPrice = round2(freshPrice + effectiveImpact);
  // Buyer pays their own impact, market moves the capped one.
  const askPrice = round2(freshPrice + traderImpact) * (1 + spreadFor(ticker) / 2);
  const executedPrice = round2(askPrice);

  // Limit semantics: never fill above the user's limit price. The trigger
  // checks the mid price, but execution pays the ask after impact — defer
  // until the ask itself is within the limit.
  if (executedPrice > order.limitPrice!) {
    throw new Error('Ask price exceeds limit after impact and spread');
  }

  const totalCost = askPrice * fillShares;
  const cash = userData.cash!;
  if (cash < totalCost) throw new Error('Insufficient cash after price impact');

  const currentHoldings = userData.holdings?.[ticker] || 0;
  const currentCostBasis = userData.costBasis?.[ticker] || 0;
  const newHoldings = currentHoldings + fillShares;
  const newCostBasis =
    currentHoldings > 0
      ? newHoldings > 0
        ? (currentCostBasis * currentHoldings + askPrice * fillShares) / newHoldings
        : askPrice
      : askPrice;

  const priceUpdates = propagate({ effectiveImpact, ticker, freshPrice, newMarketPrice, freshPrices });
  const trailingEntries = buildTrailingEntries({ priceUpdates, ticker, prices: freshPrices, action: 'buy', now });
  const updatedHistory = buildHistory({
    userData,
    ticker,
    action: 'buy',
    fillShares,
    impactPercent,
    trailingEntries,
    now,
  });

  // Mission/stat credit — same fields executeTrade writes, so limit fills count
  // toward missions like regular trades.
  const { updates: creditUpdates } = buildTradeCreditUpdates({
    userData,
    ticker,
    action: 'buy',
    shares: fillShares,
    totalValue: totalCost,
    executionPrice: executedPrice,
    marketPrice: freshPrice,
    now,
  });

  transaction.update(userRef, {
    cash: FieldValue.increment(-totalCost),
    [`holdings.${ticker}`]: newHoldings,
    [`costBasis.${ticker}`]: round2(newCostBasis),
    // The 45-second hold gate. executeTrade and the pre-market auction both
    // stamp this; without it here, shares bought through a limit order could be
    // sold again immediately, which is the one lane that skipped the gate.
    [`lastBuyTime.${ticker}`]: Timestamp.now(),
    lastTradeTime: FieldValue.serverTimestamp(),
    tickerTradeHistory: updatedHistory,
    // Dividend/exit-loyalty lot ledger — same write executeTrade makes.
    ...cohortAddUpdate(userData, ticker, fillShares, now, !!CHARACTER_MAP[ticker]?.isETF),
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
    cashBefore: cash,
    cashAfter: round2(cash - totalCost),
    source: fillSource,
    orderId,
  });

  applyPriceUpdates(transaction, marketRef, priceUpdates);

  logger.info(
    `Executed BUY: ${fillShares} ${ticker} @ $${askPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`,
  );
  return {
    executedPrice,
    tradeValue: totalCost,
    historyEntry: { ts: now, shares: fillShares, impact: impactPercent },
    trailingEntries,
  };
};

/**
 * SELL / STOP_LOSS fill. Price goes down and the market takes the FULL impact,
 * but a long-held position is priced against a reduced one (exit loyalty, same
 * rule as tradeActions.computeSell).
 * Returns { executedPrice, tradeValue, historyEntry, trailingEntries }.
 */
export const applySellFill = (transaction: admin.firestore.Transaction, ctx: FillCtx): FillResult => {
  const {
    order,
    orderId,
    userRef,
    marketRef,
    userData,
    freshPrice,
    freshPrices,
    fillShares,
    now,
    effectiveImpact,
    traderImpact,
    impactPercent,
    fillSource,
  } = ctx;
  const ticker = order.ticker;

  const newMarketPrice = Math.max(0.01, round2(freshPrice - effectiveImpact));

  // Seller is priced against their own impact, reduced by exit loyalty; the
  // market still moves only the capped amount.
  const loyalty = exitLoyaltyDiscount(userData.holdingCohorts?.[ticker], fillShares, now);
  const sellerMid = Math.max(0.01, round2(freshPrice - traderImpact * (1 - loyalty)));
  const bidPrice = sellerMid * (1 - spreadFor(ticker) / 2);
  const executedPrice = round2(bidPrice);

  // Limit semantics for SELL only: never fill below the user's limit price.
  // Stop losses are exempt — they sell on the way down by design.
  if (order.type === 'SELL' && executedPrice < order.limitPrice!) {
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
    userData,
    ticker,
    action: 'sell',
    fillShares,
    impactPercent,
    trailingEntries,
    now,
  });

  const { updates: creditUpdates } = buildTradeCreditUpdates({
    userData,
    ticker,
    action: 'sell',
    shares: fillShares,
    totalValue: totalRevenue,
    executionPrice: executedPrice,
    marketPrice: freshPrice,
    now,
  });

  const updates: Record<string, unknown> = {
    cash: FieldValue.increment(totalRevenue),
    [`holdings.${ticker}`]: newHoldings,
    lastTradeTime: FieldValue.serverTimestamp(),
    tickerTradeHistory: updatedHistory,
    // Dividend/exit-loyalty lot ledger — same write executeTrade makes. Without
    // it the sold lots stayed on the books and discounted the NEXT sell.
    ...cohortRemoveUpdate(userData, ticker, fillShares),
    ...creditUpdates,
  };
  if (!newHoldings) {
    updates[`holdings.${ticker}`] = FieldValue.delete();
    updates[`costBasis.${ticker}`] = FieldValue.delete();
    updates[`lowestWhileHolding.${ticker}`] = FieldValue.delete();
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
    cashBefore: userData.cash!,
    cashAfter: round2(userData.cash! + totalRevenue),
    source: fillSource,
    orderId,
  });

  applyPriceUpdates(transaction, marketRef, priceUpdates);

  logger.info(
    `Executed ${order.type}: ${fillShares} ${ticker} @ $${bidPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`,
  );
  return {
    executedPrice,
    tradeValue: totalRevenue,
    historyEntry: { ts: now, shares: fillShares, impact: impactPercent },
    trailingEntries,
  };
};

/**
 * Mark the order filled. Runs in the same transaction as the balance change, so
 * a crash here can't leave it PENDING and double-fill it on the next cycle.
 */
export const markOrderFilled = (
  transaction: admin.firestore.Transaction,
  orderRef: admin.firestore.DocumentReference,
  {
    freshFilled,
    fillShares,
    totalShares,
    allowPartialFills,
    executedPrice,
  }: {
    freshFilled: number;
    fillShares: number;
    totalShares: number;
    allowPartialFills?: boolean;
    executedPrice: number;
  },
) => {
  const newFilledTotal = freshFilled + fillShares;
  const isPartialFill = allowPartialFills && newFilledTotal < totalShares;
  transaction.update(orderRef, {
    status: isPartialFill ? 'PARTIALLY_FILLED' : 'FILLED',
    filledShares: newFilledTotal,
    executedPrice,
    executedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
};
