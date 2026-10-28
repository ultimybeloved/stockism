// Admin shop credit: give a player shop credit (giveaway prizes) or take some
// back. Credit is spendable only in the shop (rules/shop), so a grant is not
// granted value and never touches cash. Like adminSetCash: a memo is required
// and stays private (admin history only), the change is one transaction, it
// lands in the ledger on the 'credit' account, and a gift tells the player.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { cf, requireAdmin } from '../shared/fnConfig';
import { ADMIN_MEMO_MAX_LENGTH } from '../shared/constants';
import { recordLedger } from '../shared/ledger';
import { logAdminAction } from '../shared/adminLog';
import { notifyShopCreditGrant } from './adminCashNotify';

const db = admin.firestore();

// Largest single change, so a typo can't hand out billions.
const MAX_CREDIT_CHANGE = 10_000_000;

/** `amount` is signed: positive gives, negative takes back. Whole dollars. */
export const adminGrantShopCredit = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const { userId, amount, memo } = data || {};
  if (!userId || typeof userId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }
  const delta = Math.round(Number(amount));
  if (!Number.isFinite(delta) || delta === 0 || Math.abs(delta) > MAX_CREDIT_CHANGE) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Amount must be a whole number, not 0, up to $10,000,000.',
    );
  }
  const cleanMemo = String(memo || '')
    // eslint-disable-next-line no-control-regex -- strips control characters on purpose
    .replace(/[\x00-\x1f\x7f]/g, '')
    .trim();
  if (!cleanMemo) throw new functions.https.HttpsError('invalid-argument', 'A memo is required.');
  if (cleanMemo.length > ADMIN_MEMO_MAX_LENGTH) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      `Memo must be ${ADMIN_MEMO_MAX_LENGTH} characters or less`,
    );
  }

  const userRef = db.collection('users').doc(userId);
  const { userData, before, after } = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
    const userData = snap.data()!;
    const before: number = userData.shopCredit || 0;
    const after = before + delta;
    // Refuse rather than clamp, like adminSetCash.
    if (after < 0) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        `They only have $${before.toLocaleString()} of shop credit.`,
      );
    }
    tx.update(userRef, { shopCredit: after });
    recordLedger(tx, {
      uid: userId,
      type: 'admin_shop_credit',
      account: 'credit',
      amount: delta,
      cashAfter: after,
      detail: { by: context.auth!.uid },
    });
    return { userData, before, after };
  });

  await logAdminAction(context, {
    action: 'shop_credit',
    uid: userId,
    name: userData.displayName,
    before,
    after,
    detail: { memo: cleanMemo },
  });
  if (delta > 0) await notifyShopCreditGrant(userId, userData.discordId, delta);
  return { success: true, before, after };
});
