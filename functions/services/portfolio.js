'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
// Modular import (not admin.firestore.FieldValue): the emulator sandbox strips
// the namespaced statics, and this form works in both prod and sandbox.
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const { CHARACTER_MAP } = require('../characters');
const { BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MIN_PRICE, DUST_MAX_VALUE, isWeeklyTradingHalt } = require('../constants');
const { touchLastActive, lockedShares, reportError, checkDiscordWall } = require('../helpers');

const round2 = (n) => Math.round(n * 100) / 100;
const getSpread = (ticker) => (CHARACTER_MAP[ticker]?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD);

/**
 * Dust cleanup: liquidate all of a user's tiny long positions (market value
 * below DUST_MAX_VALUE) to cash in a single pass.
 *
 * Why this exists and isn't just a "sell all" loop: the normal trade path only
 * accepts sell amounts of >= 0.01 shares in 0.01 steps, but holdings are stored
 * to 4 decimals. Sub-0.01-share slivers are therefore un-sellable and pile up as
 * "a few cents in every stock". This sweep sells at the current bid with no
 * price impact (the amounts are far below what moves the market) and clears the
 * whole position, slivers included.
 *
 * Deliberately NOT a trade: it does not touch trade history, trade counts, or
 * mission progress, so it can't be used to farm trade-count missions. Locked
 * shares (IPO / margin holds) are skipped entirely.
 */
exports.sweepDustPositions = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Selling dust is still selling — it follows the same halt rules as trades.
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError('failed-precondition', 'Market is closed for the weekly halt.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  let result = { swept: 0, proceeds: 0 };

  try {
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }
      const marketSnap = await transaction.get(marketRef);

      const userData = userSnap.data();
      if (userData.isBanned) {
        throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
      }
      // Suspected-alt wall: a dust sweep converts shares to cash like any sell
      checkDiscordWall(userData);

      const marketData = marketSnap.exists ? marketSnap.data() : {};
      if (marketData.marketHalted) {
        throw new functions.https.HttpsError('failed-precondition', marketData.haltReason || 'Market is currently halted.');
      }

      const prices = marketData.prices || {};
      const haltedTickers = marketData.haltedTickers || {};
      const holdings = userData.holdings || {};
      const now = Date.now();

      let proceeds = 0;
      let swept = 0;
      const updates = {};

      for (const [ticker, sharesRaw] of Object.entries(holdings)) {
        const shares = sharesRaw || 0;
        if (shares <= 0) continue;

        const price = prices[ticker] != null ? prices[ticker] : (CHARACTER_MAP[ticker]?.basePrice || 0);
        if (!(price > 0)) continue;

        // Only tiny positions.
        if (shares * price >= DUST_MAX_VALUE) continue;

        // Skip tickers under a circuit-breaker halt.
        const tickerHalt = haltedTickers[ticker];
        if (tickerHalt && tickerHalt.resumeAt && now < tickerHalt.resumeAt) continue;

        // Never sweep locked shares (IPO lockup / margin-funded holds). If any
        // part of the position is locked, leave the whole thing alone.
        if (lockedShares(userData, ticker, now).total > 0) continue;

        const bid = Math.max(MIN_PRICE, round2(price * (1 - getSpread(ticker) / 2)));
        proceeds += bid * shares;
        swept++;

        updates[`holdings.${ticker}`] = FieldValue.delete();
        updates[`costBasis.${ticker}`] = FieldValue.delete();
        updates[`lowestWhileHolding.${ticker}`] = FieldValue.delete();
        // Position is fully closed — drop the dividend cohort like the normal
        // sell path does (also resets the ETF firstHeldAt clock).
        updates[`holdingCohorts.${ticker}`] = FieldValue.delete();
      }

      if (swept === 0) {
        result = { swept: 0, proceeds: 0 };
        return;
      }

      proceeds = round2(proceeds);
      updates.cash = FieldValue.increment(proceeds);
      updates.lastTradeTime = FieldValue.serverTimestamp();
      transaction.update(userRef, updates);

      result = { swept, proceeds };
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    reportError(err, { where: 'sweepDustPositions', uid });
    throw new functions.https.HttpsError('internal', 'Could not clean up dust.');
  }

  return { success: true, ...result };
});
