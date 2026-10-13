// Direct edits to a single player's game state, for the fixes that otherwise
// mean opening the Firebase console. Split out of adminOps.js, which was near
// its line limit.
//
// These deliberately skip the rules the player-facing paths enforce (crew switch
// penalty, rejoin lockout, margin eligibility) — an admin correcting a mistake
// shouldn't be charged for it. They still keep the derived state consistent, so
// nothing here can leave an account in a shape the game can't read.
import { grantedValueUpdate } from '../shared/equity';
import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
const db = admin.firestore();
import { CREW_MEMBERS, ADMIN_UID } from '../shared/constants';
import { purgeAccount } from '../shared/accountDeletion';
import { CHARACTERS } from '../shared/characters';
import { validateUsernameFormat } from '../shared/usernames';
import { cohortRemoveUpdate } from '../shared/cohorts';
import type { UserData } from '../shared/types';
import { recordLedger } from '../shared/ledger';
import { logAdminAction } from '../shared/adminLog';

const getUserRef = async (userId: unknown) => {
  if (!userId || typeof userId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }
  const ref = db.collection('users').doc(userId);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  return { ref, data: snap.data() as UserData & { marginEnabledAt?: number } };
};

/**
 * Rename a player, keeping the usernames reservation in step.
 *
 * The admin panel used to write displayName straight from the browser, which
 * skipped the `usernames/{lower}` reservation entirely: the old name stayed
 * reserved forever, the new one was never reserved, and nothing stopped a second
 * account claiming the same name. Anything that looks a player up by
 * displayNameLower (public profiles, the Discord bot) breaks on a duplicate.
 *
 * Same transaction as changeDisplayName in userProfile.js, minus the parts that
 * exist to price the change for players: no NAME_CHANGE_COST, no
 * NAME_CHANGE_COOLDOWN_MS, and no profanity/banned-word check — an admin is
 * usually renaming BECAUSE of a bad name and has to be able to set anything.
 * Uniqueness is not optional and is still enforced inside the transaction.
 */
export const adminChangeDisplayName = cf().https.onCall(
  async (data: { userId?: unknown; displayName?: unknown } | null, context) => {
    requireAdmin(context);

    const { userId, displayName } = data || {};
    if (!userId || typeof userId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'userId required');
    }
    if (!displayName || typeof displayName !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'displayName required');
    }

    const trimmed = displayName.trim();
    validateUsernameFormat(trimmed);
    const newNameLower = trimmed.toLowerCase();

    const userRef = db.collection('users').doc(userId);
    const newUsernameRef = db.collection('usernames').doc(newNameLower);

    const result = await db.runTransaction(async (transaction) => {
      const [userDoc, existingDoc] = await Promise.all([transaction.get(userRef), transaction.get(newUsernameRef)]);

      if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found');

      const userData = userDoc.data()!;
      const oldDisplayName = userData.displayName;
      const oldNameLower = userData.displayNameLower;

      if (newNameLower === oldNameLower) {
        throw new functions.https.HttpsError('invalid-argument', 'That is already their name');
      }
      // A reservation held by this same user is theirs to move; anyone else's blocks.
      if (existingDoc.exists && existingDoc.data()!.uid !== userId) {
        throw new functions.https.HttpsError('already-exists', 'That username is already taken');
      }

      // Legacy accounts predate the reservation collection and have no old doc.
      if (oldNameLower) transaction.delete(db.collection('usernames').doc(oldNameLower));
      transaction.set(newUsernameRef, { uid: userId, createdAt: FieldValue.serverTimestamp() });
      transaction.update(userRef, {
        displayName: trimmed,
        displayNameLower: newNameLower,
        previousDisplayName: oldDisplayName || null,
        nameChangedAt: FieldValue.serverTimestamp(),
      });

      return { success: true, userId, previousDisplayName: oldDisplayName || null, displayName: trimmed };
    });
    await logAdminAction(context, {
      action: 'rename',
      uid: userId,
      name: trimmed,
      before: result.previousDisplayName,
      after: trimmed,
    });
    return result;
  },
);

/**
 * Move a player to another crew, or clear their crew entirely.
 *
 * Unlike switchCrew this charges no CREW_SWITCH_PENALTY, sets no 30-day rejoin
 * lockout and ignores the 24h cooldown. It still strips the crown, because that
 * is earned per crew by the weekly rotation and must never travel with a player.
 * market/crewStats is rebuilt weekly from user docs, so it needs no touch-up.
 */
