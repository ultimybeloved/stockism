'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { PRE_MARKET_START_MINUTE, PRE_MARKET_LOCK_MINUTE, WEEKLY_HALT_END_MINUTE } = require('../constants');

const isPreMarketWindow = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= PRE_MARKET_START_MINUTE && utcMins < WEEKLY_HALT_END_MINUTE;
};

const getThisWeeksPreMarketStart = () => {
  const now = new Date();
  const d = new Date(now);
  d.setUTCHours(20, 30, 0, 0);
  return admin.firestore.Timestamp.fromDate(d);
};

exports.createPreMarketOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  if (!isPreMarketWindow()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Pre-market orders can only be placed between 20:30 and 21:00 UTC on Thursdays.'
    );
  }

  const uid = context.auth.uid;
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
  const currentPrice = marketSnap.data()?.prices?.[ticker] || 0;

  if (action === 'buy') {
    const estimatedCost = Math.round(shares * currentPrice * 100) / 100;
    if (estimatedCost > (userData.cash || 0)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Insufficient cash. Estimated cost: $${estimatedCost.toFixed(2)}, available: $${(userData.cash || 0).toFixed(2)}.`
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
    const availableShares = Math.round((currentHoldings - reservedShares) * 10000) / 10000;

    if (availableShares < shares) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Insufficient shares. Holdings: ${currentHoldings}, reserved by other orders: ${reservedShares}, available: ${availableShares}.`
      );
    }
  }

  await db.collection('preMarketOrders').add({
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

exports.cancelPreMarketOrder = functions.https.onCall(async (data, context) => {
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
