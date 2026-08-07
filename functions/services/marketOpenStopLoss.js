'use strict';
// The stop-loss sweep that runs at market open, right after the pre-market
// auction sets opening prices. INTERNAL MODULE — required by marketOrders.js,
// not exported through functions/index.js.
//
// Split out of marketOrders.js when that file passed the 600-line limit. It is
// its own mechanism: the auction is a batch price discovery, this is a
// per-order liquidation triggered by the price the auction landed on.
//
// A stop loss that fills through the regular 15-minute sweep goes through
// limitOrderFill instead. Both must stay in step — see the exit-loyalty note on
// executeSweepFill.
//
// npm run test:premarket covers this path.

const admin = require('firebase-admin');
const db = admin.firestore();

const {
  MAX_TRADES_PER_TICKER_24H, MAX_DAILY_IMPACT,
} = require('../constants');
const {
  writeNotification, writeFeedEntry, calculateMarginalImpact, getAccountAgeImpactFactor,
  pruneAndSumTradeHistory, appendPriceHistory, lockedShares, buildTradeCreditUpdates,
  recordTrade, round2, spreadFor,
} = require('../helpers');
const { updateCrewMissionProgress } = require('./crewMissionProgress');
const { computePriceUpdates, buildTrailingEntries } = require('./tradePricing');
const { pruneHistoryMap, appendTradeEntries } = require('./tradeState');

/**
 * Fill one stop loss inside a transaction. Returns what the post-commit
 * notifications need. Throws to skip the order.
 *
 * NOTE: unlike limitOrderFill.applySellFill, this does NOT apply the exit
 * loyalty discount, so a long-held position pays full impact when its stop
 * triggers at the open but a reduced one when it triggers mid-week. That
 * difference predates the split and is left as-is deliberately — changing it
 * changes what players are paid.
 */
