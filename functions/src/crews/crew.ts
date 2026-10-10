import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
const db = admin.firestore();
import {
  CREW_MEMBERS,
  CREW_SWITCH_PENALTY,
  CREW_REJOIN_LOCKOUT_MS,
  TWENTY_FOUR_HOURS_MS,
  isFreeSwitchTarget,
} from '../shared/constants';
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { touchLastActive } from '../shared/activity';
import { reportError } from '../shared/sentry';
import type { UserData } from '../shared/types';
import { recordLedger } from '../shared/ledger';

/**
 * The crew-change penalty: CREW_SWITCH_PENALTY of cash (floored to whole
 * dollars) and of every holding. Shares are taken fractionally, rounded to 2 dp,
 * because a whole-share floor would let small positions dodge the penalty.
 */
const crewPenalty = (userData: UserData, prices: Record<string, number>) => {
  const penaltyRate = CREW_SWITCH_PENALTY;
  const newCash = Math.floor((userData.cash || 0) * (1 - penaltyRate));
  const cashTaken = (userData.cash || 0) - newCash;
  const newHoldings: Record<string, number> = {};
  let holdingsValueTaken = 0;
  Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const sharesToTake = Math.min(shares, Math.round(shares * penaltyRate * 100) / 100);
      const sharesToKeep = Math.round((shares - sharesToTake) * 10000) / 10000;
      newHoldings[ticker] = sharesToKeep;
      holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
    }
  });
  return { newCash, newHoldings, totalTaken: cashTaken + holdingsValueTaken };
};

/**
 * Switch Crew - Callable function
 * Handles crew joining/switching with a portfolio penalty for switches
 * (CREW_SWITCH_PENALTY, currently 5%)
 */
export const switchCrew = cf().https.onCall(async (data: { crewId?: unknown }, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'crew');
  const { crewId } = data;

  if (!crewId || typeof crewId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid crew ID.');
  }

  if (!CREW_MEMBERS[crewId]) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid crew.');
  }

  const userRef = db.collection('users').doc(uid);

  try {
    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

      const userData = userDoc.data() as UserData & {
        crewLockouts?: Record<string, number>;
        lastCrewChange?: number;
      };
      checkBanned(userData);
      checkDiscordWall(userData);

      // Block if in debt
      if ((userData.cash || 0) < 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Cannot join a crew while in debt.');
      }

      // Switching to the crew you are already in is a no-op that still burned
      // the penalty and stamped a lockout on your own crew. Harmless while it
      // cost 5%, a real footgun once a switch can be free.
      if (userData.crew === crewId) {
        throw new functions.https.HttpsError('failed-precondition', 'You are already in this crew.');
      }

      // Free-switch event. Derived from the destination crew server-side; the
      // client cannot claim it.
      const freeSwitch = isFreeSwitchTarget(crewId);

      // 30-day rejoin lockout, set when leaving a crew. Replaced the old
      // permanent exile (crewHistory), which trapped players in dead crews.
      // The event crew is open to everyone while the window is running.
      const lockedUntil = freeSwitch ? 0 : (userData.crewLockouts || {})[crewId] || 0;
      if (lockedUntil > Date.now()) {
        const daysLeft = Math.ceil((lockedUntil - Date.now()) / TWENTY_FOUR_HOURS_MS);
        throw new functions.https.HttpsError(
          'failed-precondition',
          `You recently left this crew. You can rejoin in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        );
      }

      // Check 24-hour cooldown
      const lastChange = userData.lastCrewChange || 0;
      const hoursSinceChange = (Date.now() - lastChange) / (1000 * 60 * 60);
      if (hoursSinceChange < 24) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Crew change cooldown. Try again in ${Math.ceil(24 - hoursSinceChange)}h.`,
        );
      }

      const now = Date.now();
      const updateData: Record<string, unknown> = {
        crew: crewId,
        crewJoinedAt: now,
        crewHistory: FieldValue.arrayUnion(crewId),
        // The crown never travels: it's earned per crew by the weekly
        // rotation, so any crew change strips it immediately.
        isCrewHead: false,
        crewHeadStreak: 0,
      };

      let totalTaken = 0;

      // Apply the switch penalty if switching crews. Derived server-side — the client
      // must not be able to skip the penalty by claiming this isn't a switch.
      const isSwitch = !!userData.crew;
      if (isSwitch) {
        // The 24h cooldown applies to every switch, free or not.
        updateData.lastCrewChange = now;
      }

      // A free switch takes nothing and leaves no lockout behind, so the player
      // can go straight back to their old crew afterwards (paying the normal
      // penalty to leave).
      if (isSwitch && !freeSwitch) {
        // Lock the crew being left for 30 days.
        updateData[`crewLockouts.${userData.crew}`] = now + CREW_REJOIN_LOCKOUT_MS;
        const marketRef = db.collection('market').doc('current');
        const marketDoc = await transaction.get(marketRef);
        const prices = marketDoc.exists ? marketDoc.data()!.prices || {} : {};
        const penalty = crewPenalty(userData, prices);
        const { newCash, newHoldings } = penalty;
        totalTaken = penalty.totalTaken;
        const newPortfolioValue = Math.max(0, (userData.portfolioValue || 0) - totalTaken);

        updateData.cash = newCash;
        updateData.holdings = newHoldings;
        updateData.portfolioValue = newPortfolioValue;
        // Shares taken are noted in detail; the ledger tracks the cash part.
        recordLedger(transaction, {
          uid,
          type: 'crew_switch_penalty',
          amount: newCash - (userData.cash || 0),
          cashAfter: newCash,
          detail: { totalTaken },
        });
      }

      transaction.update(userRef, updateData);

      return { success: true, totalTaken, isSwitch, freeSwitch: isSwitch && freeSwitch };
    });

    return result;
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    const err = error as { code?: unknown; message?: string };
    if (err.code === 10 || err.message?.includes('contention') || err.message?.includes('ABORTED')) {
      throw new functions.https.HttpsError('aborted', 'Crew change was busy. Please try again.');
    }
    reportError(error, { where: 'switchCrew', uid });
    throw new functions.https.HttpsError('internal', 'Failed to join crew. Please try again.');
  }
});

/**
 * Leave crew with the portfolio penalty (CREW_SWITCH_PENALTY, currently 5%)
 */
export const leaveCrew = cf().https.onCall(async (_data: unknown, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'crew');
  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc] = await Promise.all([transaction.get(userRef), transaction.get(marketRef)]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data() as UserData;
    checkBanned(userData);
    checkDiscordWall(userData);
    if (!userData.crew) {
      throw new functions.https.HttpsError('failed-precondition', 'Not in a crew.');
    }
    if ((userData.cash || 0) < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot leave crew while in debt.');
    }

    const prices = marketDoc.exists ? marketDoc.data()!.prices || {} : {};
    const { newCash, newHoldings, totalTaken } = crewPenalty(userData, prices);
    const newPortfolioValue = (userData.portfolioValue || 0) - totalTaken;

    transaction.update(userRef, {
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      cash: newCash,
      holdings: newHoldings,
      portfolioValue: Math.max(0, newPortfolioValue),
      lastCrewChange: Date.now(),
      // Lock the crew being left for 30 days.
      [`crewLockouts.${userData.crew}`]: Date.now() + CREW_REJOIN_LOCKOUT_MS,
    });
    recordLedger(transaction, {
      uid,
      type: 'crew_leave_penalty',
      amount: newCash - (userData.cash || 0),
      cashAfter: newCash,
      ref: userData.crew,
      detail: { totalTaken },
    });

    return { success: true, totalTaken, crewLeft: userData.crew };
  });
});