export const adminSetCrew = cf().https.onCall(async (data: { userId?: unknown; crewId?: string } | null, context) => {
  requireAdmin(context);

  const { userId, crewId } = data || {};
  const clearing = !crewId;
  if (!clearing && !CREW_MEMBERS[crewId!]) {
    throw new functions.https.HttpsError('invalid-argument', `Unknown crew: ${crewId}`);
  }

  const { ref, data: userData } = await getUserRef(userId);
  const previousCrew = userData.crew || null;
  if (previousCrew === (clearing ? null : crewId)) {
    return { success: true, unchanged: true, crew: previousCrew };
  }

  const update: Record<string, unknown> = {
    isCrewHead: false,
    crewHeadStreak: 0,
  };
  if (clearing) {
    update.crew = FieldValue.delete();
    update.crewJoinedAt = FieldValue.delete();
  } else {
    update.crew = crewId;
    update.crewJoinedAt = Date.now();
    update.crewHistory = FieldValue.arrayUnion(crewId);
  }

  await ref.update(update);
  await logAdminAction(context, {
    action: 'set_crew',
    uid: userId as string,
    name: userData.displayName,
    before: { crew: previousCrew, isCrewHead: !!userData.isCrewHead },
    after: { crew: clearing ? null : crewId, isCrewHead: false },
  });
  return { success: true, unchanged: false, previousCrew, crew: clearing ? null : crewId };
});

/**
 * Award an achievement, mirroring removeAchievement in adminOps.js.
 *
 * The achievement catalogue lives in src/constants/achievements.ts and is not
 * duplicated backend-side, so the ID is validated by shape only — the admin
 * picks from the real list in the panel.
 */
export const adminGrantAchievement = cf().https.onCall(
  async (data: { userId?: unknown; achievementId?: unknown } | null, context) => {
    requireAdmin(context);

    const { userId, achievementId } = data || {};
    if (!achievementId || typeof achievementId !== 'string' || !/^[A-Z0-9_]{2,50}$/.test(achievementId)) {
      throw new functions.https.HttpsError('invalid-argument', 'Valid achievementId required');
    }

    const { ref, data: userData } = await getUserRef(userId);
    if ((userData.achievements || []).includes(achievementId)) {
      return { success: true, alreadyEarned: true, achievementId };
    }

    await ref.update({
      achievements: FieldValue.arrayUnion(achievementId),
      [`achievementDates.${achievementId}`]: Date.now(),
    });
    await logAdminAction(context, {
      action: 'grant_achievement',
      uid: userId as string,
      name: userData.displayName,
      before: null,
      after: achievementId,
    });

    return { success: true, alreadyEarned: false, achievementId };
  },
);

/**
 * Turn margin on or off for an account and optionally wipe what it owes.
 *
 * Disabling with an outstanding balance is what the player-facing toggle
 * refuses to do, which is exactly why an admin needs it: an account stuck with
 * unpayable margin debt can't be fixed from the game side. Clearing the debt
 * forgives it outright — no cash moves.
 */
export const adminSetMargin = cf().https.onCall(
  async (data: { userId?: unknown; enabled?: unknown; clearDebt?: unknown } | null, context) => {
    requireAdmin(context);

    const { userId, enabled, clearDebt } = data || {};
    if (typeof enabled !== 'boolean') {
      throw new functions.https.HttpsError('invalid-argument', 'enabled (boolean) required');
    }

    const { ref, data: userData } = await getUserRef(userId);
    const previousMarginUsed = userData.marginUsed || 0;

    const update: Record<string, unknown> = { marginEnabled: enabled };
    if (enabled) {
      update.marginEnabledAt = userData.marginEnabledAt || Date.now();
    }
    if (clearDebt) {
      update.marginUsed = 0;
      update.activeLoan = FieldValue.delete();
    }

    await ref.update(update);
    await logAdminAction(context, {
      action: 'set_margin',
      uid: userId as string,
      name: userData.displayName,
      before: { marginEnabled: !!userData.marginEnabled, marginUsed: previousMarginUsed },
      after: { marginEnabled: enabled, marginUsed: clearDebt ? 0 : previousMarginUsed },
    });
    return {
      success: true,
      marginEnabled: enabled,
      clearedDebt: !!clearDebt,
      previousMarginUsed,
    };
  },
);

