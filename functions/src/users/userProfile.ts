// Everything a player changes about an existing account: username
// availability, display-name changes, the one-off username migration, and
// cosmetic purchases. Split out of users.js when it passed the 600-line limit.

import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
const db = admin.firestore();

import { NAME_CHANGE_COST, NAME_CHANGE_COOLDOWN_MS, COSMETIC_CATALOG, TWENTY_FOUR_HOURS_MS } from '../shared/constants';
import { isBannedUsername, isTargetedHarassment, containsProfanity, validateUsernameFormat } from '../shared/usernames';
import { touchLastActive } from '../shared/activity';
import { reportError } from '../shared/sentry';
import type { UserData } from '../shared/types';

/** One account in a name group, for the username backfill. */
interface NameEntry {
  uid: string;
  displayName: string;
  currentLower: string | null;
  createdAtMs: number;
  portfolioValue: number;
  isBot: boolean;
}

/** Profile fields the name and cosmetics callables read. */
type ProfileUser = UserData & {
  displayNameLower?: string;
  nameChangedAt?: admin.firestore.Timestamp;
  ownedCosmetics?: string[];
};

/**
 * Migrates existing users to the usernames collection.
 * Admin-only function to be run once after deployment.
 *
 * @returns {Object} - { migrated: number, conflicts: Array, errors: Array }
 */
