'use strict';
// Limit-order matching engine. INTERNAL MODULE — not exported through
// functions/index.js, same pattern as tradeGuards/tradeActions.
//
// runLimitOrderCheck() is the whole order book sweep: it walks open orders, fills
// the ones whose trigger price has been crossed, moves the market price, and
// credits mission/stat progress for each fill. limitOrders.js owns the callable
// and the schedule that drive it; this file is just the engine.
//
// This file is the ORCHESTRATOR only — screening lives in limitOrderGuards.js,
// the fill math and writes in limitOrderFill.js, and the post-commit
// notification/feed/mission work in limitOrderEffects.js. Same layering as
// executeTrade. Keep the shape: read market -> loop orders -> screen -> one
// transaction per fill -> effects after it commits.
//
// npm run test:limitorders covers this — run it before and after any change.

const admin = require('firebase-admin');
const db = admin.firestore();

const { ORDERS_PER_TICKER_PER_CYCLE } = require('../constants');
const {
  screenOrder, screenUser, isTickerHalted, triggerMet,
  assertOrderStillActive, assertUserEligible, assertLimitStillMet,
  assertTradeLimit, resolveFillShares, readActionHistory,
} = require('./limitOrderGuards');
const { computeImpact, applyBuyFill, applySellFill, markOrderFilled } = require('./limitOrderFill');
const { notifyCanceled, publishFill } = require('./limitOrderEffects');

// A failure inside the transaction either kills the order or defers it to the
// next cycle. These are the ones the user cannot recover from by waiting;
// everything else (locked shares, price drifted back out of range, a losing
// race) is a deferral, because the order is still perfectly valid.
const CANCEL_ON = [
  'User not found',
  'User is bankrupt',
  'Insufficient cash',
  'Insufficient shares',
  'Trade limit reached',
];

