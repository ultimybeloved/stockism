// The money ledger: one record for every change to a player's cash.
//
// Before this, cash moved in ~30 places and only stock trades left a record,
// so a balance could not be traced back to where it came from. Every cash
// write now books an entry here, in the same transaction or batch as the
// write itself, so the ledger and the balance can never disagree.
// ledger.test.ts fails if a backend file writes cash without booking one.
//
// `account` is 'cash' unless set: 'ladder' entries track the separate ladder
// game balance (top-ups and plays), which never touches cash directly, and
// 'shares' entries record shares handed out or taken without a trade (daily
// drop, admin edits), valued at the market price in `amount`.
// `amount` is the signed change to that account. `cashAfter` is that account's balance after the
// change when the writer knows it (null for FieldValue.increment writes made
// without reading the balance first). `ref` points at what the money was for:
// a ticker, market, mission, order or record id.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { round2 } from './money';

export interface LedgerInput {
  uid: string;
  type: string;
  account?: 'cash' | 'ladder' | 'shares';
  amount: number;
  cashAfter?: number | null;
  ref?: string | null;
  // Small extra context worth keeping (who granted it, a memo id, a count).
  detail?: Record<string, unknown> | null;
}

type Writer = Pick<admin.firestore.Transaction, 'set'> | Pick<admin.firestore.WriteBatch, 'set'>;

export const ledgerCol = () => admin.firestore().collection('ledger');

export const buildLedgerEntry = (input: LedgerInput): Record<string, unknown> => {
  const entry: Record<string, unknown> = {
    uid: input.uid,
    type: input.type,
    account: input.account || 'cash',
    amount: round2(input.amount),
    timestamp: FieldValue.serverTimestamp(),
  };
  if (input.cashAfter != null) entry.cashAfter = round2(input.cashAfter);
  if (input.ref) entry.ref = input.ref;
  if (input.detail) entry.detail = input.detail;
  return entry;
};

// Books one entry through the caller's transaction or batch. A zero change is
// skipped: nothing moved, so there is nothing to trace.
export const recordLedger = (writer: Writer, input: LedgerInput) => {
  if (!Number.isFinite(input.amount) || round2(input.amount) === 0) return;
  (writer as admin.firestore.WriteBatch).set(ledgerCol().doc(), buildLedgerEntry(input));
};

// For the few writers that update cash with a plain doc write, outside any
// transaction or batch.
export const addLedgerEntry = async (input: LedgerInput) => {
  if (!Number.isFinite(input.amount) || round2(input.amount) === 0) return;
  await ledgerCol().add(buildLedgerEntry(input));
};
