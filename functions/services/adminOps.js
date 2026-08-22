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
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();
const {
  ADMIN_UID,
  ADMIN_MEMO_MAX_LENGTH,
  REINSTATE_CASH_DEFAULT,
  COSMETIC_CATALOG,
} = require('../constants');
const { grantedValueUpdate } = require('../helpers');

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
    reinstatedBy: 'admin',
    // Booked as granted so a reinstate can't read as a spectacular recovery.
    ...grantedValueUpdate(cashBoost),
  });

  return { success: true, userId, cashAdded: cashBoost };
});

exports.adminSetCash = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  // Three modes. 'set' writes an absolute figure; 'add' and 'subtract' move the
  // balance by `amount` so the admin never has to do the arithmetic themselves
  // (getting it wrong silently mints or destroys money). `cash` without a mode
  // is the original set-only call, kept so nothing breaks mid-deploy.
  const { userId, cash, mode = 'set', amount, memo } = data;
  const isLegacySet = typeof cash === 'number' && amount === undefined;
  const magnitude = isLegacySet ? cash : amount;

  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }
  if (!['set', 'add', 'subtract'].includes(mode)) {
    throw new functions.https.HttpsError('invalid-argument', 'mode must be set, add, or subtract');
  }
  if (typeof magnitude !== 'number' || !isFinite(magnitude) || magnitude < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Amount must be a number >= 0');
  }

  // The memo is the whole point of the log — an unexplained balance change is
  // the thing we are trying to stop having. Legacy set-only callers are exempt.
  const cleanMemo = String(memo || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!isLegacySet && !cleanMemo) {
    throw new functions.https.HttpsError('invalid-argument', 'A memo is required — say why the cash is changing.');
  }
  if (cleanMemo.length > ADMIN_MEMO_MAX_LENGTH) {
    throw new functions.https.HttpsError('invalid-argument', `Memo must be ${ADMIN_MEMO_MAX_LENGTH} characters or less`);
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const userData = userSnap.data();
  const prevCash = userData.cash || 0;
  const rounded = Math.round(magnitude * 100) / 100;
  const rawNew = mode === 'set' ? rounded
    : mode === 'add' ? prevCash + rounded
      : prevCash - rounded;
  const newCash = Math.round(rawNew * 100) / 100;

  // Refuse rather than clamp. Silently landing on $0 looks like it worked and
  // destroys however much the admin did not mean to take.
  if (newCash < 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `That would leave $${newCash.toFixed(2)}. They only have $${prevCash.toFixed(2)}.`
    );
  }

  // Giveaways are the most visible source of fake leaderboard returns — the top
  // of the percent board on 2026-08-13 was one. Only a raise counts as granted;
  // taking cash away is a correction, not a gift, and must not go negative.
  await userRef.update({
    cash: newCash,
    ...grantedValueUpdate(newCash - prevCash),
  });

  // Written after the balance lands, so the log never claims a change that
  // failed. Best-effort: a logging failure must not fail the adjustment itself.
  try {
    await db.collection('adminCashLog').add({
      userId,
      displayName: userData.displayName || null,
      mode,
      amount: rounded,
      previousCash: prevCash,
      newCash,
      delta: Math.round((newCash - prevCash) * 100) / 100,
      memo: cleanMemo || null,
      at: admin.firestore.FieldValue.serverTimestamp(),
      by: context.auth.uid,
    });
  } catch (err) {
    console.error('adminSetCash: failed to write adminCashLog:', err.message);
  }

  return {
    success: true, userId, mode,
    previousCash: prevCash, newCash,
    delta: Math.round((newCash - prevCash) * 100) / 100,
  };
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
exports.adminUnlinkDiscord = cf().https.onCall(async (data, context) => {
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

  const previousDiscordId = userSnap.data().discordId || null;
  if (!previousDiscordId) {
    return { success: true, userId, previousDiscordId: null, alreadyUnlinked: true };
  }

  await userRef.update({
    discordId: admin.firestore.FieldValue.delete(),
    discordUsername: admin.firestore.FieldValue.delete()
  });

  // A self-serve unlink reserves the Discord to its account for a week. An
  // admin unlink is the opposite — an immediate release — so drop the binding
  // too, rather than making the player wait the week out.
  try {
    await db.collection('discordBindings').doc(String(previousDiscordId)).delete();
  } catch (err) {
    console.error('adminUnlinkDiscord: failed to clear Discord binding:', err);
  }

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
exports.adminFreeDiscord = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { discordId } = data || {};
  if (!discordId || typeof discordId !== 'string' || !/^\d{5,32}$/.test(discordId.trim())) {
    throw new functions.https.HttpsError('invalid-argument', 'A numeric Discord ID is required');
  }
  const id = discordId.trim();

  const holderSnap = await db.collection('users').where('discordId', '==', id).limit(1).get();
  if (!holderSnap.empty) {
    const holder = holderSnap.docs[0];
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Still linked to ${holder.data().displayName || holder.id}. Unlink it from that account first.`
    );
  }

  const tombRef = db.collection('discordTombstones').doc(id);
  const bindRef = db.collection('discordBindings').doc(id);
  const [tombSnap, bindSnap] = await db.getAll(tombRef, bindRef);

  const clearedTombstone = tombSnap.exists;
  const clearedBinding = bindSnap.exists;
  const boundTo = bindSnap.exists ? (bindSnap.data().uid || null) : null;

  await Promise.all([
    clearedTombstone ? tombRef.delete() : Promise.resolve(),
    clearedBinding ? bindRef.delete() : Promise.resolve(),
  ]);

  console.log(`DISCORD FREED: ${id} (tombstone: ${clearedTombstone}, binding: ${clearedBinding})`);

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
exports.adminMoveDiscordLink = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { sourceUserId, targetUserId } = data || {};
  if (!sourceUserId || !targetUserId || typeof sourceUserId !== 'string' || typeof targetUserId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'sourceUserId and targetUserId required');
  }
  if (sourceUserId === targetUserId) {
    throw new functions.https.HttpsError('invalid-argument', 'Source and target must be different accounts');
  }
  if (sourceUserId === ADMIN_UID || targetUserId === ADMIN_UID) {
    throw new functions.https.HttpsError('invalid-argument', 'Refusing to move the admin account\'s Discord link');
  }

  const sourceRef = db.collection('users').doc(sourceUserId);
  const targetRef = db.collection('users').doc(targetUserId);

  const moved = await db.runTransaction(async (transaction) => {
    const [sourceSnap, targetSnap] = await transaction.getAll(sourceRef, targetRef);
    if (!sourceSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Source account (the new one) not found');
    }
    if (!targetSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'Target account (the original one) not found');
    }

    const source = sourceSnap.data();
    const target = targetSnap.data();
    const discordId = source.discordId;
    if (!discordId) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        'The source account has no Discord linked, so there is nothing to move. Check the two IDs are the right way round.'
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
      discordLinkMovedAt: now
    });
    transaction.update(sourceRef, {
      discordId: FieldValue.delete(),
      discordUsername: FieldValue.delete(),
      discordLinkMovedTo: targetUserId,
      discordLinkMovedAt: now
    });

    return {
      discordId,
      alreadyMoved: false,
      deadDiscordId: target.discordId || null,
      sourceCash: source.cash || 0,
      sourcePortfolioValue: source.portfolioValue || 0
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
    console.error('adminMoveDiscordLink: failed to clear Discord tombstone/binding:', err);
  }

  // Kill the source's login without touching its data. Best-effort: the link
  // has already moved, and a missing auth user is the desired end state anyway.
  let authDeleted = false;
  if (!moved.alreadyMoved) {
    try {
      await admin.auth().deleteUser(sourceUserId);
      authDeleted = true;
    } catch (err) {
      if (err.code !== 'auth/user-not-found') {
        console.error('adminMoveDiscordLink: failed to delete source auth user:', err);
      }
    }
  }

  console.log(`DISCORD LINK MOVED: ${moved.discordId} from ${sourceUserId} to ${targetUserId} (auth deleted: ${authDeleted})`);

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
    sourcePortfolioValue: moved.sourcePortfolioValue
  };
});
