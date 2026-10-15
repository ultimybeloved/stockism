// One admin change to one player's cash: the shared core of adminSetCash and
// the panel's bulk grants, so both follow the same rules. Internal module, not
// in services.ts.
//
// The memo is required (an unexplained balance change is the thing the cash
// log exists to stop), the change is one transaction from read to write, a
// raise is booked as granted value, and every change lands in the ledger, the
// adminCashLog (with the memo) and the admin history. Raises tell the player.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
import { FieldValue } from 'firebase-admin/firestore';
import { ADMIN_MEMO_MAX_LENGTH } from '../shared/constants';
import { grantedValueUpdate } from '../shared/equity';
import { notifyCashGrant } from './adminCashNotify';
import { recordLedger } from '../shared/ledger';
import { logAdminAction } from '../shared/adminLog';

const db = admin.firestore();

export type CashMode = 'set' | 'add' | 'subtract';

export interface CashRequest {
  userId: string;
  mode: CashMode;
  /** Rounded to cents. */
  amount: number;
  memo: string;
  /** The original set-only call, which needs no memo. */
  isLegacySet: boolean;
}

/** Validates an adminSetCash-style request. Throws HttpsError on bad input. */
export function parseCashRequest(data: {
  userId?: unknown;
  cash?: unknown;
  mode?: unknown;
  amount?: unknown;
  memo?: unknown;
}): CashRequest {
  // Three modes. 'set' writes an absolute figure; 'add' and 'subtract' move the
  // balance by `amount` so the admin never has to do the arithmetic themselves
  // (getting it wrong silently mints or destroys money). `cash` without a mode
  // is the original set-only call, kept so nothing breaks mid-deploy.
  const { userId, cash, mode = 'set', amount, memo } = data;
  const isLegacySet = typeof cash === 'number' && amount === undefined;
  const magnitude = isLegacySet ? cash : amount;

  if (!userId || typeof userId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }
  if (!['set', 'add', 'subtract'].includes(mode as string)) {
    throw new functions.https.HttpsError('invalid-argument', 'mode must be set, add, or subtract');
  }
  if (typeof magnitude !== 'number' || !isFinite(magnitude) || magnitude < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Amount must be a number >= 0');
  }

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
  return {
    userId,
    mode: mode as CashMode,
    amount: Math.round(magnitude * 100) / 100,
    memo: cleanMemo,
    isLegacySet,
  };
}

export async function applyCashChange(context: functions.https.CallableContext, req: CashRequest) {
  const { userId, mode, amount: rounded, memo: cleanMemo } = req;
  const userRef = db.collection('users').doc(userId);
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
}
