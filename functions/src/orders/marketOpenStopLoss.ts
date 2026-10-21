// The stop-loss sweep that runs at market open, right after the pre-market
// auction sets opening prices. INTERNAL MODULE — required by marketOrders.js,
// not exported through functions/src/index.js.
//
// Split out of marketOrders.js when that file passed the 600-line limit. It is
// its own mechanism: the auction is a batch price discovery, this is a
// per-order liquidation triggered by the price the auction landed on.
//
// A stop loss that fills through the regular 15-minute sweep goes through
// limitOrderFill instead. Both must stay in step: the seller is priced the
// same way in both (see executeSweepFill).
//
// npm run test:premarket covers this path.

import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { MAX_TRADES_PER_TICKER_24H, MAX_DAILY_IMPACT, MIN_EXIT_SHARES } from '../shared/constants';
import {
  liquidityFor,
  calculateMarginalImpact,
  traderMarginalImpact,
  getAccountAgeImpactFactor,
  pruneAndSumTradeHistory,
  sumDirectionalImpact,
  heavySellStamps,
} from '../shared/impact';
import { writeNotification } from '../shared/notifications';
import { appendPriceHistory } from '../shared/marketData';
import { lockedShares, floorExitShares, remainingShares, cohortRemoveUpdate } from '../shared/cohorts';
import { buildTradeCreditUpdates, recordTrade } from '../shared/tradeRecords';
import { round2 } from '../shared/money';
import { spreadFor } from '../shared/roster';
import { exitLoyaltyDiscount } from '../shared/characters';
import type { LimitOrder, PricePoint, UserData } from '../shared/types';
import { updateCrewMissionProgress } from '../crews/crewMissionProgress';
import { computePriceUpdates, buildTrailingEntries } from '../trading/tradePricing';
import { pruneHistoryMap, appendTradeEntries } from '../trading/tradeState';
import { readOrderNetwork, networkImpactSpent, writeNetworkFill } from './orderNetwork';
import { marketMoveFactor } from '../shared/marketMove';

/**
 * Fill one stop loss inside a transaction. Returns what the post-commit
 * notifications need. Throws to skip the order.
 *
 * The seller is priced exactly as limitOrderFill.applySellFill prices them:
 * their own uncapped impact, less the exit-loyalty discount. This used to price
 * them at the capped market move, so once the day's allowance was spent a stop
 * loss at the open sold with no impact at all, the one exit cheaper than every
 * other lane (changed 2026-10-13).
 */