/**
 * Set or clear a player's share count in one ticker, with its cost basis.
 *
 * Zero shares removes the position and its cost basis rather than storing a
 * dead 0, which is how the sell path leaves holdings. portfolioValue is NOT
 * recomputed here — that math lives in syncPortfolio and duplicating it is how
 * the codebase ended up with four copies of every price calculation. Hit Sync
 * on the user card afterwards; the panel prompts for it.
 */
export const adminSetHolding = cf().https.onCall(
  async (data: { userId?: unknown; ticker?: unknown; shares?: unknown; costBasis?: unknown } | null, context) => {
    requireAdmin(context);

    const { userId, ticker, shares, costBasis } = data || {};
    if (!ticker || typeof ticker !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'ticker required');
    }
    if (!CHARACTERS.some((c) => c.ticker === ticker)) {
      throw new functions.https.HttpsError('invalid-argument', `Unknown ticker: ${ticker}`);
    }
    if (typeof shares !== 'number' || !isFinite(shares) || shares < 0) {
      throw new functions.https.HttpsError('invalid-argument', 'shares must be a number >= 0');
    }
    if (
      costBasis !== undefined &&
      costBasis !== null &&
      (typeof costBasis !== 'number' || !isFinite(costBasis) || costBasis < 0)
    ) {
      throw new functions.https.HttpsError('invalid-argument', 'costBasis must be a number >= 0');
    }

    const { ref, data: userData } = await getUserRef(userId);
    const previousShares = (userData.holdings || {})[ticker] || 0;

    // Matches the sell path: fractional shares are kept to 4 decimals.
    const rounded = Math.round(shares * 10000) / 10000;
    const update: Record<string, unknown> = {};
    if (rounded <= 0) {
      update[`holdings.${ticker}`] = FieldValue.delete();
      update[`costBasis.${ticker}`] = FieldValue.delete();
    } else {
      update[`holdings.${ticker}`] = rounded;
      if (costBasis !== undefined && costBasis !== null) {
        update[`costBasis.${ticker}`] = Math.round(costBasis * 100) / 100;
      }
    }

    // Take the dividend/exit-loyalty lot ledger down with any shares removed,
    // exactly as a sell would (clearing the position deletes it outright). Adding
    // shares is deliberately left alone: the next dividend run opens a fresh lot
    // for them, which is the "no retroactive dividends" rule in dividends.js.
    if (rounded < previousShares) {
      Object.assign(update, cohortRemoveUpdate(userData, ticker, previousShares - rounded));
    }

    // Valued at the current price so a share edit shows up in the money trail.
    const price = ((await db.collection('market').doc('current').get()).data()?.prices || {})[ticker] || 0;
    // Shares handed out are free money, like a cash grant: booked as granted so a
    // giveaway doesn't read as a real gain on the percent boards. Taking shares
    // away books nothing (grantedValueUpdate ignores a negative).
    Object.assign(update, grantedValueUpdate((rounded - previousShares) * price));
    const batch = db.batch();
    batch.update(ref, update);
    recordLedger(batch, {
      uid: userId as string,
      type: 'admin_set_holding',
      account: 'shares',
      amount: (rounded - previousShares) * price,
      ref: ticker,
      detail: { by: context.auth!.uid, previousShares, shares: rounded, price },
    });
    await batch.commit();
    await logAdminAction(context, {
      action: 'set_holding',
      uid: userId as string,
      name: userData.displayName,
      before: { ticker, shares: previousShares, costBasis: (userData.costBasis || {})[ticker] ?? null },
      after: {
        ticker,
        shares: rounded,
        costBasis: rounded <= 0 ? null : (update[`costBasis.${ticker}`] ?? (userData.costBasis || {})[ticker] ?? null),
      },
    });
    return { success: true, ticker, previousShares, shares: rounded, cleared: rounded <= 0 };
  },
);

/**
 * Delete an account from the admin panel with the same full clean-up a player's
 * own deletion gets (see purgeAccount). The panel used to delete the user doc
 * straight from the browser.
 */
