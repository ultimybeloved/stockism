'use strict';
// Direct edits to a single player's game state, for the fixes that otherwise
// mean opening the Firebase console. Split out of adminOps.js, which was near
// its line limit.
//
// These deliberately skip the rules the player-facing paths enforce (crew switch
// penalty, rejoin lockout, margin eligibility) — an admin correcting a mistake
// shouldn't be charged for it. They still keep the derived state consistent, so
// nothing here can leave an account in a shape the game can't read.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();
const { ADMIN_UID, CREW_MEMBERS } = require('../constants');
const { CHARACTERS } = require('../characters');

const requireAdmin = (context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
};

const getUserRef = async (userId) => {
  if (!userId || typeof userId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }
  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  return { ref, data: snap.data() };
};

/**
 * Move a player to another crew, or clear their crew entirely.
 *
 * Unlike switchCrew this charges no CREW_SWITCH_PENALTY, sets no 30-day rejoin
 * lockout and ignores the 24h cooldown. It still strips the crown, because that
 * is earned per crew by the weekly rotation and must never travel with a player.
 * market/crewStats is rebuilt weekly from user docs, so it needs no touch-up.
 */
exports.adminSetCrew = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { userId, crewId } = data || {};
  const clearing = !crewId;
  if (!clearing && !CREW_MEMBERS[crewId]) {
    throw new functions.https.HttpsError('invalid-argument', `Unknown crew: ${crewId}`);
  }

  const { ref, data: userData } = await getUserRef(userId);
  const previousCrew = userData.crew || null;
  if (previousCrew === (clearing ? null : crewId)) {
    return { success: true, unchanged: true, crew: previousCrew };
  }

  const update = {
    isCrewHead: false,
    crewHeadStreak: 0,
  };
  if (clearing) {
    update.crew = FieldValue.delete();
    update.crewJoinedAt = FieldValue.delete();
  } else {
    update.crew = crewId;
    update.crewJoinedAt = Date.now();
    update.crewHistory = FieldValue.arrayUnion(crewId);
  }

  await ref.update(update);
  return { success: true, unchanged: false, previousCrew, crew: clearing ? null : crewId };
});

/**
 * Award an achievement, mirroring removeAchievement in adminOps.js.
 *
 * The achievement catalogue lives in src/constants/achievements.js and is not
 * duplicated backend-side, so the ID is validated by shape only — the admin
 * picks from the real list in the panel.
 */
exports.adminGrantAchievement = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { userId, achievementId } = data || {};
  if (!achievementId || typeof achievementId !== 'string' || !/^[A-Z0-9_]{2,50}$/.test(achievementId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid achievementId required');
  }

  const { ref, data: userData } = await getUserRef(userId);
  if ((userData.achievements || []).includes(achievementId)) {
    return { success: true, alreadyEarned: true, achievementId };
  }

  await ref.update({
    achievements: FieldValue.arrayUnion(achievementId),
    [`achievementDates.${achievementId}`]: Date.now()
  });

  return { success: true, alreadyEarned: false, achievementId };
});

/**
 * Turn margin on or off for an account and optionally wipe what it owes.
 *
 * Disabling with an outstanding balance is what the player-facing toggle
 * refuses to do, which is exactly why an admin needs it: an account stuck with
 * unpayable margin debt can't be fixed from the game side. Clearing the debt
 * forgives it outright — no cash moves.
 */
exports.adminSetMargin = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { userId, enabled, clearDebt } = data || {};
  if (typeof enabled !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'enabled (boolean) required');
  }

  const { ref, data: userData } = await getUserRef(userId);
  const previousMarginUsed = userData.marginUsed || 0;

  const update = { marginEnabled: enabled };
  if (enabled) {
    update.marginEnabledAt = userData.marginEnabledAt || Date.now();
  }
  if (clearDebt) {
    update.marginUsed = 0;
    update.activeLoan = FieldValue.delete();
  }

  await ref.update(update);
  return {
    success: true,
    marginEnabled: enabled,
    clearedDebt: !!clearDebt,
    previousMarginUsed
  };
});

/**
 * Set or clear a player's share count in one ticker, with its cost basis.
 *
 * Zero shares removes the position and its cost basis rather than storing a
 * dead 0, which is how the sell path leaves holdings. portfolioValue is NOT
 * recomputed here — that math lives in syncPortfolio and duplicating it is how
 * the codebase ended up with four copies of every price calculation. Hit Sync
 * on the user card afterwards; the panel prompts for it.
 */
exports.adminSetHolding = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { userId, ticker, shares, costBasis } = data || {};
  if (!ticker || typeof ticker !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'ticker required');
  }
  if (!CHARACTERS.some(c => c.ticker === ticker)) {
    throw new functions.https.HttpsError('invalid-argument', `Unknown ticker: ${ticker}`);
  }
  if (typeof shares !== 'number' || !isFinite(shares) || shares < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'shares must be a number >= 0');
  }
  if (costBasis !== undefined && costBasis !== null &&
      (typeof costBasis !== 'number' || !isFinite(costBasis) || costBasis < 0)) {
    throw new functions.https.HttpsError('invalid-argument', 'costBasis must be a number >= 0');
  }

  const { ref, data: userData } = await getUserRef(userId);
  const previousShares = (userData.holdings || {})[ticker] || 0;

  // Matches the sell path: fractional shares are kept to 4 decimals.
  const rounded = Math.round(shares * 10000) / 10000;
  const update = {};
  if (rounded <= 0) {
    update[`holdings.${ticker}`] = FieldValue.delete();
    update[`costBasis.${ticker}`] = FieldValue.delete();
  } else {
    update[`holdings.${ticker}`] = rounded;
    if (costBasis !== undefined && costBasis !== null) {
      update[`costBasis.${ticker}`] = Math.round(costBasis * 100) / 100;
    }
  }

  await ref.update(update);
  return { success: true, ticker, previousShares, shares: rounded, cleared: rounded <= 0 };
});
