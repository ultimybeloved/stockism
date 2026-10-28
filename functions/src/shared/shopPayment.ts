// Charges a shop price inside the caller's transaction: shop credit first, cash
// for the rest (rules/shop splitShopPayment). Every shop callable goes through
// here, so credit is spent the same way everywhere and both halves land in
// the ledger: the cash part as an ordinary entry of the purchase type, the
// credit part as an entry of the same type on the 'credit' account.
import * as functions from 'firebase-functions/v1';
import type * as admin from 'firebase-admin';
import { recordLedger } from './ledger';
import { round2 } from './money';
import { splitShopPayment } from './rules/shop';

export interface ShopCharge {
  /** Spread into the caller's user-doc update. */
  updates: { cash?: number; shopCredit?: number };
  paid: { cash: number; credit: number };
}

export const chargeShop = (
  tx: admin.firestore.Transaction,
  uid: string,
  user: { cash?: number; shopCredit?: number },
  price: number,
  entry: { type: string; ref?: string | null; detail?: Record<string, unknown> | null },
): ShopCharge => {
  // A missing price compares false against any balance and charged $0.
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid item.');
  }
  const cash = user.cash || 0;
  const credit = Math.max(0, user.shopCredit || 0);
  if (cash + credit < price) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      credit > 0 ? 'Not enough cash and shop credit.' : 'Not enough cash.',
    );
  }
  const { fromCredit, fromCash } = splitShopPayment(price, credit);
  const updates: ShopCharge['updates'] = {};
  if (fromCash > 0) updates.cash = round2(cash - fromCash);
  if (fromCredit > 0) updates.shopCredit = round2(credit - fromCredit);
  recordLedger(tx, {
    uid,
    type: entry.type,
    amount: -fromCash,
    cashAfter: cash - fromCash,
    ref: entry.ref,
    detail: fromCredit > 0 ? { ...(entry.detail || {}), credit: fromCredit } : entry.detail,
  });
  recordLedger(tx, {
    uid,
    type: entry.type,
    account: 'credit',
    amount: -fromCredit,
    cashAfter: credit - fromCredit,
    ref: entry.ref,
    detail: entry.detail,
  });
  return { updates, paid: { cash: fromCash, credit: fromCredit } };
};
