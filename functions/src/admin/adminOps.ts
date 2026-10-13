// Small, direct admin operations: grant/revoke, set cash, broadcast.
// The Discord-link tools are in adminDiscordOps.ts.
//
// The heavy data-repair jobs that used to live here are in adminRepair.js, and
// the ticker/roster migrations are in adminMigrate.js. Anything here should be a
// short, single-purpose action an admin triggers from the panel.
import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
// Modular import — the emulator sandbox strips admin.firestore statics.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
const db = admin.firestore();
import { ADMIN_MEMO_MAX_LENGTH, REINSTATE_CASH_DEFAULT, COSMETIC_CATALOG } from '../shared/constants';
import { grantedValueUpdate } from '../shared/equity';
import { notifyCashGrant, notifyCosmeticGrant } from './adminCashNotify';
import { recordLedger } from '../shared/ledger';
import { logAdminAction } from '../shared/adminLog';

export const removeAchievement = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

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
    achievements: FieldValue.arrayRemove(achievementId),
    displayedAchievementPins: FieldValue.arrayRemove(achievementId),
    [`achievementDates.${achievementId}`]: FieldValue.delete(),
  });
  const had = (userSnap.data()!.achievements || []).includes(achievementId);
  await logAdminAction(context, {
    action: 'remove_achievement',
    uid: userId,
    name: userSnap.data()!.displayName,
    before: had ? achievementId : null,
    after: null,
    detail: { achievementId },
  });

  return { success: true, removed: achievementId, userId };
});

/**
 * Admin reinstate a bankrupt user - gives them $1000 cash without wiping crew/holdings
 */
export const reinstateUser = cf().https.onCall(async (data, context) => {
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

  const userData = userSnap.data()!;
  const cashBoost = Math.max(0, REINSTATE_CASH_DEFAULT - (userData.cash || 0));

  const batch = db.batch();
  batch.update(userRef, {
    isBankrupt: false,
    cash: FieldValue.increment(cashBoost),
    reinstatedAt: Date.now(),
    reinstatedBy: 'admin',
    // Booked as granted so a reinstate can't read as a spectacular recovery.
    ...grantedValueUpdate(cashBoost),
  });
  recordLedger(batch, {
    uid: userId,
    type: 'admin_reinstate',
    amount: cashBoost,
    cashAfter: (userData.cash || 0) + cashBoost,
    detail: { by: context.auth!.uid },
  });
  await batch.commit();
  await logAdminAction(context, {
    action: 'reinstate',
    uid: userId,
    name: userData.displayName,
    before: { cash: userData.cash || 0, isBankrupt: !!userData.isBankrupt },
    after: { cash: (userData.cash || 0) + cashBoost, isBankrupt: false },
  });

  // After the write, so we never announce money that failed to land.
  await notifyCashGrant(userId, userData, cashBoost);

  return { success: true, userId, cashAdded: cashBoost };
});

