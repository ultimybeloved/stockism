'use strict';
// Small, direct admin operations: grant/revoke, set cash, broadcast, toggles.
//
// The heavy data-repair jobs that used to live here are in adminRepair.js, and
// the ticker/roster migrations are in adminMigrate.js. Anything here should be a
// short, single-purpose action an admin triggers from the panel.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
// Modular import — the emulator sandbox strips admin.firestore statics.
const { Timestamp } = require('firebase-admin/firestore');
const db = admin.firestore();
const {
  ADMIN_UID,
  REINSTATE_CASH_DEFAULT,
  COSMETIC_CATALOG,
} = require('../constants');

exports.removeAchievement = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, achievementId } = data;
  if (!userId || !achievementId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId and achievementId required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  await userRef.update({
    achievements: admin.firestore.FieldValue.arrayRemove(achievementId),
    displayedAchievementPins: admin.firestore.FieldValue.arrayRemove(achievementId),
    [`achievementDates.${achievementId}`]: admin.firestore.FieldValue.delete()
  });

  return { success: true, removed: achievementId, userId };
});

/**
 * Admin reinstate a bankrupt user - gives them $1000 cash without wiping crew/holdings
 */
exports.reinstateUser = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const userData = userSnap.data();
  const cashBoost = Math.max(0, REINSTATE_CASH_DEFAULT - (userData.cash || 0));

  await userRef.update({
    isBankrupt: false,
    cash: admin.firestore.FieldValue.increment(cashBoost),
    reinstatedAt: Date.now(),
    reinstatedBy: 'admin'
  });

  return { success: true, userId, cashAdded: cashBoost };
});

exports.adminSetCash = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, cash } = data;
  if (!userId || typeof cash !== 'number' || isNaN(cash) || cash < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and cash (>= 0) required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const prevCash = userSnap.data().cash;
  await userRef.update({ cash: Math.round(cash * 100) / 100 });

  return { success: true, userId, previousCash: prevCash, newCash: cash };
});

/**
 * Admin grant/revoke a cosmetic on a user (for giveaways). No cash is charged.
 * Revoking also unequips the cosmetic if it's the active one for its slot, so
 * the user isn't left displaying something they no longer own.
 */
exports.adminGrantCosmetic = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, cosmeticId, revoke } = data || {};
  const cosmetic = COSMETIC_CATALOG[cosmeticId];
  if (!userId || !cosmetic) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and cosmeticId required');
  }

  const userRef = db.collection('users').doc(userId);
  return db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const owned = userSnap.data().ownedCosmetics || [];

    if (revoke) {
      if (!owned.includes(cosmeticId)) {
        throw new functions.https.HttpsError('failed-precondition', 'User does not own this cosmetic');
      }
      const updates = { ownedCosmetics: admin.firestore.FieldValue.arrayRemove(cosmeticId) };
      const active = userSnap.data().activeCosmetics || {};
      if (active[cosmetic.type] === cosmeticId) {
        updates[`activeCosmetics.${cosmetic.type}`] = admin.firestore.FieldValue.delete();
      }
      transaction.update(userRef, updates);
      return { success: true, userId, cosmeticId, revoked: true };
    }

    if (owned.includes(cosmeticId)) {
      throw new functions.https.HttpsError('already-exists', 'User already owns this cosmetic');
    }
    transaction.update(userRef, { ownedCosmetics: admin.firestore.FieldValue.arrayUnion(cosmeticId) });
    return { success: true, userId, cosmeticId, granted: true };
  });
});

/**
 * Admin-only: broadcast a notification to every (non-bot) user's bell. Used to
 * announce game changes so players aren't confused. Batched so a few thousand
 * users is one quick run.
 */
exports.broadcastNotification = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const title = (data.title || '').toString().trim();
  const message = (data.message || '').toString().trim();
  if (!title || !message) {
    throw new functions.https.HttpsError('invalid-argument', 'Title and message are required.');
  }
  if (title.length > 100 || message.length > 1000) {
    throw new functions.https.HttpsError('invalid-argument', 'Title must be ≤ 100 chars and message ≤ 1000 chars.');
  }
  // Optional: tag the notification with a prediction so tapping it routes to
  // the Predictions page (used for new-prediction announcements).
  const predictionId = (data.predictionId || '').toString().trim().slice(0, 100);
  const notifData = predictionId ? { predictionId } : {};

  const usersSnap = await db.collection('users').get();
  const createdAt = Timestamp.now();
  let sent = 0;
  let batch = db.batch();
  let pending = 0;
  for (const doc of usersSnap.docs) {
    if (doc.data().isBot) continue;
    const ref = db.collection('users').doc(doc.id).collection('notifications').doc();
    batch.set(ref, { type: 'announcement', title, message, read: false, createdAt, data: notifData });
    sent++;
    pending++;
    if (pending >= 400) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }
  if (pending > 0) await batch.commit();

  return { success: true, sent };
});

/**
 * Admin-only: flag or clear the Discord-link wall on a user. When set, the user
 * must link a Discord account before they can trade/bet/play (unless already linked).
 */
exports.adminSetDiscordWall = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, value } = data;
  if (!userId || typeof value !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'userId and boolean value required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  await userRef.update({ requiresDiscordLink: value });

  return { success: true, userId, requiresDiscordLink: value, alreadyLinked: !!userSnap.data().discordId };
});
