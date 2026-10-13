// Deleting an account, all the way. Used by a player deleting their own account
// and by the admin panel. The admin panel used to delete only the user doc from
// the browser, which skipped every step below: no archive copy, no name
// reservation, subcollections and the ladder doc left behind as ghosts, no IP or
// Discord tombstone, and the sign-in left alive.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { archiveAccount } from './accountArchive';

const db = admin.firestore();

// keepIdentity: the account was moved to another uid (admin transfer), so its
// name and Discord now belong to that account and must not be tombstoned.
export const purgeAccount = async (
  uid: string,
  userData: Record<string, unknown>,
  deletedBy: string,
  { keepIdentity = false }: { keepIdentity?: boolean } = {},
) => {
  const userRef = db.collection('users').doc(uid);
  const displayNameLower = userData.displayNameLower as string | undefined;

  // Keep a copy first: if it can't be saved, nothing is deleted.
  await archiveAccount(uid, userData, deletedBy);

  // Mark username as deleted (but keep reserved) first, so the name stays
  // claimed even if a later step fails.
  if (displayNameLower && !keepIdentity) {
    const usernameRef = db.collection('usernames').doc(displayNameLower);
    await usernameRef.set(
      {
        deleted: true,
        deletedAt: FieldValue.serverTimestamp(),
        deletedUid: uid,
      },
      { merge: true },
    );
  }

  // Recursively delete the user document AND its subcollections
  // (notifications, portfolioHistory, etc.). Firestore does not cascade, so a
  // plain doc delete would orphan that data forever.
  await db.recursiveDelete(userRef);

  // The ladder account is a TOP-LEVEL doc keyed by uid, so recursiveDelete
  // above does not reach it. Left behind it becomes a ghost: the collection is
  // world-readable for the ladder leaderboard, and an orphan with no user doc
  // renders there as "Anonymous" holding a real balance and occupying a
  // top-50 slot. Best-effort — a failure here must not block the deletion.
  try {
    await db.collection('ladderGameUsers').doc(uid).delete();
  } catch (e) {
    /* nothing to remove, or already gone */
  }

  // Release this account's per-IP slot, but only after IP_SLOT_RELEASE_MS. We drop
  // it from the live `accounts` map and tombstone it in `deletedAccounts` with the
  // deletion time; the signup cap counts recent tombstones, so the slot stays held
  // for ~a month. This kills the pump → delete → remake loop without permanently
  // locking out genuine deleters.
  // The slot lives under signupTrackingKey since 2026-10-13 (whole connection);
  // older accounts recorded it under the raw signupIp.
  const slotKey = (userData.signupTrackingKey || userData.signupIp) as string | undefined;
  if (slotKey) {
    try {
      await db
        .collection('ipTracking')
        .doc(slotKey)
        .update({
          [`accounts.${uid}`]: FieldValue.delete(),
          [`deletedAccounts.${uid}`]: Date.now(),
        });
    } catch (e) {
      /* IP tracking doc may not exist */
    }
  }

  // Tombstone the linked Discord account so it can't immediately verify a fresh
  // account and re-claim the $3k starting cash (the create → gamble → delete →
  // remake loop). The slot frees up after DISCORD_RELINK_COOLDOWN_MS; deleting
  // again later just resets the clock (merge overwrites deletedAt).
  if (userData.discordId && !keepIdentity) {
    try {
      await db.collection('discordTombstones').doc(String(userData.discordId)).set(
        {
          deletedAt: Date.now(),
          lastUid: uid,
        },
        { merge: true },
      );
    } catch (e) {
      /* best-effort — never block deletion on this */
    }
  }

  // Delete the sign-in. Bots and some old accounts never had one.
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    if ((e as { code?: string }).code !== 'auth/user-not-found') throw e;
  }
};
