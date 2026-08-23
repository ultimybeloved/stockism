'use strict';
// Limit orders: the player-facing callable that creates one, plus the schedule
// that sweeps the book. The matching engine itself is in limitOrderMatching.js.

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const {
  isWeeklyTradingHalt, NINETY_DAYS_MS,
  MIN_TRADE_SHARES, MIN_EXIT_SHARES, MAX_TRADE_SHARES, TRADE_SHARE_DECIMALS,
} = require('../constants');
const { touchLastActive, lockedShares, checkDiscordWall, recordHeartbeat } = require('../helpers');
const { runLimitOrderCheck } = require('./limitOrderMatching');

exports.createLimitOrder = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Block during weekly halt
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Market closed for chapter review. Trading resumes at 21:00 UTC.'
    );
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'limitOrders');
  const { ticker, type, shares, limitPrice, allowPartialFills } = data;

  // Validate ticker against character whitelist
  if (!ticker || !CHARACTERS.some(c => c.ticker === ticker)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }

  // Validate order type (BUY/SELL/STOP_LOSS supported — SHORT/COVER can't execute in checkLimitOrders)
  if (!type || !['BUY', 'SELL', 'STOP_LOSS'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Limit orders support BUY, SELL, and STOP_LOSS only.');
  }

  // Validate shares. Exits (SELL/STOP_LOSS) allow fractional dust so a position
  // built from dividends or partial fills can be closed in full; BUY stays on
  // whole-cent share counts.
  const isExitOrder = type === 'SELL' || type === 'STOP_LOSS';
  const minShares = isExitOrder ? MIN_EXIT_SHARES : MIN_TRADE_SHARES;
  const entryStep = 10 ** TRADE_SHARE_DECIMALS;
  if (!shares || !Number.isFinite(shares) || shares < minShares || shares > MAX_TRADE_SHARES ||
      (!isExitOrder && Math.round(shares * entryStep) / entryStep !== shares)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid share quantity.');
  }

  // Validate limit price (must be finite positive number, max 10000)
  if (!limitPrice || !Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid limit price.');
  }

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found.');
  }

  const userData = userDoc.data();

  // Check if user is banned
  if (userData.isBanned) {
    throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
  }

  // Suspected-alt wall: same gate as executeTrade, or queued orders bypass it
  checkDiscordWall(userData);

  // Check if user is bankrupt or in debt
  if (userData.isBankrupt) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot create orders while bankrupt.');
  }
  if ((userData.cash || 0) < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot create orders while in debt.');
  }

  // Block orders on IPO-phase tickers that haven't launched — queued orders
  // would otherwise bypass the IPO's per-user and supply limits entirely.
  if (CHARACTER_MAP[ticker]?.ipoRequired) {
    const marketSnap = await db.collection('market').doc('current').get();
    const launchedTickers = marketSnap.data()?.launchedTickers || [];
    if (!launchedTickers.includes(ticker)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `${ticker} is in IPO phase. Use the IPO panel to purchase shares.`
      );
    }
  }

  // Fetch active orders early (needed for validation checks below).
  // PARTIALLY_FILLED orders are still live, so they count toward the cap,
  // reserved shares, and the duplicate check just like PENDING ones.
  const pendingOrders = await db.collection('limitOrders')
    .where('userId', '==', uid)
    .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
    .get();

  if (pendingOrders.size >= 20) {
    throw new functions.https.HttpsError('resource-exhausted', 'Maximum 20 pending orders allowed.');
  }

  // Validate holdings for SELL/STOP_LOSS orders (account for shares reserved by pending sells/stop losses)
  if (type === 'SELL' || type === 'STOP_LOSS') {
    const currentHoldings = userData.holdings?.[ticker] || 0;
    if (currentHoldings < shares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient holdings to sell.');
    }
    const pendingSellShares = pendingOrders.docs
      .filter(doc => {
        const o = doc.data();
        return o.ticker === ticker && (o.type === 'SELL' || o.type === 'STOP_LOSS');
      })
      .reduce((sum, doc) => {
        const o = doc.data();
        return sum + (o.shares - (o.filledShares || 0)); // only the unfilled remainder is still reserved
      }, 0);
    if (currentHoldings < shares + pendingSellShares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient holdings (some shares reserved by pending orders).');
    }

    // Lockups: can't queue a sell / stop-loss against IPO- or margin-locked shares
    // (otherwise a queued order would dodge the hold and flip the position).
    const locks = lockedShares(userData, ticker);
    if (locks.total > 0) {
      const freeShares = Math.max(0, currentHoldings - locks.total);
      if (shares > freeShares) {
        const parts = [];
        if (locks.ipo > 0) parts.push(`${locks.ipo} IPO-locked`);
        if (locks.margin > 0) parts.push(`${locks.margin} margin-locked`);
        throw new functions.https.HttpsError('failed-precondition',
          `Some $${ticker} shares are locked (${parts.join(', ')}). You can place a sell for up to ${freeShares} now.`);
      }
    }
  }

  // Validate short positions for COVER orders
  if (type === 'COVER') {
    const shortShares = userData.shorts?.[ticker]?.shares || 0;
    if (shortShares < shares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient short shares to cover.');
    }
  }

  // Anti-manipulation: Block SELL/STOP_LOSS if user has an active short on same ticker
  if (type === 'SELL' || type === 'STOP_LOSS') {
    const shortShares = userData.shorts?.[ticker]?.shares || 0;
    if (shortShares > 0) {
      throw new functions.https.HttpsError('failed-precondition',
        'Cannot place a sell order while you have an active short on this stock.');
    }
  }

  // Block duplicate limit orders on same ticker + type
  // Treat SELL and STOP_LOSS as equivalent to prevent double-selling
  const sellTypes = ['SELL', 'STOP_LOSS'];
  const isSellType = sellTypes.includes(type);
  const existingOrderOnTicker = pendingOrders.docs.some(doc => {
    const o = doc.data();
    const isExistingSellType = sellTypes.includes(o.type);
    return o.ticker === ticker && (isSellType ? isExistingSellType : o.type === type);
  });
  if (existingOrderOnTicker) {
    throw new functions.https.HttpsError('already-exists',
      `You already have a pending sell or stop-loss order on ${ticker}. Cancel it first.`);
  }

  // Create the order
  const expiresAt = Date.now() + NINETY_DAYS_MS; // 90 days
  const orderRef = await db.collection('limitOrders').add({
    userId: uid,
    ticker,
    type,
    shares,
    limitPrice,
    allowPartialFills: !!allowPartialFills,
    status: 'PENDING',
    filledShares: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, orderId: orderRef.id };
});

exports.checkLimitOrders = cf().pubsub
  .schedule('every 15 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    // Skip during weekly halt — don't execute pending orders. The time gate
    // lives here (not in runLimitOrderCheck) so the emulator test can run the
    // processing on any day; the admin-halt gate is data-driven and stays inside.
    if (isWeeklyTradingHalt()) {
      console.log('Skipping limit order check — weekly trading halt active');
      return { success: true, skipped: true, reason: 'weekly_halt' };
    }
    const result = await runLimitOrderCheck();
    await recordHeartbeat('checkLimitOrders');
    return result;
  });

// Exposed for the emulator end-to-end test (scripts/test-limitorders-emulator.cjs)
exports.runLimitOrderCheck = runLimitOrderCheck;

// ============================================
// SECURE OPERATIONS - Moved from client-side
// These operations modify protected fields (cash, holdings, shorts, marginUsed)
// and must go through Cloud Functions to prevent exploits
// ============================================

/**
 * Claim mission reward (daily or weekly)
 */
