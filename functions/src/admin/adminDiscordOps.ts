// Admin tools for a player's Discord link: the link wall, unlinking, freeing a
// Discord ID, and moving a link between accounts. Split out of adminOps.ts when
// that file reached its size limit.
import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
// Modular import — the emulator sandbox strips admin.firestore statics.
import { FieldValue } from 'firebase-admin/firestore';
const db = admin.firestore();
import { ADMIN_UID } from '../shared/constants';
import { logAdminAction } from '../shared/adminLog';

/**
 * Admin-only: flag or clear the Discord-link wall on a user. When set, the user
 * must link a Discord account before they can trade/bet/play (unless already linked).
 */
export const adminSetDiscordWall = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

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
  await logAdminAction(context, {
    action: 'set_discord_wall',
    uid: userId,
    name: userSnap.data()!.displayName,
    before: !!userSnap.data()!.requiresDiscordLink,
    after: value,
  });

  return { success: true, userId, requiresDiscordLink: value, alreadyLinked: !!userSnap.data()!.discordId };
});

/**
 * Admin-only: clear the Discord link on a user so a different Discord can be
 * linked. Users can't do this themselves — discordLink refuses to move an
 * account onto a new Discord, because a self-serve relink freed the old Discord
 * to verify another account. This is the manual escape hatch for people who
 * genuinely lost their Discord account.
 *
 * startingCashUnlocked is deliberately left alone: the account keeps its
 * verified status, so relinking can't pay out the starting-cash bonus twice.
 */
export const adminUnlinkDiscord = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { userId } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const previousDiscordId = userSnap.data()!.discordId || null;
  if (!previousDiscordId) {
    return { success: true, userId, previousDiscordId: null, alreadyUnlinked: true };
  }

  await userRef.update({
    discordId: FieldValue.delete(),
    discordUsername: FieldValue.delete(),
  });

  // A self-serve unlink reserves the Discord to its account for a week. An
  // admin unlink is the opposite — an immediate release — so drop the binding
  // too, rather than making the player wait the week out.
  try {
    await db.collection('discordBindings').doc(String(previousDiscordId)).delete();
  } catch (err) {
    logger.error('adminUnlinkDiscord: failed to clear Discord binding:', err);
  }
  await logAdminAction(context, {
    action: 'unlink_discord',
    uid: userId,
    name: userSnap.data()!.displayName,
    before: { discordId: previousDiscordId, discordUsername: userSnap.data()!.discordUsername || null },
    after: null,
  });

  return { success: true, userId, previousDiscordId, alreadyUnlinked: false };
});

/**
 * Admin-only: release every hold on a Discord ID so it can link anywhere.
 *
 * The other two Discord tools act on an account. This one acts on the Discord
 * itself, for the cases where there is no account left to act on:
 *
 *  - They deleted the account their Discord was attached to. deleteAccount
 *    tombstones it for DISCORD_RELINK_COOLDOWN_MS, so linking it to the account
 *    they actually use fails with `recently_deleted` for 30 days.
 *  - They unlinked it themselves from the wrong account. unlinkOwnDiscord
 *    reserves it to that account for DISCORD_BINDING_TTL_MS, so linking it
 *    elsewhere fails with `bound_to_other_account` until the week is up.
 *
 * Both are legitimate when someone ends up with duplicate accounts from mixing
 * Google and Discord logins. Refuses while a live account still holds the
 * Discord — that case wants adminUnlinkDiscord or adminMoveDiscordLink, and
 * clearing the holds without detaching it would do nothing.
 */
