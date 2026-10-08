// Account gates: bans, the Discord wall, Discord account binding, network keys.

import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import { DISCORD_RELINK_COOLDOWN_MS, ALT_IPV6_PREFIX_GROUPS, DISCORD_BINDING_TTL_MS } from './constants';
import type { UserData } from './types';
const db = admin.firestore();

/**
 * Reusable ban check — throws if user is banned.
 * Call right after fetching userData in any user-facing function.
 */
export function checkBanned(userData: UserData | null | undefined) {
  if (userData?.isBanned) {
    throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
  }
}

/**
 * Blocks value-moving actions for accounts flagged as a suspected alt (a same-IP
 * signup, or an admin manual flag) until they link a Discord account. Linking sets
 * `discordId`, which lifts the wall automatically. Mirrors checkBanned — call it
 * right after checkBanned in any function that moves money or affects the market.
 */
export function checkDiscordWall(userData: UserData | null | undefined) {
  if (userData?.requiresDiscordLink && !userData?.discordId) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Link your Discord account to continue. This is a one-time verification step.',
    );
  }
}

/**
 * Collapse an address to the thing that identifies a connection rather than a
 * session. IPv4 is used whole. IPv6 keeps only the routing prefix, because the
 * interface half of the address changes on its own throughout the day.
 * Shared by the alt detector and the watched-network signup block.
 */
export function networkKey(ip: unknown): string | null {
  if (!ip || typeof ip !== 'string' || ip === 'unknown') return null;
  const addr = ip.trim().toLowerCase();
  if (!addr.includes(':')) return addr; // IPv4
  const groups = addr.split(':');
  if (groups.length < ALT_IPV6_PREFIX_GROUPS) return addr;
  return groups.slice(0, ALT_IPV6_PREFIX_GROUPS).join(':') + '::/64';
}

/**
 * True if this Discord ID was linked to a Stockism account that was deleted
 * within the relink cooldown. Shared by discordAuth and discordLink so the two
 * can't drift. Blocks the create → grab the verified $3k → gamble → delete →
 * remake loop: deleteAccount tombstones the Discord ID, and this keeps it locked
 * for DISCORD_RELINK_COOLDOWN_MS before it can verify a fresh account again.
 * A tombstone marked `permanent` (a moderation removal, e.g. an alt ring) never
 * expires.
 */
export async function isDiscordRelinkBlocked(discordId: string | null | undefined): Promise<boolean> {
  if (!discordId) return false;
  const snap = await db.collection('discordTombstones').doc(String(discordId)).get();
  const data = snap.data();
  if (!snap.exists || !data) return false;
  if (data.permanent === true) return true;
  const deletedAt = data.deletedAt || 0;
  return Date.now() - deletedAt < DISCORD_RELINK_COOLDOWN_MS;
}

/**
 * The account a Discord ID was last attached to, with no regard for age.
 *
 * Written when a player unlinks their own Discord. Two different questions are
 * asked of it, and they expire differently — see isDiscordBindingLocked:
 *
 *   "Where does this Discord log in?"  — this function. Never expires, because
 *   it is only consulted when NO live account holds the Discord; sending them
 *   back where they came from always beats discordAuth's email fallback
 *   spawning a duplicate account.
 *
 *   "May a DIFFERENT account link it?" — isDiscordBindingLocked. Expires.
 *
 */
export async function getDiscordBinding(
  discordId: string | null | undefined,
): Promise<{ uid: string | null; boundAt: number } | null> {
  if (!discordId) return null;
  const snap = await db.collection('discordBindings').doc(String(discordId)).get();
  const data = snap.data();
  if (!snap.exists || !data) return null;
  const { uid = null, boundAt = 0 } = data;
  return { uid, boundAt };
}

/**
 * True if this Discord is reserved to some OTHER account right now.
 *
 * Unlinking is self-serve, so without a hold a freed Discord could farm the
 * one-time starting-cash unlock on account after account, re-claim daily drops
 * (claims are recorded per Stockism account, and each drop stays open 72 hours)
 * and clear the requiresDiscordLink wall on unlimited alts. The hold lapses
 * after DISCORD_BINDING_TTL_MS so a player who unlinks the wrong account isn't
 * stranded — an admin can also release it immediately with adminFreeDiscord.
 * @param uid - the account trying to link it
 */
export async function isDiscordBindingLocked(discordId: string | null | undefined, uid: string): Promise<boolean> {
  const binding = await getDiscordBinding(discordId);
  if (!binding || !binding.uid || binding.uid === uid) return false;
  return Date.now() - binding.boundAt < DISCORD_BINDING_TTL_MS;
}

/**
 * Reserve a Discord ID for a uid. A live reservation belongs to whoever holds
 * it; a lapsed one is up for grabs. Transactional so two accounts racing to
 * claim the same expired binding can't both win.
 */
export async function bindDiscordToUid(
  discordId: string,
  uid: string,
  discordUsername?: string | null,
): Promise<string> {
  const ref = db.collection('discordBindings').doc(String(discordId));
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.data();
    if (snap.exists && data) {
      const { uid: ownerUid, boundAt = 0 } = data;
      if (ownerUid && ownerUid !== uid && Date.now() - boundAt < DISCORD_BINDING_TTL_MS) {
        return ownerUid;
      }
    }
    tx.set(ref, {
      uid,
      discordUsername: discordUsername || null,
      boundAt: Date.now(),
    });
    return uid;
  });
}
