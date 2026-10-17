// Small, direct admin operations: grant/revoke, set cash, broadcast.
// The Discord-link tools are in adminDiscordOps.ts.
//
// The heavy data-repair jobs that used to live here are in adminRepair.js, and
// the ticker/roster migrations are in adminMigrate.js. Anything here should be a
// short, single-purpose action an admin triggers from the panel.
import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
// Modular import — the emulator sandbox strips admin.firestore statics.
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
const db = admin.firestore();
import { REINSTATE_CASH_DEFAULT, COSMETIC_CATALOG } from '../shared/constants';
import { SHOP_PINS } from '../shared/crews';
import { grantedValueUpdate } from '../shared/equity';
import { notifyCashGrant, notifyCosmeticGrant } from './adminCashNotify';
import { applyCashChange, parseCashRequest } from './adminCashCore';
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

// The rules (memo, one transaction, ledger, cash log, notification) live in
// adminCashCore.ts, shared with the panel's bulk grants.
export const adminSetCash = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  return applyCashChange(context, parseCashRequest(data || {}));
});

/**
 * Admin grant/revoke a cosmetic or a shop pin on a user (for giveaways). No
 * cash is charged. Pass `cosmeticId` or `pinId`. Revoking also takes the item
 * off (unequips the cosmetic, or stops displaying the pin), so the user isn't
 * left showing something they no longer own.
 */
export const adminGrantCosmetic = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const { userId, cosmeticId, pinId, revoke } = data || {};
  const cosmetic = cosmeticId ? COSMETIC_CATALOG[cosmeticId] : undefined;
  const pin = !cosmeticId && pinId ? SHOP_PINS[pinId] : undefined;
  const item = cosmetic
    ? {
        id: cosmeticId as string,
        name: cosmetic.name,
        price: cosmetic.price,
        field: 'ownedCosmetics',
        kind: 'cosmetic',
      }
    : pin
      ? { id: pin.id, name: pin.name, price: pin.price, field: 'ownedShopPins', kind: 'pin' }
      : null;
  if (!userId || !item) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and cosmeticId or pinId required');
  }

  const userRef = db.collection('users').doc(userId);
  let discordId: string | undefined;
  let displayName: string | undefined;
  const result = await db.runTransaction(async (transaction) => {
    const userSnap = await transaction.get(userRef);
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const userData = userSnap.data()!;
    const owned: string[] = Array.isArray(userData[item.field]) ? userData[item.field] : [];
    discordId = userData.discordId;
    displayName = userData.displayName;

    if (revoke) {
      if (!owned.includes(item.id)) {
        throw new functions.https.HttpsError('failed-precondition', `User does not own this ${item.kind}`);
      }
      const updates: Record<string, unknown> = { [item.field]: FieldValue.arrayRemove(item.id) };
      if (cosmetic) {
        const active = userData.activeCosmetics || {};
        if (active[cosmetic.type] === item.id) updates[`activeCosmetics.${cosmetic.type}`] = FieldValue.delete();
      } else if (Array.isArray(userData.displayedShopPins) && userData.displayedShopPins.includes(item.id)) {
        updates.displayedShopPins = FieldValue.arrayRemove(item.id);
      }
      transaction.update(userRef, updates);
      recordLedger(transaction, {
        uid: userId,
        type: cosmetic ? 'admin_revoke_cosmetic' : 'admin_revoke_pin',
        account: 'cosmetics',
        amount: -item.price,
        ref: item.id,
        detail: { by: context.auth!.uid },
      });
      return { success: true, userId, itemId: item.id, revoked: true };
    }

    if (owned.includes(item.id)) {
      throw new functions.https.HttpsError('already-exists', `User already owns this ${item.kind}`);
    }
    transaction.update(userRef, { [item.field]: FieldValue.arrayUnion(item.id) });
    recordLedger(transaction, {
      uid: userId,
      type: cosmetic ? 'admin_grant_cosmetic' : 'admin_grant_pin',
      account: 'cosmetics',
      amount: item.price,
      ref: item.id,
      detail: { by: context.auth!.uid },
    });
    return { success: true, userId, itemId: item.id, granted: true };
  });
  const verb = revoke ? 'revoke' : 'grant';
  await logAdminAction(context, {
    action: `${verb}_${item.kind}`,
    uid: userId,
    name: displayName,
    before: revoke ? item.id : null,
    after: revoke ? null : item.id,
    detail: cosmetic ? { cosmeticId: item.id, cosmeticName: item.name } : { pinId: item.id, pinName: item.name },
  });
  if (result.granted) await notifyCosmeticGrant(userId, discordId, item.id, item.name);
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
