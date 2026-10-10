// User-facing margin actions: repay, bailout, toggle, interest.
//
// The scheduled liquidation scanners that used to live here are in
// marginScanners.js, and syncPortfolio moved to portfolio.js.
import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
const db = admin.firestore();
import {
  ADMIN_UID,
  TWENTY_FOUR_HOURS_MS,
  MARGIN_INTEREST_RATE,
  MARGIN_CASH_MINIMUM,
  CREW_REJOIN_LOCKOUT_MS,
  BAILOUT_CASH,
  MARGIN_MIN_CHECKINS,
  MARGIN_MIN_TRADES,
  MARGIN_MIN_PEAK_PORTFOLIO,
} from '../shared/constants';
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { touchLastActive } from '../shared/activity';
import { grantedValueUpdate } from '../shared/equity';
import type { UserData } from '../shared/types';

/** Margin and bailout fields the user doc carries beyond the shared shape. */
type MarginUser = UserData & {
  lastBailout?: number;
  totalCheckins?: number;
  totalTrades?: number;
  lastMarginInterestCharge?: number;
};
// Seasons average margin owed over time, so every change to marginUsed logs it.
import { seasonMarginUpdate } from '../season/seasonTiers';
import { recordLedger } from '../shared/ledger';

export const repayMargin = cf().https.onCall(async (data: { amount?: unknown }, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'margin');
  const { amount } = data as { amount: number };

  if (!amount || !Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid repay amount.');
  }

  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data() as MarginUser;
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

    const storedMarginUsed = newMarginUsed < 0.01 ? 0 : Math.round(newMarginUsed * 100) / 100;
    transaction.update(userRef, {
      cash: (userData.cash || 0) - repayAmount,
      marginUsed: storedMarginUsed,
      marginCallAt: null,
      ...seasonMarginUpdate(userData, storedMarginUsed),
    });
    recordLedger(transaction, {
      uid,
      type: 'margin_repay',
      amount: -repayAmount,
      cashAfter: (userData.cash || 0) - repayAmount,
      detail: { marginAfter: storedMarginUsed },
    });

    return { success: true, repaid: repayAmount, remaining: newMarginUsed < 0.01 ? 0 : newMarginUsed };
  });
});

/**
 * Bankruptcy bailout - wipes every position and resets cash to BAILOUT_CASH
 */
export const bailout = cf().https.onCall(async (_data: unknown, context) => {
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

    const userData = userDoc.data() as MarginUser;
    checkBanned(userData);
    checkDiscordWall(userData);
    if (!userData.isBankrupt) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'You can still recover. Sell or close a position to clear your debt. A bailout is only for a fully wiped out account.',
      );
    }

    // Enforce 24-hour cooldown between bailouts
    if (userData.lastBailout && Date.now() - userData.lastBailout < TWENTY_FOUR_HOURS_MS) {
      throw new functions.https.HttpsError('failed-precondition', 'Bailout available once per 24 hours.');
    }

    const currentCrew = userData.crew;

    const bailoutUpdates: Record<string, unknown> = {
      cash: BAILOUT_CASH,
      // A bailout wipes the portfolio and hands back BAILOUT_CASH, so afterwards
      // the WHOLE balance is granted money. Book all of it, or the rebuild from
      // zero reads as a spectacular trading run on the percent boards.
      ...grantedValueUpdate(BAILOUT_CASH),
      holdings: {},
      shorts: {},
      hasOpenShorts: false,
      costBasis: {},
      // The dividend/exit-loyalty lot ledger goes with the shares it describes.
      // Left behind, a rebuilt position inherited the wiped one's loyalty
      // standing: re-buy a stock you used to hold for months and the very first
      // sell got the long-hold discount on shares held for seconds.
      holdingCohorts: {},
      // The shares these locks referred to are destroyed above, so the locks must
      // go with them. Left behind, lockedShares() still counts them and blocks the
      // player from selling shares they buy AFTER the bailout ("50 margin-locked"
      // against a holding of 10), until the stale lock expires hours later.
      marginLockup: {},
      ipoLockup: {},
      portfolioValue: BAILOUT_CASH,
      marginEnabled: false,
      marginUsed: 0,
      ...seasonMarginUpdate(userData, 0),
      isBankrupt: false,
      bankruptAt: null,
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      lastBailout: Date.now(),
      shortHistory: {},
      lowestWhileHolding: {},
      tickerTradeHistory: {},
    };
    // A bailout kicks you from your crew; lock rejoining it for 30 days.
    if (currentCrew) {
      bailoutUpdates[`crewLockouts.${currentCrew}`] = Date.now() + CREW_REJOIN_LOCKOUT_MS;
    }
    transaction.update(userRef, bailoutUpdates);
    // Positions are wiped too; the ledger records the cash reset.
    recordLedger(transaction, {
      uid,
      type: 'bailout',
      amount: BAILOUT_CASH - (userData.cash || 0),
      cashAfter: BAILOUT_CASH,
      detail: { cashBefore: userData.cash || 0 },
    });

    return { success: true, hadCrew: !!currentCrew };
  });
});

/**
 * Toggle margin trading (enable/disable)
 */
export const toggleMargin = cf().https.onCall(async (data: { enable?: unknown }, context) => {
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

    const userData = userDoc.data() as MarginUser;
    checkBanned(userData);
    checkDiscordWall(userData);

    if (enable) {
      const isAdmin = uid === ADMIN_UID;
      if (!isAdmin) {
        if ((userData.cash || 0) < MARGIN_CASH_MINIMUM) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Need $${MARGIN_CASH_MINIMUM.toLocaleString()} minimum cash.`,
          );
        }
        // The same three requirements MarginModal displays. Mirrors
        // checkMarginEligibility in src/utils/calculations.ts. If either side
        // changes, change both or the app shows a checklist the server ignores.
        if ((userData.totalCheckins || 0) < MARGIN_MIN_CHECKINS) {
          throw new functions.https.HttpsError('failed-precondition', `Need ${MARGIN_MIN_CHECKINS} daily check-ins.`);
        }
        if ((userData.totalTrades || 0) < MARGIN_MIN_TRADES) {
          throw new functions.https.HttpsError('failed-precondition', `Need ${MARGIN_MIN_TRADES} total trades.`);
        }
        if ((userData.peakPortfolioValue || 0) < MARGIN_MIN_PEAK_PORTFOLIO) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Need a $${MARGIN_MIN_PEAK_PORTFOLIO.toLocaleString()} peak portfolio.`,
          );
        }
      }
      transaction.update(userRef, {
        marginEnabled: true,
        marginUsed: 0,
        marginEnabledAt: Date.now(),
      });
    } else {
      // Check no outstanding margin
      if ((userData.marginUsed || 0) >= 0.01) {
        throw new functions.https.HttpsError('failed-precondition', 'Repay all margin debt first.');
      }
      transaction.update(userRef, {
        marginEnabled: false,
        marginUsed: 0,
      });
    }

    return { success: true, marginEnabled: enable };
  });
});

/**
 * Charge daily margin interest
 */
export const chargeMarginInterest = cf().https.onCall(async (_data: unknown, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data() as MarginUser;
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
      lastMarginInterestCharge: now,
      ...seasonMarginUpdate(userData, marginUsed + interest, now),
    });

    return { success: true, charged: interest };
  });
});