const executeSweepFill = async (transaction, { order, orderDoc, marketRef, openingPrice }) => {
  const userRef = db.collection('users').doc(order.userId);

  const freshOrderSnap = await transaction.get(orderDoc.ref);
  if (!freshOrderSnap.exists || !['PENDING', 'PARTIALLY_FILLED'].includes(freshOrderSnap.data().status)) {
    throw new Error('Order already processed');
  }
  const freshAlreadyFilled = freshOrderSnap.data().filledShares || 0;
  const userSnap = await transaction.get(userRef);
  const freshMarketSnap = await transaction.get(marketRef);
  if (!userSnap.exists) throw new Error('User not found');

  const userData = userSnap.data();
  const freshPrices = freshMarketSnap.data().prices || {};
  const freshPrice = freshPrices[order.ticker] || openingPrice;

  if (userData.isBankrupt || (userData.cash || 0) < 0) throw new Error('User is bankrupt');
  if (userData.requiresDiscordLink && !userData.discordId) throw new Error('Discord verification required');

  // Locks re-checked at fill time: shares locked after the stop loss was placed
  // (e.g. a margin buy) can't be sold by the sweep.
  let fillShares = order.shares - freshAlreadyFilled;
  const userShares = userData.holdings?.[order.ticker] || 0;
  const lockedNow = lockedShares(userData, order.ticker).total;
  const sellableShares = Math.max(0, Math.round((userShares - lockedNow) * 10000) / 10000);
  if (sellableShares < fillShares) {
    if (order.allowPartialFills && sellableShares > 0) fillShares = sellableShares;
    else throw new Error('Insufficient shares');
  }

  const now = Date.now();
  const tickerTradeHistory = userData.tickerTradeHistory || {};
  const { totalShares: cumVol, count: tradeCount } =
    pruneAndSumTradeHistory(tickerTradeHistory[order.ticker]?.sell || [], now);
  if (tradeCount >= MAX_TRADES_PER_TICKER_24H) throw new Error('Trade limit reached');

  // Daily 10% impact cap (same rule as executeTrade): the stop loss still fills,
  // but stops moving the price once the user's daily impact allowance on this
  // ticker is used up. New accounts move less.
  let dailyImpact = 0;
  for (const act of ['buy', 'sell', 'short', 'cover']) {
    const { totalImpact } = pruneAndSumTradeHistory(tickerTradeHistory[order.ticker]?.[act] || [], now);
    dailyImpact += totalImpact;
  }
  const effectiveImpact = Math.min(
    calculateMarginalImpact(freshPrice, fillShares, cumVol) * getAccountAgeImpactFactor(userData),
    freshPrice * Math.max(0, MAX_DAILY_IMPACT - dailyImpact)
  );
  const impactPercent = freshPrice > 0 ? effectiveImpact / freshPrice : 0;

  const newMarketPrice = Math.max(0.01, round2(freshPrice - effectiveImpact));
  const bidPrice = newMarketPrice * (1 - spreadFor(order.ticker) / 2);
  const executedPrice = round2(bidPrice);

  // Trailing effects + parent-ETF propagation, same as every other fill lane.
  const priceUpdates = effectiveImpact > 0
    ? computePriceUpdates({ ticker: order.ticker, currentPrice: freshPrice, newPrice: newMarketPrice, prices: freshPrices })
    : {};
  const trailingEntries = buildTrailingEntries({
    priceUpdates, ticker: order.ticker, prices: freshPrices, action: 'sell', now,
  });
  const updatedHistory = appendTradeEntries(
    pruneHistoryMap(tickerTradeHistory, now),
    order.ticker, 'sell',
    { ts: now, shares: fillShares, impact: impactPercent },
    trailingEntries
  );

  const newHoldings = Math.round((userShares - fillShares) * 10000) / 10000;
  // Mission/stat credit — same fields executeTrade writes (includes the
  // totalTrades increment), so sweep fills count like regular trades.
  const { updates: creditUpdates } = buildTradeCreditUpdates({
    userData, ticker: order.ticker, action: 'sell', shares: fillShares,
    totalValue: executedPrice * fillShares, executionPrice: executedPrice,
    marketPrice: freshPrice, now,
  });
  const updates = {
    cash: admin.firestore.FieldValue.increment(executedPrice * fillShares),
    [`holdings.${order.ticker}`]: newHoldings,
    lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
    tickerTradeHistory: updatedHistory,
    ...creditUpdates,
  };
  if (newHoldings <= 0) {
    updates[`holdings.${order.ticker}`] = admin.firestore.FieldValue.delete();
    updates[`costBasis.${order.ticker}`] = admin.firestore.FieldValue.delete();
    updates[`lowestWhileHolding.${order.ticker}`] = admin.firestore.FieldValue.delete();
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
    const priceWrites = {};
    const historyPoints = {};
    for (const [t, price] of moved) {
      priceWrites[`prices.${t}`] = price;
      historyPoints[t] = { timestamp: now, price };
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
    executedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return {
    fillShares,
    executedPrice,
    displayName: userData.displayName || 'Anonymous',
    crew: userData.crew || null,
  };
};

/**
 * Walk every open stop loss and fill the ones the opening price triggered.
 * Mutates `summary` (stopLossFilled / stopLossSkipped) the way the caller's
 * other sections do.
 */
const runStopLossSweep = async ({ marketRef, openingPrices, summary }) => {
  const ordersSnapshot = await db.collection('limitOrders')
    .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
    .get();

  console.log(`runMarketOpenProcessing: checking ${ordersSnapshot.size} limit orders`);

  for (const orderDoc of ordersSnapshot.docs) {
    const order = orderDoc.data();
    if (order.type !== 'STOP_LOSS') continue;

    const openingPrice = openingPrices[order.ticker];
    if (!openingPrice || openingPrice > order.limitPrice) continue;

    try {
      const fill = await db.runTransaction((transaction) =>
        executeSweepFill(transaction, { order, orderDoc, marketRef, openingPrice }));

      // Crew mission progress (fire-and-forget, same as executeTrade)
      if (fill.crew) {
        updateCrewMissionProgress(
          fill.crew, order.userId, 'sell', fill.fillShares, order.ticker,
          fill.executedPrice * fill.fillShares
        );
      }
      await writeNotification(order.userId, {
        type: 'trade',
        title: 'Stop Loss Filled',
        message: `Your stop loss for ${fill.fillShares} $${order.ticker} executed at $${fill.executedPrice.toFixed(2)}`,
        data: { ticker: order.ticker, orderId: orderDoc.id, price: fill.executedPrice },
      });
      writeFeedEntry({
        type: 'trade',
        userId: order.userId,
        displayName: fill.displayName,
        crew: fill.crew,
        ticker: order.ticker,
        action: 'sell',
        amount: fill.fillShares,
        price: fill.executedPrice,
        message: `sold ${fill.fillShares} $${order.ticker} via stop loss`,
      });
      summary.stopLossFilled++;
    } catch (err) {
      console.log(`runMarketOpenProcessing: stop loss ${orderDoc.id} skipped — ${err.message}`);
      summary.stopLossSkipped++;
    }
  }
};

module.exports = { runStopLossSweep };
