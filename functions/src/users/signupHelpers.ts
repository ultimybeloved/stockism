// Signup helpers for createUser in users.ts. INTERNAL MODULE, not listed in
// services.js: it exports no Cloud Functions.
import * as admin from 'firebase-admin';
import { STARTING_CASH, UNVERIFIED_STARTING_CASH } from '../shared/constants';
import { isDiscordBindingLocked } from '../shared/accountGuards';
import { grantedValueUpdate } from '../shared/equity';
const db = admin.firestore();

// Deletes the orphaned Firebase Auth account left behind when a signup is hard-
// blocked (disposable email, IP cap, watched IP). The browser creates the auth
// login before calling createUser, so without this a blocked signup keeps a
// usable login that can sit around and retry. Best-effort — never masks the
// original block error. Never called for retryable failures (e.g. name taken).
export async function cleanupBlockedAuthUser(uid: string) {
  try {
    await admin.auth().deleteUser(uid);
  } catch (e) {
    console.error(`Failed to delete blocked auth user ${uid}:`, (e as Error).message);
  }
}

/**
 * Attach the Discord link a Discord signup arrived with.
 *
 * discordAuth creates only the Auth user and parks the Discord details in
 * `discordPending/{uid}`, so that signing up through Discord goes through the
 * same name rules as every other signup. This applies the link afterwards,
 * paying the one-time verification top-up exactly as discordLink does — the
 * account was just created on UNVERIFIED_STARTING_CASH, so they land on the same
 * full amount a Discord signup has always given.
 *
 * Re-checks ownership at this moment rather than trusting the parked record:
 * minutes can pass while someone picks a name, and the Discord may have been
 * claimed in between.
 */
export const applyPendingDiscordLink = async (uid: string) => {
  const pendingRef = db.collection('discordPending').doc(uid);
  const pending = await pendingRef.get();
  if (!pending.exists) return false;

  const { discordId, discordUsername } = pending.data()!;
  await pendingRef.delete();
  if (!discordId) return false;

  const taken = await db.collection('users').where('discordId', '==', discordId).limit(1).get();
  if (!taken.empty && taken.docs[0]!.id !== uid) return false;
  if (await isDiscordBindingLocked(discordId, uid)) return false;

  await db
    .collection('users')
    .doc(uid)
    .update({
      discordId,
      discordUsername: discordUsername || null,
      cash: admin.firestore.FieldValue.increment(STARTING_CASH - UNVERIFIED_STARTING_CASH),
      startingCashUnlocked: true,
      achievements: admin.firestore.FieldValue.arrayUnion('DISCORD_LINKED'),
      'achievementDates.DISCORD_LINKED': Date.now(),
      ...grantedValueUpdate(STARTING_CASH - UNVERIFIED_STARTING_CASH),
    });
  return true;
};