export const adminFreeDiscord = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { discordId } = data || {};
  if (!discordId || typeof discordId !== 'string' || !/^\d{5,32}$/.test(discordId.trim())) {
    throw new functions.https.HttpsError('invalid-argument', 'A numeric Discord ID is required');
  }
  const id = discordId.trim();

  const holderSnap = await db.collection('users').where('discordId', '==', id).limit(1).get();
  if (!holderSnap.empty) {
    const holder = holderSnap.docs[0]!;
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Still linked to ${holder.data()!.displayName || holder.id}. Unlink it from that account first.`,
    );
  }

  const tombRef = db.collection('discordTombstones').doc(id);
  const bindRef = db.collection('discordBindings').doc(id);
  const [tombSnap, bindSnap] = (await db.getAll(tombRef, bindRef)) as [
    admin.firestore.DocumentSnapshot,
    admin.firestore.DocumentSnapshot,
  ];

  const clearedTombstone = tombSnap.exists;
  const clearedBinding = bindSnap.exists;
  const boundTo = bindSnap.exists ? bindSnap.data()!.uid || null : null;

  await Promise.all([
    clearedTombstone ? tombRef.delete() : Promise.resolve(),
    clearedBinding ? bindRef.delete() : Promise.resolve(),
  ]);

  await logAdminAction(context, {
    action: 'free_discord',
    before: { tombstone: clearedTombstone, binding: clearedBinding, boundTo },
    after: null,
    detail: { discordId: id },
  });
  logger.info(`DISCORD FREED: ${id} (tombstone: ${clearedTombstone}, binding: ${clearedBinding})`);

  return { success: true, discordId: id, clearedTombstone, clearedBinding, boundTo };
});

/**
 * Admin-only: move a Discord link from one account onto another.
 *
 * The case this exists for: a player signed up through Discord, Discord itself
 * permanently suspended their Discord account, and their only route into
 * Stockism died with it. They make a fresh account on a new Discord and ask for
 * their portfolio back.
 *
 * Rather than migrate a portfolio — the user doc, portfolioHistory, cost basis,
 * share locks, open limit/pre-market orders, crew membership, ladder balance and
 * the username reservation, every one of which is a chance to duplicate value —
 * this repoints the NEW Discord at the ORIGINAL account. discordAuth resolves
 * logins by discordId, so their next "Login with Discord" lands them straight
 * back in their real account. Identity moves; not one dollar does.
 *
 * `sourceUserId` is the throwaway account holding the new Discord.
 * `targetUserId` is the original account they are getting back.
 *
 * Its Firebase Auth user is deleted so the source can't be resurrected as an
 * alt: it was created by discordAuth with an email and no password, so a
 * "forgot password" on that address would otherwise hand them a second live
 * account. The Firestore doc is left alone as an audit trail.
 *
 * startingCashUnlocked is deliberately untouched on both sides — the target is
 * already verified, so the move can never re-pay the starting-cash bonus.
 */
export const adminMoveDiscordLink = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { sourceUserId, targetUserId } = data || {};
  if (!sourceUserId || !targetUserId || typeof sourceUserId !== 'string' || typeof targetUserId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'sourceUserId and targetUserId required');
  }
  if (sourceUserId === targetUserId) {
    throw new functions.https.HttpsError('invalid-argument', 'Source and target must be different accounts');
  }
  if (sourceUserId === ADMIN_UID || targetUserId === ADMIN_UID) {
    throw new functions.https.HttpsError('invalid-argument', "Refusing to move the admin account's Discord link");
  }

  const sourceRef = db.collection('users').doc(sourceUserId);
  const targetRef = db.collection('users').doc(targetUserId);

  const moved = await db.runTransaction(async (transaction) => {
    const [sourceSnap, targetSnap] = (await transaction.getAll(sourceRef, targetRef)) as [
      admin.firestore.DocumentSnapshot,
      admin.firestore.DocumentSnapshot,
    ];
    if (!sourceSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Source account (the new one) not found');
    }
    if (!targetSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Target account (the original one) not found');
    }

    const source = sourceSnap.data()!;
    const target = targetSnap.data()!;
    const discordId = source.discordId;
    if (!discordId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'The source account has no Discord linked, so there is nothing to move. Check the two IDs are the right way round.',
      );
    }
    if (target.discordId === discordId) {
      return { discordId, alreadyMoved: true, deadDiscordId: null };
    }

    const now = Date.now();
    // The dead Discord is recorded rather than tombstoned: a permanently
    // suspended Discord can't complete OAuth, so it needs no cooldown.
    transaction.update(targetRef, {
      discordId,
      discordUsername: source.discordUsername || null,
      previousDiscordId: target.discordId || null,
      discordLinkMovedFrom: sourceUserId,
      discordLinkMovedAt: now,
    });
    transaction.update(sourceRef, {
      discordId: FieldValue.delete(),
      discordUsername: FieldValue.delete(),
      discordLinkMovedTo: targetUserId,
      discordLinkMovedAt: now,
    });

    return {
      discordId,
      alreadyMoved: false,
      deadDiscordId: target.discordId || null,
      sourceCash: source.cash || 0,
      sourcePortfolioValue: source.portfolioValue || 0,
    };
  });

  // A tombstone on the moved Discord would not block the login itself
  // (discordAuth matches discordId before it ever checks tombstones), but it
  // would silently break any future relink. The admin is explicitly blessing
  // this Discord onto this account, so clear it and say so.
  let clearedTombstone = false;
  try {
    const tombRef = db.collection('discordTombstones').doc(String(moved.discordId));
    if ((await tombRef.get()).exists) {
      await tombRef.delete();
      clearedTombstone = true;
    }
    // Same for a self-serve unlink binding: it names the source account as the
    // permanent owner, which is exactly what this call is overriding.
    await db.collection('discordBindings').doc(String(moved.discordId)).delete();
  } catch (err) {
    logger.error('adminMoveDiscordLink: failed to clear Discord tombstone/binding:', err);
  }

  // Kill the source's login without touching its data. Best-effort: the link
  // has already moved, and a missing auth user is the desired end state anyway.
  let authDeleted = false;
  if (!moved.alreadyMoved) {
    try {
      await admin.auth().deleteUser(sourceUserId);
      authDeleted = true;
    } catch (err) {
      if ((err as { code?: string }).code !== 'auth/user-not-found') {
        logger.error('adminMoveDiscordLink: failed to delete source auth user:', err);
      }
    }
  }

  await logAdminAction(context, {
    action: 'move_discord_link',
    uid: targetUserId,
    before: { targetDiscordId: moved.deadDiscordId },
    after: { targetDiscordId: moved.discordId },
    detail: { sourceUserId, authDeleted, alreadyMoved: moved.alreadyMoved },
  });
  logger.info(
    `DISCORD LINK MOVED: ${moved.discordId} from ${sourceUserId} to ${targetUserId} (auth deleted: ${authDeleted})`,
  );

  return {
    success: true,
    sourceUserId,
    targetUserId,
    discordId: moved.discordId,
    alreadyMoved: moved.alreadyMoved,
    deadDiscordId: moved.deadDiscordId,
    clearedTombstone,
    authDeleted,
    sourceCash: moved.sourceCash,
    sourcePortfolioValue: moved.sourcePortfolioValue,
  };
});