export const migrateUsernames = cf().https.onCall(async (data: { dryRun?: unknown } | null, context) => {
  requireAdmin(context, 'Only admin can run this.');

  const dryRun = data && data.dryRun === true;
  const results = {
    scanned: 0,
    usersUpdated: 0,
    reservationsWritten: 0,
    conflicts: [] as {
      username: string;
      keep: { uid: string; displayName: string; portfolioValue: number };
      rename: { uid: string; displayName: string; portfolioValue: number; isBot: boolean }[];
    }[],
    errors: [] as { uid: string; error: string }[],
    dryRun,
  };

  try {
    const usersSnapshot = await db.collection('users').get();
    results.scanned = usersSnapshot.size;

    // Group every account by the lowercase form of its display name.
    const groups = new Map<string, NameEntry[]>(); // lower -> [{ uid, displayName, currentLower, createdAtMs, portfolioValue, isBot }]
    usersSnapshot.forEach((docSnap) => {
      const u = docSnap.data() as ProfileUser;
      if (!u.displayName || typeof u.displayName !== 'string') {
        results.errors.push({ uid: docSnap.id, error: 'No displayName' });
        return;
      }
      const lower = u.displayName.toLowerCase();

      // Normalize createdAt to millis so the oldest account wins the name.
      let createdAtMs = Infinity;
      const c = u.createdAt as { toMillis?: () => number; _seconds?: number } | number | undefined;
      if (c) {
        if (typeof c !== 'number' && typeof c.toMillis === 'function') createdAtMs = c.toMillis();
        else if (typeof c === 'number') createdAtMs = c;
        else if (typeof c._seconds === 'number') createdAtMs = c._seconds * 1000;
      }

      if (!groups.has(lower)) groups.set(lower, []);
      groups.get(lower)!.push({
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
    const flush = async (force: boolean) => {
      if (ops === 0) return;
      if (force || ops >= 450) {
        if (!dryRun) await batch.commit();
        batch = db.batch();
        ops = 0;
      }
    };

    for (const [lower, entries] of groups) {
      // Rightful owner: prefer a real account over a bot, then the oldest, then uid.
      entries.sort(
        (a, b) => Number(a.isBot) - Number(b.isBot) || a.createdAtMs - b.createdAtMs || a.uid.localeCompare(b.uid),
      );
      const keeper = entries[0]!;

      // Reserve (or repoint) the name to the keeper. A clean set, not a merge, so a
      // reservation a newer duplicate grabbed gets handed back to the rightful owner.
      batch.set(db.collection('usernames').doc(lower), {
        uid: keeper.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        backfilled: true,
      });
      ops++;
      results.reservationsWritten++;
      await flush(false);

      // Make sure displayNameLower is set/correct on every account in the group, so the
      // signup fallback query can see them.
      for (const e of entries) {
        if (e.currentLower !== lower) {
          batch.update(db.collection('users').doc(e.uid), { displayNameLower: lower });
          ops++;
          results.usersUpdated++;
          await flush(false);
        }
      }

      // Two or more live accounts sharing one name is a collision to resolve by hand.
      if (entries.length > 1) {
        results.conflicts.push({
          username: lower,
          keep: { uid: keeper.uid, displayName: keeper.displayName, portfolioValue: keeper.portfolioValue },
          rename: entries.slice(1).map((e) => ({
            uid: e.uid,
            displayName: e.displayName,
            portfolioValue: e.portfolioValue,
            isBot: e.isBot,
          })),
        });
      }
    }
    await flush(true);

    // Surface each collision in the existing Watchlist alerts feed for cleanup.
    if (!dryRun) {
      for (const conf of results.conflicts) {
        const renameList = conf.rename
          .map((r) => `${r.displayName} (${r.uid}, $${Math.round(r.portfolioValue)})`)
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
    throw new functions.https.HttpsError('internal', 'Backfill failed: ' + (error as Error).message);
  }
});

/**
 * Check if a username is available (case-insensitive).
 * Public function for real-time availability checking.
 *
 * @param {string} displayName - The username to check
 * @returns {Object} - { available: boolean }
 */
export const checkUsername = cf().https.onCall(async (data: { displayName?: unknown }, context) => {
  requireAppCheck(context);
  const displayName = data.displayName;

  if (!displayName || typeof displayName !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Display name is required.');
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
    reason: usernameDoc.exists ? 'Username taken' : null,
  };
});

export const changeDisplayName = cf().https.onCall(async (data: { displayName?: unknown }, context) => {
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

  if (isBannedUsername(newNameLower))
    throw new functions.https.HttpsError('invalid-argument', 'This username is not allowed.');
  if (containsProfanity(trimmed))
    throw new functions.https.HttpsError('invalid-argument', 'Username contains inappropriate language.');
  if (isTargetedHarassment(trimmed))
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username targets another player. Please choose a different name.',
    );

  const userRef = db.collection('users').doc(uid);
  const newUsernameRef = db.collection('usernames').doc(newNameLower);

  // Fallback for legacy accounts with no reservation doc: scan users by lowercase
  // name. Best-effort pre-check; the reservation doc read inside the transaction
  // is the authoritative uniqueness guard.
  const dupSnap = await db.collection('users').where('displayNameLower', '==', newNameLower).limit(1).get();
  if (!dupSnap.empty && dupSnap.docs[0]!.id !== uid)
    throw new functions.https.HttpsError('already-exists', 'That username is already taken.');

  // Single transaction so the $10k cost, the cooldown, and the username
  // reservation all commit together — two concurrent changes can't double-spend.
  return db.runTransaction(async (transaction) => {
    const [userDoc, existingDoc] = await Promise.all([transaction.get(userRef), transaction.get(newUsernameRef)]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data() as ProfileUser;
    if (userData.isBot || userData.isBanned)
      throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');

    // Cooldown: 14 days between changes
    if (userData.nameChangedAt) {
      const msSinceChange = Date.now() - userData.nameChangedAt.toMillis();
      if (msSinceChange < NAME_CHANGE_COOLDOWN_MS) {
        const daysLeft = Math.ceil((NAME_CHANGE_COOLDOWN_MS - msSinceChange) / TWENTY_FOUR_HOURS_MS);
        throw new functions.https.HttpsError(
          'failed-precondition',
          `You can change your name again in ${daysLeft} day${daysLeft === 1 ? '' : 's'}.`,
        );
      }
    }

    const oldDisplayName = userData.displayName;
    const oldNameLower = userData.displayNameLower;

    if (newNameLower === oldNameLower)
      throw new functions.https.HttpsError('invalid-argument', 'That is already your current name.');

    if ((userData.cash || 0) < NAME_CHANGE_COST) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Name change costs $${NAME_CHANGE_COST.toLocaleString()}. You don't have enough cash.`,
      );
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

export const purchaseCosmetic = cf().https.onCall(async (data: { cosmeticId?: string } | null, context) => {
  requireAppCheck(context);
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');

  const { cosmeticId } = data || {};
  const cosmetic = (COSMETIC_CATALOG as Record<string, { type: string; price: number }>)[cosmeticId as string];
  if (!cosmetic) throw new functions.https.HttpsError('invalid-argument', 'Invalid cosmetic.');

  const uid = context.auth.uid;
  touchLastActive(uid, 'cosmetics');
  const userRef = db.collection('users').doc(uid);

  // Transaction so two concurrent purchases can't both pass the cash check and
  // overspend the same balance into the negative.
  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data() as ProfileUser;
    if (userData.isBot || userData.isBanned)
      throw new functions.https.HttpsError('permission-denied', 'Action not allowed.');
    if ((userData.ownedCosmetics || []).includes(cosmeticId as string))
      throw new functions.https.HttpsError('already-exists', 'You already own this cosmetic.');
    if ((userData.cash || 0) < cosmetic.price)
      throw new functions.https.HttpsError('failed-precondition', 'Not enough cash.');

    transaction.update(userRef, {
      ownedCosmetics: admin.firestore.FieldValue.arrayUnion(cosmeticId),
      cash: admin.firestore.FieldValue.increment(-cosmetic.price),
    });

    return { success: true };
  });
});
