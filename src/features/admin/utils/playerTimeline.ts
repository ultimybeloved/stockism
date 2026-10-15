// One player's history as a single list, newest first: money moves, trades,
// long-term market trades, gifts, admin actions, notes and bell messages.
// Trades already book a ledger entry, so trade_* ledger lines are left out to
// avoid listing every trade twice.
import { ledgerTypeInfo } from '../../../rules/ledgerFlow';
import { ms, money, signedMoney } from './termFormat';
import type { PlayerFileResponse, Row } from '../../../api/adminPanelTypes';

export type TimelineKind = 'money' | 'trade' | 'market' | 'gift' | 'admin' | 'note' | 'bell';

export interface TimelineItem {
  at: number;
  kind: TimelineKind;
  text: string;
  amount?: number;
}

const s = (v: unknown) => (v == null ? '' : String(v));
const n = (v: unknown) => Number(v) || 0;

export function buildTimeline(file: PlayerFileResponse): TimelineItem[] {
  const out: TimelineItem[] = [];
  const push = (row: Row | Record<string, unknown>, field: string, item: Omit<TimelineItem, 'at'>) => {
    const at = ms(row[field]);
    if (at) out.push({ at, ...item });
  };

  for (const e of file.ledger) {
    const type = s(e.type);
    if (type.startsWith('trade_') || type.startsWith('event_')) continue;
    const account = s(e.account) || 'cash';
    push(e, 'timestamp', {
      kind: 'money',
      text: `${ledgerTypeInfo(type).label}${account !== 'cash' ? ` (${account})` : ''}${e.ref ? ` · ${s(e.ref)}` : ''}`,
      amount: n(e.amount),
    });
  }
  for (const tr of file.trades) {
    push(tr, 'timestamp', {
      kind: 'trade',
      text: `${s(tr.action).toUpperCase()} ${n(tr.amount)} $${s(tr.ticker)} at ${money(tr.price)}${tr.source ? ` (${s(tr.source)})` : ''}`,
      amount: n(tr.cashAfter) - n(tr.cashBefore) || undefined,
    });
  }
  for (const tr of file.eventTrades) {
    push(tr, 'timestamp', {
      kind: 'market',
      text: `Long-term market ${s(tr.action)}: ${n(tr.shares).toFixed(0)} "${s(tr.outcome)}"`,
      amount: s(tr.action) === 'buy' ? -n(tr.cash) : n(tr.cash),
    });
  }
  for (const g of file.giftsSent) {
    // The cash side is already a cosmetic_gift_sent money entry.
    push(g, 'at', { kind: 'gift', text: `Gave ${s(g.itemName)} to ${s(g.toName)} (${money(g.price)})` });
  }
  for (const g of file.giftsReceived) {
    push(g, 'at', { kind: 'gift', text: `Got ${s(g.itemName)} from ${s(g.fromName)}` });
  }
  for (const a of file.adminActions) {
    const detail = a.detail && typeof a.detail === 'object' ? (a.detail as Record<string, unknown>) : {};
    push(a, 'at', {
      kind: 'admin',
      text: `Admin: ${s(a.action).replace(/_/g, ' ')}${detail.memo ? ` (${s(detail.memo)})` : ''}`,
    });
  }
  for (const note of file.notes) {
    out.push({ at: note.at, kind: 'note', text: `Note: ${note.text}` });
  }
  for (const b of file.notifications) {
    push(b, 'createdAt', { kind: 'bell', text: `Bell: ${s(b.title)}` });
  }
  return out.sort((a, b) => b.at - a.at);
}

export const amountText = (v: number | undefined) => (v == null ? '' : signedMoney(v));
