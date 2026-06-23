'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const { PRE_MARKET_START_MINUTE, PRE_MARKET_LOCK_MINUTE, WEEKLY_HALT_END_MINUTE, PRE_MARKET_MAX_BUY_BUFFER } = require('../constants');
const { touchLastActive, lockedShares } = require('../helpers');

// Placement closes at the lock (20:55), not at market open — the auction
// settles opening prices at 20:56 while the market is still halted.
const isPreMarketWindow = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= PRE_MARKET_START_MINUTE && utcMins < PRE_MARKET_LOCK_MINUTE;
};

const getThisWeeksPreMarketStart = () => {
  const now = new Date();
  const d = new Date(now);
  d.setUTCHours(20, 30, 0, 0);
  return admin.firestore.Timestamp.fromDate(d);
};

exports.createPreMarketOrder = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  if (!isPreMarketWindow()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Pre-market orders can only be placed between 20:30 and 20:55 UTC on Thursdays.'
    );
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { ticker, action, shares, allowPartialFills = false } = data;

  if (!ticker || !CHARACTERS.some(c => c.ticker === ticker)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }

  if (!action || !['buy', 'sell'].includes(action)) {
    throw new functions.https.HttpsError('invalid-argument', 'Action must be buy or sell.');
  }

  if (!shares || !Number.isFinite(shares) || shares < 0.01 || shares > 10000 ||
      Math.round(shares * 100) / 100 !== shares) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid share quantity.');
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found.');
  }
  const userData = userDoc.data();

  if (userData.isBanned) {
    throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
  }
  if (userData.isBankrupt) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot place orders while bankrupt.');
  }
  if ((userData.cash || 0) < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot place orders while in debt.');
  }

  const preMarketStart = getThisWeeksPreMarketStart();

  // Max 1 active buy and 1 active sell per ticker per user per session
  const duplicate = await db.collection('preMarketOrders')
    .where('userId', '==', uid)
    .where('ticker', '==', ticker)
    .where('action', '==', action)
    .where('status', '==', 'PENDING')
    .where('createdAt', '>=', preMarketStart)
    .limit(1)
    .get();

  if (!duplicate.empty) {
    throw new functions.https.HttpsError(
      'already-exists',
      `You already have a pending ${action} order for $${ticker}. Cancel it first to replace it.`
    );
  }

  const marketSnap = await db.collection('market').doc('current').get();
  const currentPrice = marketSnap.data()?.prices?.[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;

  // Block orders on IPO-phase tickers that haven't launched — queued orders
  // would otherwise bypass the IPO's per-user and supply limits entirely.
  const launchedTickers = marketSnap.data()?.launchedTickers || [];
  if (CHARACTER_MAP[ticker]?.ipoRequired && !launchedTickers.includes(ticker)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `${ticker} is in IPO phase. Use the IPO panel to purchase shares.`
    );
  }

  // Anti-manipulation: no sell orders on a ticker you're short on (same rule as limit orders)
  if (action === 'sell' && (userData.shorts?.[ticker]?.shares || 0) > 0) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Cannot place a sell order while you have an active short on this stock.'
    );
  }

  if (action === 'buy') {
    // Sum up cash already committed to other pending buy orders this session
    const pendingBuys = await db.collection('preMarketOrders')
      .where('userId', '==', uid)
      .where('action', '==', 'buy')
      .where('status', '==', 'PENDING')
      .where('createdAt', '>=', preMarketStart)
      .get();

    // Cost estimates include headroom for auction impact + spread, so a
    // passing order can't become unaffordable at the opening ask.
    const allPrices = marketSnap.data()?.prices || {};
    const reservedCash = Math.round(
      pendingBuys.docs.reduce((sum, doc) => {
        const o = doc.data();
        return sum + o.shares * (allPrices[o.ticker] || CHARACTER_MAP[o.ticker]?.basePrice || 0) * PRE_MARKET_MAX_BUY_BUFFER;
      }, 0) * 100
    ) / 100;

    const estimatedCost = Math.round(shares * currentPrice * PRE_MARKET_MAX_BUY_BUFFER * 100) / 100;
    const availableCash = Math.round(((userData.cash || 0) - reservedCash) * 100) / 100;

    if (estimatedCost > availableCash) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        reservedCash > 0
          ? `Insufficient cash. Estimated cost with opening-price headroom: $${estimatedCost.toFixed(2)}, reserved by other orders: $${reservedCash.toFixed(2)}, available: $${availableCash.toFixed(2)}.`
          : `Insufficient cash. Estimated cost with opening-price headroom: $${estimatedCost.toFixed(2)}, available: $${availableCash.toFixed(2)}.`
      );
    }
  } else {
    const currentHoldings = userData.holdings?.[ticker] || 0;

    // Account for shares already reserved by other pending pre-market sells on this ticker
    const pendingSells = await db.collection('preMarketOrders')
      .where('userId', '==', uid)
      .where('ticker', '==', ticker)
      .where('action', '==', 'sell')
      .where('status', '==', 'PENDING')
      .where('createdAt', '>=', preMarketStart)
      .get();

    const reservedShares = pendingSells.docs.reduce((sum, doc) => sum + (doc.data().shares || 0), 0);
    // Locked shares (IPO / margin holds) can't be queued for sale either, so a
    // pre-market order can't be used to dodge the hold.
    const locked = lockedShares(userData, ticker).total;
    const availableShares = Math.round((currentHoldings - reservedShares - locked) * 10000) / 10000;

    if (availableShares < shares) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Insufficient sellable shares. Holdings: ${currentHoldings}, reserved: ${reservedShares}, locked: ${locked}, available: ${availableShares}.`
      );
    }
  }

  const sessionDate = new Date().toISOString().slice(0, 10);
  const orderId = `${uid}_${sessionDate}_${ticker}_${action}`;
  await db.collection('preMarketOrders').doc(orderId).set({
    userId: uid,
    ticker,
    action,
    shares,
    allowPartialFills,
    status: 'PENDING',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    executedAt: null,
    executedPrice: null,
    filledShares: null
  });

  return { success: true };
});

exports.cancelPreMarketOrder = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Orders lock 5 minutes before open — prevents spoofing via late cancellations
  const now = new Date();
  if (now.getUTCDay() === 4) {
    const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
    if (utcMins >= PRE_MARKET_LOCK_MINUTE && utcMins < WEEKLY_HALT_END_MINUTE) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'Orders are locked in the final 5 minutes before market open. Your order will execute at 21:00 UTC.'
      );
    }
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { orderId } = data;

  if (!orderId) {
    throw new functions.https.HttpsError('invalid-argument', 'Order ID required.');
  }

  const orderDoc = await db.collection('preMarketOrders').doc(orderId).get();
  if (!orderDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Order not found.');
  }

  const order = orderDoc.data();
  if (order.userId !== uid) {
    throw new functions.https.HttpsError('permission-denied', 'Cannot cancel another user\'s order.');
  }
  if (order.status !== 'PENDING') {
    throw new functions.https.HttpsError('failed-precondition', 'Order is not pending and cannot be cancelled.');
  }

  await db.collection('preMarketOrders').doc(orderId).update({
    status: 'CANCELED',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});
