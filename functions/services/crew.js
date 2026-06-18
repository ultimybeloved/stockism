'use strict';
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CREW_MEMBERS, CREW_SWITCH_PENALTY, TWENTY_FOUR_HOURS_MS } = require('../constants');
const { checkBanned, checkDiscordWall } = require('../helpers');
const { updateCrewMissionNewMember } = require('./crewMissions');


/**
 * Switch Crew - Callable function
 * Handles crew joining/switching with 15% penalty for switches
 */
exports.switchCrew = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { crewId, isSwitch } = data;

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

      // Check exile history
      const crewHistory = userData.crewHistory || [];
      if (crewHistory.includes(crewId)) {
        throw new functions.https.HttpsError('failed-precondition', 'You have been permanently exiled from this crew.');
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
        crewHistory: admin.firestore.FieldValue.arrayUnion(crewId)
      };

      let totalTaken = 0;

      // Apply 15% penalty if switching crews (only read market prices when needed)
      if (isSwitch && userData.crew) {
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
            const sharesToTake = Math.floor(shares * penaltyRate);
            const sharesToKeep = shares - sharesToTake;
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

      return { success: true, totalTaken, isSwitch: !!(isSwitch && userData.crew) };
    });

    // Fire-and-forget: count new crew member for crew missions (outside transaction to avoid retry double-counts)
    updateCrewMissionNewMember(crewId);

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