export const adminSetCash = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

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
  const cleanMemo = String(memo || '')
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  if (!isLegacySet && !cleanMemo) {
    throw new functions.https.HttpsError('invalid-argument', 'A memo is required — say why the cash is changing.');
  }
  if (cleanMemo.length > ADMIN_MEMO_MAX_LENGTH) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Memo must be ${ADMIN_MEMO_MAX_LENGTH} characters or less`,
    );
  }

  const userRef = db.collection('users').doc(userId);
  const rounded = Math.round(magnitude * 100) / 100;
  // One transaction from read to write. 'add' and 'subtract' used to write an
  // absolute balance worked out from a read taken earlier, so a sale or
  // dividend landing in between was erased and the ledger entry was wrong.
  const { userData, prevCash, newCash } = await db.runTransaction(async (tx) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    const userData = userSnap.data()!;
    const prevCash: number = userData.cash || 0;
    const rawNew = mode === 'set' ? rounded : mode === 'add' ? prevCash + rounded : prevCash - rounded;
    const newCash = Math.round(rawNew * 100) / 100;

    // Refuse rather than clamp. Silently landing on $0 looks like it worked and
    // destroys however much the admin did not mean to take.
    if (newCash < 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `That would leave $${newCash.toFixed(2)}. They only have $${prevCash.toFixed(2)}.`,
      );
    }

    // Giveaways are the most visible source of fake leaderboard returns — the top
    // of the percent board on 2026-08-13 was one. Only a raise counts as granted;
    // taking cash away is a correction, not a gift, and must not go negative.
    tx.update(userRef, {
      cash: newCash,
      ...grantedValueUpdate(newCash - prevCash),
    });
    // The memo stays in adminCashLog only; the ledger notes who and how.
    recordLedger(tx, {
      uid: userId,
      type: 'admin_set_cash',
      amount: newCash - prevCash,
      cashAfter: newCash,
      detail: { by: context.auth!.uid, mode },
    });
    return { userData, prevCash, newCash };
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
      at: FieldValue.serverTimestamp(),
      by: context.auth!.uid,
    });
  } catch (err) {
    logger.error('adminSetCash: failed to write adminCashLog:', (err as Error).message);
  }
  await logAdminAction(context, {
    action: 'set_cash',
    uid: userId,
    name: userData.displayName,
    before: prevCash,
    after: newCash,
    detail: { mode, memo: cleanMemo || null },
  });

  // Raises only. The memo stays internal; the player is told the amount and
  // nothing else. Fail-soft: the cash is already theirs either way.
  let delivery = { notified: false, dmSent: false };
  try {
    delivery = await notifyCashGrant(userId, userData, newCash - prevCash);
  } catch (err) {
    logger.error('adminSetCash: failed to notify player:', (err as Error).message);
  }

  return {
    success: true,
    userId,
    mode,
    notified: delivery.notified,
    dmSent: delivery.dmSent,
    previousCash: prevCash,
    newCash,
    delta: Math.round((newCash - prevCash) * 100) / 100,
  };
});

/**
 * Admin grant/revoke a cosmetic on a user (for giveaways). No cash is charged.
 * Revoking also unequips the cosmetic if it's the active one for its slot, so
 * the user isn't left displaying something they no longer own.
 */
export const adminGrantCosmetic = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { userId, cosmeticId, revoke } = data || {};
  const cosmetic = COSMETIC_CATALOG[cosmeticId];
  if (!userId || !cosmetic) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and cosmeticId required');
  }

  const userRef = db.collection('users').doc(userId);
  let discordId: string | undefined;
  let displayName: string | undefined;
  const result = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const owned = userSnap.data()!.ownedCosmetics || [];
    discordId = userSnap.data()!.discordId;
    displayName = userSnap.data()!.displayName;

    if (revoke) {
      if (!owned.includes(cosmeticId)) {
        throw new functions.https.HttpsError('failed-precondition', 'User does not own this cosmetic');
      }
      const updates: Record<string, unknown> = { ownedCosmetics: FieldValue.arrayRemove(cosmeticId) };
      const active = userSnap.data()!.activeCosmetics || {};
      if (active[cosmetic.type] === cosmeticId) {
        updates[`activeCosmetics.${cosmetic.type}`] = FieldValue.delete();
      }
      transaction.update(userRef, updates);
      recordLedger(transaction, {
        uid: userId,
        type: 'admin_revoke_cosmetic',
        account: 'cosmetics',
        amount: -cosmetic.price,
        ref: cosmeticId,
        detail: { by: context.auth!.uid },
      });
      return { success: true, userId, cosmeticId, revoked: true };
    }

    if (owned.includes(cosmeticId)) {
      throw new functions.https.HttpsError('already-exists', 'User already owns this cosmetic');
    }
    transaction.update(userRef, { ownedCosmetics: FieldValue.arrayUnion(cosmeticId) });
    recordLedger(transaction, {
      uid: userId,
      type: 'admin_grant_cosmetic',
      account: 'cosmetics',
      amount: cosmetic.price,
      ref: cosmeticId,
      detail: { by: context.auth!.uid },
    });
    return { success: true, userId, cosmeticId, granted: true };
  });
  await logAdminAction(context, {
    action: revoke ? 'revoke_cosmetic' : 'grant_cosmetic',
    uid: userId,
    name: displayName,
    before: revoke ? cosmeticId : null,
    after: revoke ? null : cosmeticId,
    detail: { cosmeticId, cosmeticName: cosmetic.name },
  });
  if (result.granted) await notifyCosmeticGrant(userId, discordId, cosmeticId, cosmetic.name);
  return result;
});

/**
 * Admin-only: broadcast a notification to every (non-bot) user's bell. Used to
 * announce game changes so players aren't confused. Batched so a few thousand
 * users is one quick run.
 */
export const broadcastNotification = cf({ timeoutSeconds: 300 }).https.onCall(async (data, context) => {
  requireAdmin(context);

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
    if (doc.data()!.isBot) continue;
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
  await logAdminAction(context, {
    action: 'broadcast',
    detail: { title, message, sent, predictionId: predictionId || null },
  });

  return { success: true, sent };
});