const closeOrder = (orderId, fields) =>
  db.collection('limitOrders').doc(orderId).update({
    ...fields,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

/**
 * Fill one order inside a transaction. Returns what the post-commit effects
 * need. Throws to cancel or defer — see CANCEL_ON.
 */
const fillOrder = async (transaction, { order, orderId, marketRef, now, currentPrice }) => {
  const orderRef = db.collection('limitOrders').doc(orderId);
  const userRef = db.collection('users').doc(order.userId);

  // All reads first.
  const freshOrderSnap = await transaction.get(orderRef);
  const userSnap = await transaction.get(userRef);
  const freshMarketSnap = await transaction.get(marketRef);

  const totalShares = order.shares;
  const { freshFilled, fillShares: requestedShares } = assertOrderStillActive(freshOrderSnap, totalShares);
  if (!userSnap.exists) throw new Error('User not found');
  if (!freshMarketSnap.exists) throw new Error('Market data not found');

  const userData = userSnap.data();
  const freshPrice = (freshMarketSnap.data().prices || {})[order.ticker] || currentPrice;

  assertLimitStillMet(order, freshPrice);
  assertUserEligible(userData);

  // STOP_LOSS executes as a sell — normalize for validation and execution.
  const effectiveType = order.type === 'STOP_LOSS' ? 'SELL' : order.type;
  // Tags the trade record so the player can see why it happened.
  const fillSource = order.type === 'STOP_LOSS' ? 'stop_loss' : 'limit';
  const action = effectiveType.toLowerCase();

  const fillShares = resolveFillShares({ effectiveType, order, userData, freshPrice, fillShares: requestedShares });

  const { totalShares: cumVolume, count: tradeCount } =
    readActionHistory(userData.tickerTradeHistory || {}, order.ticker, action, now);
  assertTradeLimit(tradeCount, action, order.ticker);

  const { effectiveImpact, impactPercent } =
    computeImpact({ userData, ticker: order.ticker, freshPrice, fillShares, cumVolume, now });

  const ctx = {
    order, orderId, userRef, marketRef, userData, freshPrice, fillShares, now,
    effectiveImpact, impactPercent, fillSource,
  };
  const { executedPrice, tradeValue } = effectiveType === 'BUY'
    ? applyBuyFill(transaction, ctx)
    : applySellFill(transaction, ctx);

  markOrderFilled(transaction, orderRef, {
    freshFilled, fillShares, totalShares, allowPartialFills: order.allowPartialFills, executedPrice,
  });

  return {
    fillShares,
    executedPrice,
    tradeValue,
    displayName: userData.displayName || 'Anonymous',
    crew: userData.crew || null,
  };
};

/**
 * Check and Execute Limit Orders
 * Runs every 2 minutes to check if any pending limit orders should execute
 */
const runLimitOrderCheck = async () => {
  try {
    console.log('Checking limit orders...');
    const startTime = Date.now();

    const marketRef = db.collection('market').doc('current');
    const marketSnap = await marketRef.get();
    if (!marketSnap.exists) {
      console.error('Market data not found');
      return { success: false, error: 'Market data missing' };
    }

    const marketData = marketSnap.data();
    if (marketData.marketHalted) {
      console.log('Skipping limit order check — emergency halt active');
      return { success: true, skipped: true, reason: 'emergency_halt' };
    }

    const prices = marketData.prices || {};
    const haltedTickersMap = marketData.haltedTickers || {};
    const launchedTickers = marketData.launchedTickers || [];

    const ordersSnapshot = await db.collection('limitOrders')
      .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
      .get();
    console.log(`Found ${ordersSnapshot.size} pending limit orders`);

    let executed = 0;
    let canceled = 0;
    let expired = 0;
    const now = Date.now();
    const tickerExecutionCount = {};

    for (const orderDoc of ordersSnapshot.docs) {
      try {
        const order = orderDoc.data();
        const orderId = orderDoc.id;

        const orderVerdict = screenOrder(order, { now, launchedTickers });
        if (orderVerdict) {
          await closeOrder(orderId, orderVerdict.status === 'EXPIRED'
            ? { status: 'EXPIRED' }
            : { status: 'CANCELED', cancelReason: orderVerdict.reason });
          if (orderVerdict.status === 'EXPIRED') {
            console.log(`Expired order ${orderId}`);
            expired++;
          } else {
            canceled++;
          }
          continue;
        }

        const orderUserDoc = await db.collection('users').doc(order.userId).get();
        if (orderUserDoc.exists) {
          const userVerdict = screenUser(orderUserDoc.data());
          if (userVerdict) {
            await closeOrder(orderId, { status: 'CANCELED', cancelReason: userVerdict.reason });
            console.log(`Cancelled order ${orderId}: ${userVerdict.log}`);
            canceled++;
            continue;
          }
        }

        const currentPrice = prices[order.ticker];
        if (!currentPrice) {
          console.log(`No price data for ${order.ticker}, skipping order ${orderId}`);
          continue;
        }
        if (isTickerHalted(haltedTickersMap, order.ticker)) continue;
        if (!triggerMet(order, currentPrice)) continue;

        const tickerCount = tickerExecutionCount[order.ticker] || 0;
        if (tickerCount >= ORDERS_PER_TICKER_PER_CYCLE) {
          console.log(`Throttled order ${orderId}: ${order.ticker} already had ${tickerCount} executions this cycle`);
          continue; // Will be picked up in the next 2-minute cycle
        }

        console.log(`Order ${orderId} should execute: ${order.type} ${order.shares} ${order.ticker} @ $${order.limitPrice} (current: $${currentPrice})`);

        let fill;
        try {
          fill = await db.runTransaction((transaction) =>
            fillOrder(transaction, { order, orderId, marketRef, now, currentPrice }));
        } catch (transactionError) {
          const msg = transactionError.message || '';
          if (CANCEL_ON.some((reason) => msg.includes(reason))) {
            console.log(`Canceling order ${orderId}: ${msg}`);
            await closeOrder(orderId, { status: 'CANCELED', cancelReason: msg });
            await notifyCanceled(order, orderId, msg);
            canceled++;
          } else {
            console.log(`Order ${orderId} deferred (will retry): ${msg}`);
          }
          continue;
        }

        tickerExecutionCount[order.ticker] = tickerCount + 1;
        await publishFill(order, orderId, fill);
        executed++;

      } catch (error) {
        console.error(`Error processing order ${orderDoc.id}:`, error);
      }
    }

    const result = {
      success: true,
      totalOrders: ordersSnapshot.size,
      executed,
      canceled,
      expired,
      elapsedSeconds: ((Date.now() - startTime) / 1000).toFixed(2),
    };
    console.log('Limit order check complete:', result);
    return result;

  } catch (error) {
    console.error('Limit order check failed:', error);
    return { success: false, error: error.message };
  }
};

module.exports = { runLimitOrderCheck };