const executeSweepFill = async (
  transaction: admin.firestore.Transaction,
  {
    order,
    orderDoc,
    marketRef,
    openingPrice,
    marketMove,
  }: {
    order: LimitOrder;
    orderDoc: admin.firestore.QueryDocumentSnapshot;
    marketRef: admin.firestore.DocumentReference;
    openingPrice: number;
    marketMove: number;
  },
) => {
  const userRef = db.collection('users').doc(order.userId);

  const freshOrderSnap = await transaction.get(orderDoc.ref);
  if (!freshOrderSnap.exists || !['PENDING', 'PARTIALLY_FILLED'].includes(freshOrderSnap.data()!.status)) {
    throw new Error('Order already processed');
  }
  const freshAlreadyFilled: number = freshOrderSnap.data()!.filledShares || 0;
  const userSnap = await transaction.get(userRef);
  const freshMarketSnap = await transaction.get(marketRef);
  // The connection that placed the stop: its down allowance is shared.
  const net = await readOrderNetwork(transaction, orderDoc.id);
  if (!userSnap.exists) throw new Error('User not found');

  const userData = userSnap.data() as UserData;
  const freshPrices: Record<string, number> = freshMarketSnap.data()!.prices || {};
  const freshPrice = freshPrices[order.ticker] || openingPrice;

  if (userData.isBankrupt || (userData.cash || 0) < 0) throw new Error('User is bankrupt');
  if (userData.isBanned) throw new Error('User is banned');
  if (userData.requiresDiscordLink && !userData.discordId) throw new Error('Discord verification required');

  // Locks re-checked at fill time: shares locked after the stop loss was placed
  // (e.g. a margin buy) can't be sold by the sweep.
  let fillShares = order.shares - freshAlreadyFilled;
  const userShares = userData.holdings?.[order.ticker] || 0;
  const lockedNow = lockedShares(userData, order.ticker).total;
  const sellableShares = Math.max(0, floorExitShares(userShares - lockedNow));
  if (sellableShares < fillShares) {
    if (order.allowPartialFills && sellableShares >= MIN_EXIT_SHARES) fillShares = sellableShares;
    else throw new Error('Insufficient shares');
  }

  const now = Date.now();
  const tickerTradeHistory = userData.tickerTradeHistory || {};
  const { totalShares: cumVol, count: tradeCount } = pruneAndSumTradeHistory(
    tickerTradeHistory[order.ticker]?.sell || [],
    now,
  );
  if (tradeCount >= MAX_TRADES_PER_TICKER_24H) throw new Error('Trade limit reached');

  // Daily 10% impact cap (same rule as executeTrade): the stop loss still fills,
  // but stops moving the price once the user's DOWN allowance on this ticker is
  // used up. A stop loss is always a sell, so it only ever spends that side.
  // New accounts move less. The allowance is shared with every account on the
  // order's connection, same as executeTrade.
  const spentDown = Math.max(
    sumDirectionalImpact(tickerTradeHistory[order.ticker], now).down,
    networkImpactSpent(net, order.ticker, 'sell', now),
  );
  const effectiveImpact = Math.min(
    calculateMarginalImpact(freshPrice, fillShares, cumVol, liquidityFor(order.ticker)) *
      getAccountAgeImpactFactor(userData),
    freshPrice * Math.max(0, MAX_DAILY_IMPACT - spentDown),
  );
  const impactPercent = freshPrice > 0 ? effectiveImpact / freshPrice : 0;
  const traderImpact =
    traderMarginalImpact(freshPrice, fillShares, cumVol, liquidityFor(order.ticker)) *
    getAccountAgeImpactFactor(userData);

  const newMarketPrice = Math.max(0.01, round2(freshPrice - effectiveImpact * marketMove));
  // Seller pays their own impact, reduced by exit loyalty; the market moves only
  // the capped amount. Same split as every other sell lane.
  const loyalty = exitLoyaltyDiscount(userData.holdingCohorts?.[order.ticker], fillShares, now);
  const sellerMid = Math.max(0.01, round2(freshPrice - traderImpact * (1 - loyalty)));
  const bidPrice = sellerMid * (1 - spreadFor(order.ticker) / 2);
  const executedPrice = round2(bidPrice);

  // Trailing effects + parent-ETF propagation, same as every other fill lane.
  const priceUpdates =
    effectiveImpact > 0
      ? computePriceUpdates({
          ticker: order.ticker,
          currentPrice: freshPrice,
          newPrice: newMarketPrice,
          prices: freshPrices,
        })
      : {};
  const trailingEntries = buildTrailingEntries({
    priceUpdates,
    ticker: order.ticker,
    prices: freshPrices,
    action: 'sell',
    now,
  });
  const historyEntry = { ts: now, shares: fillShares, impact: impactPercent };
  const updatedHistory = appendTradeEntries(
    pruneHistoryMap(tickerTradeHistory, now),
    order.ticker,
    'sell',
    historyEntry,
    trailingEntries,
  );
  writeNetworkFill(transaction, net, {
    ticker: order.ticker,
    action: 'sell',
    entry: historyEntry,
    trailingEntries,
    uid: order.userId,
    now,
  });

  const newHoldings = remainingShares(userShares, fillShares);
  // Mission/stat credit — same fields executeTrade writes (includes the
  // totalTrades increment), so sweep fills count like regular trades.
  const { updates: creditUpdates } = buildTradeCreditUpdates({
    userData,
    ticker: order.ticker,
    action: 'sell',
    shares: fillShares,
    totalValue: executedPrice * fillShares,
    executionPrice: executedPrice,
    marketPrice: freshPrice,
    now,
  });
  const updates: Record<string, unknown> = {
    cash: FieldValue.increment(executedPrice * fillShares),
    [`holdings.${order.ticker}`]: newHoldings,
    lastTradeTime: FieldValue.serverTimestamp(),
    tickerTradeHistory: updatedHistory,
    // Dividend/exit-loyalty lot ledger — same write executeTrade makes.
    ...cohortRemoveUpdate(userData, order.ticker, fillShares),
    ...creditUpdates,
    ...heavySellStamps(updatedHistory, order.ticker, 'sell', now, FieldValue.serverTimestamp()),
  };
  if (!newHoldings) {
    updates[`holdings.${order.ticker}`] = FieldValue.delete();
    updates[`costBasis.${order.ticker}`] = FieldValue.delete();
    updates[`lowestWhileHolding.${order.ticker}`] = FieldValue.delete();
  }
  transaction.update(userRef, updates);

  // Same trade record executeTrade writes, so the fill shows up in the player's
  // trade history and the market reports.
  const sweepTotal = executedPrice * fillShares;
  recordTrade(transaction, {
    uid: order.userId,
    ticker: order.ticker,
    action: 'sell',
    amount: fillShares,
    price: executedPrice,
    priceImpact: impactPercent,
    totalValue: sweepTotal,
    cashBefore: userData.cash || 0,
    cashAfter: round2((userData.cash || 0) + sweepTotal),
    source: 'stop_loss',
    orderId: orderDoc.id,
  });

  const moved = Object.entries(priceUpdates);
  if (moved.length) {
    const priceWrites: Record<string, number> = {};
    const historyPoints: Record<string, PricePoint> = {};
    for (const [t, price] of moved) {
      priceWrites[`prices.${t}`] = price;
      // Tagged: this sweep runs at 20:56, inside the halt, and an untagged point
      // there is what the weekly halt audit treats as unexplained.
      historyPoints[t] = { timestamp: now, price, source: 'open_stop_loss' };
    }
    transaction.update(marketRef, priceWrites);
    appendPriceHistory(transaction, historyPoints);
  }

  const newFilledTotal = freshAlreadyFilled + fillShares;
  const isPartial = order.allowPartialFills && newFilledTotal < order.shares;
  transaction.update(orderDoc.ref, {
    status: isPartial ? 'PARTIALLY_FILLED' : 'FILLED',
    filledShares: newFilledTotal,
    executedPrice,
    executedAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });

  return {
    fillShares,
    executedPrice,
    crew: userData.crew || null,
  };
};

