'use strict';
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CREW_MEMBERS, CREW_SWITCH_PENALTY, CREW_REJOIN_LOCKOUT_MS, TWENTY_FOUR_HOURS_MS, isFreeSwitchTarget } = require('../constants');
const { checkBanned, checkDiscordWall, touchLastActive, reportError } = require('../helpers');


/**
 * Switch Crew - Callable function
 * Handles crew joining/switching with a portfolio penalty for switches
 * (CREW_SWITCH_PENALTY, currently 5%)
 */
exports.switchCrew = cf().https.onCall(async (data, context) => {
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

      const userData = userDoc.data();
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
      const lockedUntil = freeSwitch ? 0 : ((userData.crewLockouts || {})[crewId] || 0);
      if (lockedUntil > Date.now()) {
        const daysLeft = Math.ceil((lockedUntil - Date.now()) / TWENTY_FOUR_HOURS_MS);
        throw new functions.https.HttpsError('failed-precondition', `You recently left this crew. You can rejoin in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`);
      }

      // Check 24-hour cooldown
      const lastChange = userData.lastCrewChange || 0;
      const hoursSinceChange = (Date.now() - lastChange) / (1000 * 60 * 60);
      if (hoursSinceChange < 24) {
        throw new functions.https.HttpsError('failed-precondition', `Crew change cooldown. Try again in ${Math.ceil(24 - hoursSinceChange)}h.`);
      }

      const now = Date.now();
      const updateData = {
        crew: crewId,
        crewJoinedAt: now,
        crewHistory: admin.firestore.FieldValue.arrayUnion(crewId),
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
        const prices = marketDoc.exists ? (marketDoc.data().prices || {}) : {};
        const penaltyRate = CREW_SWITCH_PENALTY;

        const newCash = Math.floor((userData.cash || 0) * (1 - penaltyRate));
        const cashTaken = (userData.cash || 0) - newCash;

        const newHoldings = {};
        let holdingsValueTaken = 0;

        Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
          if (shares > 0) {
            // Fractional take, rounded to 2 dp — a whole-share floor would let
            // small positions dodge the penalty entirely.
            const sharesToTake = Math.min(shares, Math.round(shares * penaltyRate * 100) / 100);
            const sharesToKeep = Math.round((shares - sharesToTake) * 10000) / 10000;
            newHoldings[ticker] = sharesToKeep;
            holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
          }
        });

        totalTaken = cashTaken + holdingsValueTaken;
        const newPortfolioValue = Math.max(0, (userData.portfolioValue || 0) - totalTaken);

        updateData.cash = newCash;
        updateData.holdings = newHoldings;
        updateData.portfolioValue = newPortfolioValue;
      }

      transaction.update(userRef, updateData);

      return { success: true, totalTaken, isSwitch, freeSwitch: isSwitch && freeSwitch };
    });

    return result;

  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    if (error.code === 10 || error.message?.includes('contention') || error.message?.includes('ABORTED')) {
      throw new functions.https.HttpsError(
        'aborted',
        'Crew change was busy. Please try again.'
      );
    }
    reportError(error, { where: 'switchCrew', uid });
    throw new functions.https.HttpsError(
      'internal',
      'Failed to join crew. Please try again.'
    );
  }
});


/**
 * Leave crew with the portfolio penalty (CREW_SWITCH_PENALTY, currently 5%)
 */
exports.leaveCrew = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'crew');
  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(marketRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    if (!userData.crew) {
      throw new functions.https.HttpsError('failed-precondition', 'Not in a crew.');
    }
    if ((userData.cash || 0) < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot leave crew while in debt.');
    }

    const prices = marketDoc.exists ? (marketDoc.data().prices || {}) : {};
    const penaltyRate = CREW_SWITCH_PENALTY;

    // Cash penalty
    const newCash = Math.floor((userData.cash || 0) * (1 - penaltyRate));

    // Holdings penalty. Fractional take, rounded to 2 dp — a whole-share
    // floor would let small positions dodge the penalty entirely.
    const newHoldings = {};
    let holdingsValueTaken = 0;
    Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
      if (shares > 0) {
        const sharesToTake = Math.min(shares, Math.round(shares * penaltyRate * 100) / 100);
        const sharesToKeep = Math.round((shares - sharesToTake) * 10000) / 10000;
        newHoldings[ticker] = sharesToKeep;
        holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
      }
    });

    const totalTaken = ((userData.cash || 0) - newCash) + holdingsValueTaken;
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
      [`crewLockouts.${userData.crew}`]: Date.now() + CREW_REJOIN_LOCKOUT_MS
    });

    return { success: true, totalTaken, crewLeft: userData.crew };
  });
});
