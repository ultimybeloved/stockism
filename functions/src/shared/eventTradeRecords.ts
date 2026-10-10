// History of long-term (event) market activity, one record per buy, sell,
// payout, cancellation refund, or position lost to an account deletion.
//
// A market only stores its running share counts (q), so before this existed
// there was no way to tell who moved a market, or why q held 446k Yes shares
// that no current player owned. Every record carries q after the change, so
// the history can be replayed and reconciled against holdings at any point.
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import { lmsrPrices } from './lmsr';

export type EventTradeAction = 'buy' | 'sell' | 'payout' | 'refund' | 'deleted';

export interface EventTradeInput {
  uid: string;
  displayName?: string | null;
  marketId: string;
  // 'all' on a refund: a cancelled market refunds the whole position at cost.
  outcome: string;
  action: EventTradeAction;
  shares: number;
  // Cash that moved: cost of a buy, refund of a sell, payout, cancellation
  // refund. 0 for 'deleted'.
  cash: number;
  qBefore?: number[] | null;
  qAfter?: number[] | null;
  b?: number | null;
  cashAfter?: number | null;
  ip?: string | null;
}

export const eventTradesCol = () => admin.firestore().collection('eventTrades');

const roundPrices = (q: number[] | null | undefined, b: number | null | undefined) =>
  q && q.length && b ? lmsrPrices(q, b).map((p) => Math.round(p * 10000) / 10000) : null;

export const buildEventTradeRecord = (input: EventTradeInput): Record<string, unknown> => {
  const record: Record<string, unknown> = {
    uid: input.uid,
    displayName: input.displayName ?? null,
    marketId: input.marketId,
    outcome: input.outcome,
    action: input.action,
    shares: input.shares,
    cash: input.cash,
    timestamp: FieldValue.serverTimestamp(),
  };
  if (input.qBefore) record.qBefore = input.qBefore;
  if (input.qAfter) record.qAfter = input.qAfter;
  const pricesBefore = roundPrices(input.qBefore, input.b);
  const pricesAfter = roundPrices(input.qAfter, input.b);
  if (pricesBefore) record.pricesBefore = pricesBefore;
  if (pricesAfter) record.pricesAfter = pricesAfter;
  if (input.cashAfter != null) record.cashAfter = input.cashAfter;
  if (input.ip) record.ip = input.ip;
  return record;
};

// Writes one record inside the caller's transaction, so a trade and its
// record can never disagree.
export const recordEventTrade = (tx: admin.firestore.Transaction, input: EventTradeInput) => {
  tx.set(eventTradesCol().doc(), buildEventTradeRecord(input));
};