/**
 * Walk every open stop loss and fill the ones the opening price triggered.
 * Mutates `summary` (stopLossFilled / stopLossSkipped) the way the caller's
 * other sections do.
 */
export const runStopLossSweep = async ({
  marketRef,
  openingPrices,
  summary,
}: {
  marketRef: admin.firestore.DocumentReference;
  openingPrices: Record<string, number>;
  summary: { stopLossFilled: number; stopLossSkipped: number };
}) => {
  const ordersSnapshot = await db
    .collection('limitOrders')
    .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
    .get();

  logger.info(`runMarketOpenProcessing: checking ${ordersSnapshot.size} limit orders`);

  for (const orderDoc of ordersSnapshot.docs) {
    const order = orderDoc.data() as LimitOrder;
    if (order.type !== 'STOP_LOSS') continue;

    const openingPrice = openingPrices[order.ticker];
    if (!openingPrice || openingPrice > order.limitPrice!) continue;

    try {
      // Read before the transaction, never inside it (cached; shared/marketMove.ts).
      const marketMove = await marketMoveFactor(order.userId);
      const fill = await db.runTransaction((transaction) =>
        executeSweepFill(transaction, { order, orderDoc, marketRef, openingPrice, marketMove }),
      );

      // Crew mission progress (fire-and-forget, same as executeTrade)
      if (fill.crew) {
        updateCrewMissionProgress(
          fill.crew,
          order.userId,
          'sell',
          fill.fillShares,
          order.ticker,
          fill.executedPrice * fill.fillShares,
        );
      }
      await writeNotification(order.userId, {
        type: 'trade',
        title: 'Stop Loss Filled',
        message: `Your stop loss for ${fill.fillShares} $${order.ticker} executed at $${fill.executedPrice.toFixed(2)}`,
        data: { ticker: order.ticker, orderId: orderDoc.id, price: fill.executedPrice },
      });
      summary.stopLossFilled++;
    } catch (err) {
      logger.info(`runMarketOpenProcessing: stop loss ${orderDoc.id} skipped — ${(err as Error).message}`);
      summary.stopLossSkipped++;
    }
  }
};
