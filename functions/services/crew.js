'use strict';
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CREW_MEMBERS, CREW_SWITCH_PENALTY, CREW_REJOIN_LOCKOUT_MS, TWENTY_FOUR_HOURS_MS } = require('../constants');
const { checkBanned, checkDiscordWall, touchLastActive } = require('../helpers');


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
  touchLastActive(uid);
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

      // 30-day rejoin lockout, set when leaving a crew. Replaced the old
      // permanent exile (crewHistory), which trapped players in dead crews.
      const lockedUntil = (userData.crewLockouts || {})[crewId] || 0;
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
        updateData.lastCrewChange = now;
      }

      transaction.update(userRef, updateData);

      return { success: true, totalTaken, isSwitch };
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
    console.error('switchCrew error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to join crew. Please try again.'
    );
  }
});