export const adminDeleteUser = cf({ timeoutSeconds: 120 }).https.onCall(
  async (data: { userId?: unknown } | null, context) => {
    requireAdmin(context);
    const { ref, data: userData } = await getUserRef(data?.userId);
    if (ref.id === ADMIN_UID) {
      throw new functions.https.HttpsError('failed-precondition', "The admin account can't be deleted here.");
    }
    await purgeAccount(ref.id, userData as Record<string, unknown>, `admin:${context.auth!.uid}`);
    await logAdminAction(context, {
      action: 'delete_user',
      uid: ref.id,
      name: userData.displayName,
      before: { cash: userData.cash ?? 0, portfolioValue: userData.portfolioValue ?? 0, isBot: !!userData.isBot },
    });
    return { success: true, userId: ref.id };
  },
);

/**
 * Move one account onto another uid (a player who lost access and signed up
 * again). The panel used to copy the doc from the browser and then ASK whether to
 * delete the old one: answering no left the cash, shares and Discord on two
 * accounts at once, and the copy booked nothing in the ledger. Now the copy, the
 * name reservation and the ladder balance move in one transaction, and the old
 * account is always removed afterwards.
 */
export const adminTransferAccount = cf({ timeoutSeconds: 120 }).https.onCall(
  async (data: { fromUserId?: unknown; toUserId?: unknown } | null, context) => {
    requireAdmin(context);
    const fromId = typeof data?.fromUserId === 'string' ? data.fromUserId.trim() : '';
    const toId = typeof data?.toUserId === 'string' ? data.toUserId.trim() : '';
    if (!fromId || !toId || fromId === toId) {
      throw new functions.https.HttpsError('invalid-argument', 'Two different user IDs are required.');
    }
    if (fromId === ADMIN_UID || toId === ADMIN_UID) {
      throw new functions.https.HttpsError('failed-precondition', "The admin account can't be transferred.");
    }

    const fromRef = db.collection('users').doc(fromId);
    const toRef = db.collection('users').doc(toId);
    const fromLadder = db.collection('ladderGameUsers').doc(fromId);
    const toLadder = db.collection('ladderGameUsers').doc(toId);

    const { oldData, newData } = await db.runTransaction(async (tx) => {
      const [fromSnap, toSnap, ladderSnap] = await Promise.all([tx.get(fromRef), tx.get(toRef), tx.get(fromLadder)]);
      if (!fromSnap.exists) throw new functions.https.HttpsError('not-found', `Old user not found: ${fromId}`);
      if (!toSnap.exists) throw new functions.https.HttpsError('not-found', `New user not found: ${toId}`);
      const oldData = fromSnap.data()!;
      const newData = toSnap.data()!;

      // The new account becomes the old one, wholesale (not merged: fields only
      // the new account had would otherwise survive).
      tx.set(toRef, oldData);
      if (ladderSnap.exists) tx.set(toLadder, ladderSnap.data()!);

      // The old name now belongs to the new uid; the new account's own name is freed.
      const oldLower = oldData.displayNameLower as string | undefined;
      const newLower = newData.displayNameLower as string | undefined;
      if (oldLower)
        tx.set(db.collection('usernames').doc(oldLower), { uid: toId, createdAt: FieldValue.serverTimestamp() });
      if (newLower && newLower !== oldLower) tx.delete(db.collection('usernames').doc(newLower));

      recordLedger(tx, {
        uid: toId,
        type: 'admin_transfer_in',
        amount: (oldData.cash || 0) - (newData.cash || 0),
        cashAfter: oldData.cash || 0,
        detail: { by: context.auth!.uid, fromUid: fromId },
      });
      recordLedger(tx, {
        uid: fromId,
        type: 'admin_transfer_out',
        amount: -(oldData.cash || 0),
        cashAfter: 0,
        detail: { by: context.auth!.uid, toUid: toId },
      });
      return { oldData, newData };
    });

    // The old account is gone either way; its name and Discord moved with it.
    await purgeAccount(fromId, oldData, `admin_transfer:${context.auth!.uid}`, { keepIdentity: true });
    await logAdminAction(context, {
      action: 'transfer_account',
      uid: toId,
      name: newData.displayName,
      before: { cash: newData.cash ?? 0, portfolioValue: newData.portfolioValue ?? 0 },
      after: { cash: oldData.cash ?? 0, portfolioValue: oldData.portfolioValue ?? 0 },
      detail: { fromUid: fromId, fromName: oldData.displayName },
    });
    return { success: true, fromName: oldData.displayName || null };
  },
);
