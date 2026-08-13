'use strict';
// User-facing margin actions: repay, bailout, toggle, interest.
//
// The scheduled liquidation scanners that used to live here are in
// marginScanners.js, and syncPortfolio moved to portfolio.js.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const {
  ADMIN_UID, TWENTY_FOUR_HOURS_MS,
  MARGIN_INTEREST_RATE, MARGIN_CASH_MINIMUM, CREW_REJOIN_LOCKOUT_MS, BAILOUT_CASH,
  MARGIN_MIN_CHECKINS, MARGIN_MIN_TRADES, MARGIN_MIN_PEAK_PORTFOLIO,
} = require('../constants');
const { checkBanned, checkDiscordWall, touchLastActive, grantedValueUpdate } = require('../helpers');

exports.repayMargin = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'margin');
  const { amount } = data;

  if (!amount || !Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid repay amount.');
  }

  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    const marginUsed = userData.marginUsed || 0;

    if (marginUsed <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'No margin debt.');
    }
    if ((userData.cash || 0) < amount) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    const repayAmount = Math.min(amount, marginUsed);
    const newMarginUsed = marginUsed - repayAmount;

    transaction.update(userRef, {
      cash: (userData.cash || 0) - repayAmount,
      marginUsed: newMarginUsed < 0.01 ? 0 : Math.round(newMarginUsed * 100) / 100,
      marginCallAt: null
    });

    return { success: true, repaid: repayAmount, remaining: newMarginUsed < 0.01 ? 0 : newMarginUsed };
  });
});

/**
 * Bankruptcy bailout - reset to $500
 */
exports.bailout = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'margin');
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    if (!userData.isBankrupt) {
      throw new functions.https.HttpsError('failed-precondition', 'You can still recover. Sell or close a position to clear your debt. A bailout is only for a fully wiped out account.');
    }

    // Enforce 24-hour cooldown between bailouts
    if (userData.lastBailout && (Date.now() - userData.lastBailout) < TWENTY_FOUR_HOURS_MS) {
      throw new functions.https.HttpsError('failed-precondition', 'Bailout available once per 24 hours.');
    }

    const currentCrew = userData.crew;

    const bailoutUpdates = {
      cash: BAILOUT_CASH,
      // A bailout wipes the portfolio and hands back BAILOUT_CASH, so afterwards
      // the WHOLE balance is granted money. Book all of it, or the rebuild from
      // zero reads as a spectacular trading run on the percent boards.
      ...grantedValueUpdate(BAILOUT_CASH),
      holdings: {},
      shorts: {},
      hasOpenShorts: false,
      costBasis: {},
      // The shares these locks referred to are destroyed above, so the locks must
      // go with them. Left behind, lockedShares() still counts them and blocks the
      // player from selling shares they buy AFTER the bailout ("50 margin-locked"
      // against a holding of 10), until the stale lock expires hours later.
      marginLockup: {},
      ipoLockup: {},
      portfolioValue: BAILOUT_CASH,
      marginEnabled: false,
      marginUsed: 0,
      isBankrupt: false,
      bankruptAt: null,
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      lastBailout: Date.now(),
      shortHistory: {},
      lowestWhileHolding: {},
      tickerTradeHistory: {}
    };
    // A bailout kicks you from your crew; lock rejoining it for 30 days.
    if (currentCrew) {
      bailoutUpdates[`crewLockouts.${currentCrew}`] = Date.now() + CREW_REJOIN_LOCKOUT_MS;
    }
    transaction.update(userRef, bailoutUpdates);

    return { success: true, hadCrew: !!currentCrew };
  });
});

/**
 * Toggle margin trading (enable/disable)
 */
exports.toggleMargin = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'margin');
  const { enable } = data;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);

    if (enable) {
      const isAdmin = uid === ADMIN_UID;
      if (!isAdmin) {
        if ((userData.cash || 0) < MARGIN_CASH_MINIMUM) {
          throw new functions.https.HttpsError('failed-precondition', `Need $${MARGIN_CASH_MINIMUM.toLocaleString()} minimum cash.`);
        }
        // The same three requirements MarginModal displays. Mirrors
        // checkMarginEligibility in src/utils/calculations.js. If either side
        // changes, change both or the app shows a checklist the server ignores.
        if ((userData.totalCheckins || 0) < MARGIN_MIN_CHECKINS) {
          throw new functions.https.HttpsError('failed-precondition', `Need ${MARGIN_MIN_CHECKINS} daily check-ins.`);
        }
        if ((userData.totalTrades || 0) < MARGIN_MIN_TRADES) {
          throw new functions.https.HttpsError('failed-precondition', `Need ${MARGIN_MIN_TRADES} total trades.`);
        }
        if ((userData.peakPortfolioValue || 0) < MARGIN_MIN_PEAK_PORTFOLIO) {
          throw new functions.https.HttpsError('failed-precondition', `Need a $${MARGIN_MIN_PEAK_PORTFOLIO.toLocaleString()} peak portfolio.`);
        }
      }
      transaction.update(userRef, {
        marginEnabled: true,
        marginUsed: 0,
        marginEnabledAt: Date.now()
      });
    } else {
      // Check no outstanding margin
      if ((userData.marginUsed || 0) >= 0.01) {
        throw new functions.https.HttpsError('failed-precondition', 'Repay all margin debt first.');
      }
      transaction.update(userRef, {
        marginEnabled: false,
        marginUsed: 0
      });
    }

    return { success: true, marginEnabled: enable };
  });
});

/**
 * Charge daily margin interest
 */
exports.chargeMarginInterest = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    const marginUsed = userData.marginUsed || 0;

    if (marginUsed <= 0 || !userData.marginEnabled) {
      return { success: true, charged: 0 };
    }

    const lastCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    if (now - lastCharge < TWENTY_FOUR_HOURS_MS) {
      return { success: true, charged: 0, reason: 'Already charged today' };
    }

    const interest = marginUsed * MARGIN_INTEREST_RATE;
    transaction.update(userRef, {
      marginUsed: marginUsed + interest,
      lastMarginInterestCharge: now
    });

    return { success: true, charged: interest };
  });
});
