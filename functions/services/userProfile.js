'use strict';
// Everything a player changes about an existing account: username
// availability, display-name changes, the one-off username migration, and
// cosmetic purchases. Split out of users.js when it passed the 600-line limit.

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const { ADMIN_UID, NAME_CHANGE_COST, NAME_CHANGE_COOLDOWN_MS, COSMETIC_CATALOG } = require('../constants');
const { isBannedUsername, isTargetedHarassment, containsProfanity, validateUsernameFormat, touchLastActive, reportError } = require('../helpers');


/**
 * Migrates existing users to the usernames collection.
 * Admin-only function to be run once after deployment.
 *
 * @returns {Object} - { migrated: number, conflicts: Array, errors: Array }
 */
exports.migrateUsernames = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Only admin can run this.');
  }

  const dryRun = data && data.dryRun === true;
  const results = { scanned: 0, usersUpdated: 0, reservationsWritten: 0, conflicts: [], errors: [], dryRun };

  try {
    const usersSnapshot = await db.collection('users').get();
    results.scanned = usersSnapshot.size;

    // Group every account by the lowercase form of its display name.
    const groups = new Map(); // lower -> [{ uid, displayName, currentLower, createdAtMs, portfolioValue, isBot }]
    usersSnapshot.forEach((docSnap) => {
      const u = docSnap.data();
      if (!u.displayName || typeof u.displayName !== 'string') {
        results.errors.push({ uid: docSnap.id, error: 'No displayName' });
        return;
      }
      const lower = u.displayName.toLowerCase();

      // Normalize createdAt to millis so the oldest account wins the name.
      let createdAtMs = Infinity;
      const c = u.createdAt;
      if (c) {
        if (typeof c.toMillis === 'function') createdAtMs = c.toMillis();
        else if (typeof c === 'number') createdAtMs = c;
        else if (typeof c._seconds === 'number') createdAtMs = c._seconds * 1000;
      }

      if (!groups.has(lower)) groups.set(lower, []);
      groups.get(lower).push({
        uid: docSnap.id,
        displayName: u.displayName,
        currentLower: u.displayNameLower || null,
        createdAtMs,
        portfolioValue: u.portfolioValue || 0,
        isBot: !!u.isBot,
      });
    });

    // Build all writes, committing in chunks well under Firestore's 500/batch cap.
    let batch = db.batch();
    let ops = 0;
    const flush = async (force) => {
      if (ops === 0) return;
      if (force || ops >= 450) {
        if (!dryRun) await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };

    for (const [lower, entries] of groups) {
      // Rightful owner: prefer a real account over a bot, then the oldest, then uid.
      entries.sort((a, b) =>
        (a.isBot - b.isBot) || (a.createdAtMs - b.createdAtMs) || a.uid.localeCompare(b.uid)
      );
      const keeper = entries[0];

      // Reserve (or repoint) the name to the keeper. A clean set, not a merge, so a
      // reservation a newer duplicate grabbed gets handed back to the rightful owner.
      batch.set(db.collection('usernames').doc(lower), {
        uid: keeper.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        backfilled: true,
      });
      ops++; results.reservationsWritten++;
      await flush(false);

      // Make sure displayNameLower is set/correct on every account in the group, so the
      // signup fallback query can see them.
      for (const e of entries) {
        if (e.currentLower !== lower) {
          batch.update(db.collection('users').doc(e.uid), { displayNameLower: lower });
          ops++; results.usersUpdated++;
          await flush(false);
        }
      }

      // Two or more live accounts sharing one name is a collision to resolve by hand.
      if (entries.length > 1) {
        results.conflicts.push({
          username: lower,
          keep: { uid: keeper.uid, displayName: keeper.displayName, portfolioValue: keeper.portfolioValue },
          rename: entries.slice(1).map(e => ({
            uid: e.uid, displayName: e.displayName, portfolioValue: e.portfolioValue, isBot: e.isBot,
          })),
        });
      }
    }
    await flush(true);

    // Surface each collision in the existing Watchlist alerts feed for cleanup.
    if (!dryRun) {
      for (const conf of results.conflicts) {
        const renameList = conf.rename
          .map(r => `${r.displayName} (${r.uid}, $${Math.round(r.portfolioValue)})`)
          .join(', ');
        await db.collection('watchlist_alerts').add({
          type: 'duplicate_username',
          action: 'flagged',
          relatedUID: conf.keep.uid,
          details: `Duplicate name "${conf.username}": keep ${conf.keep.displayName} (${conf.keep.uid}, oldest). Rename: ${renameList}`,
          timestamp: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    return {
      ...results,
      message: dryRun
        ? `Dry run: scanned ${results.scanned}, found ${results.conflicts.length} collision(s). No writes.`
        : `Reserved ${results.reservationsWritten} name(s), fixed ${results.usersUpdated} user doc(s), flagged ${results.conflicts.length} collision(s).`,
    };
  } catch (error) {
    reportError(error, { where: 'migrateUsernames' });
    throw new functions.https.HttpsError('internal', 'Backfill failed: ' + error.message);
  }
});


/**
 * Check if a username is available (case-insensitive).
 * Public function for real-time availability checking.
 *
 * @param {string} displayName - The username to check
 * @returns {Object} - { available: boolean }
 */
exports.checkUsername = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  const displayName = data.displayName;

  if (!displayName || typeof displayName !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Display name is required.'
    );
  }

  const trimmed = displayName.trim();

  if (trimmed.length < 3 || trimmed.length > 20) {
    return { available: false, reason: 'Invalid length' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { available: false, reason: 'Invalid characters' };
  }

  const lower = trimmed.toLowerCase();

  // Check if username is banned
  if (isBannedUsername(lower)) {
    return { available: false, reason: 'Username not allowed' };
  }

  if (isTargetedHarassment(trimmed)) {
    return { available: false, reason: 'Username targets another player' };
  }

  const usernameDoc = await db.collection('usernames').doc(lower).get();

  // Username is taken if the document exists (even if marked as deleted)
  return {
    available: !usernameDoc.exists,
    reason: usernameDoc.exists ? 'Username taken' : null
  };
});


exports.changeDisplayName = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const newDisplayName = data.displayName;

  if (!newDisplayName || typeof newDisplayName !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Display name is required.');
  }

  const trimmed = newDisplayName.trim();

  validateUsernameFormat(trimmed);

  const newNameLower = trimmed.toLowerCase();

  if (isBannedUsername(newNameLower)) throw new functions.https.HttpsError('invalid-argument', 'This username is not allowed.');
  if (containsProfanity(trimmed)) throw new functions.https.HttpsError('invalid-argument', 'Username contains inappropriate language.');
  if (isTargetedHarassment(trimmed)) throw new functions.https.HttpsError('invalid-argument', 'Username targets another player. Please choose a different name.');

  const userRef = db.collection('users').doc(uid);
  const newUsernameRef = db.collection('usernames').doc(newNameLower);

  // Fallback for legacy accounts with no reservation doc: scan users by lowercase
  // name. Best-effort pre-check; the reservation doc read inside the transaction
  // is the authoritative uniqueness guard.
  const dupSnap = await db.collection('users').where('displayNameLower', '==', newNameLower).limit(1).get();
  if (!dupSnap.empty && dupSnap.docs[0].id !== uid) throw new functions.https.HttpsError('already-exists', 'That username is already taken.');

  // Single transaction so the $10k cost, the cooldown, and the username
  // reservation all commit together — two concurrent changes can't double-spend.
  return db.runTransaction(async (transaction) => {
    const [userDoc, existingDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(newUsernameRef),
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    if (userData.isBot || userData.isBanned) throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');

    // Cooldown: 14 days between changes
    if (userData.nameChangedAt) {
      const msSinceChange = Date.now() - userData.nameChangedAt.toMillis();
      if (msSinceChange < NAME_CHANGE_COOLDOWN_MS) {
        const daysLeft = Math.ceil((NAME_CHANGE_COOLDOWN_MS - msSinceChange) / (24 * 60 * 60 * 1000));
        throw new functions.https.HttpsError('failed-precondition', `You can change your name again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`);
      }
    }

    const oldDisplayName = userData.displayName;
    const oldNameLower = userData.displayNameLower;

    if (newNameLower === oldNameLower) throw new functions.https.HttpsError('invalid-argument', 'That is already your current name.');

    if ((userData.cash || 0) < NAME_CHANGE_COST) {
      throw new functions.https.HttpsError('failed-precondition', `Name change costs $${NAME_CHANGE_COST.toLocaleString()}. You don't have enough cash.`);
    }

    if (existingDoc.exists) throw new functions.https.HttpsError('already-exists', 'That username is already taken.');

    if (oldNameLower) transaction.delete(db.collection('usernames').doc(oldNameLower));
    transaction.set(newUsernameRef, { uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    transaction.update(userRef, {
      displayName: trimmed,
      displayNameLower: newNameLower,
      previousDisplayName: oldDisplayName,
      nameChangedAt: admin.firestore.FieldValue.serverTimestamp(),
      cash: admin.firestore.FieldValue.increment(-NAME_CHANGE_COST),
    });

    return { success: true };
  });
});


exports.purchaseCosmetic = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

  const { cosmeticId } = data || {};
  const cosmetic = COSMETIC_CATALOG[cosmeticId];
  if (!cosmetic) throw new functions.https.HttpsError('invalid-argument', 'Invalid cosmetic.');

  const uid = context.auth.uid;
  touchLastActive(uid, 'cosmetics');
  const userRef = db.collection('users').doc(uid);

  // Transaction so two concurrent purchases can't both pass the cash check and
  // overspend the same balance into the negative.
  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    if (userData.isBot || userData.isBanned) throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');
    if ((userData.ownedCosmetics || []).includes(cosmeticId)) throw new functions.https.HttpsError('already-exists', 'You already own this cosmetic.');
    if ((userData.cash || 0) < cosmetic.price) throw new functions.https.HttpsError('failed-precondition', 'Not enough cash.');

    transaction.update(userRef, {
      ownedCosmetics: admin.firestore.FieldValue.arrayUnion(cosmeticId),
      cash: admin.firestore.FieldValue.increment(-cosmetic.price),
    });

    return { success: true };
  });
});
