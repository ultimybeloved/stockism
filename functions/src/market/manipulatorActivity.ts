// What the admin-confirmed manipulators have been doing, for the bot guard and
// the stabilizer.
//
// INTERNAL MODULE: required by botTrader.ts, marketMaker.ts and the admin
// market-guard screen. It exports no Cloud Functions.
//
// The confirmed list lives in `botState/manipulators` (Cloud Functions only).
// Only the admin puts anyone on it: nothing here flags anyone automatically.
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { TRADE_RECORD_ACTIONS } from '../shared/constants';
import type { GroupTrade } from './botRules';

const db = admin.firestore();

export const manipulatorsRef = () => db.collection('botState').doc('manipulators');
export const storylinesRef = () => db.collection('botState').doc('storylines');

export interface ConfirmedEntry {
  name?: string;
  at?: number;
  by?: string;
}

export const loadConfirmed = async (): Promise<Record<string, ConfirmedEntry>> => {
  const snap = await manipulatorsRef().get();
  return (snap.data()?.uids || {}) as Record<string, ConfirmedEntry>;
};

const toMs = (v: unknown) =>
  v instanceof Timestamp ? v.toMillis() : typeof v === 'number' ? v : v instanceof Date ? v.getTime() : 0;

/** Every trade by these accounts since `sinceMs`, oldest first. */
export const loadGroupTrades = async (uids: string[], sinceMs: number, perAccount = 500): Promise<GroupTrade[]> => {
  const since = Timestamp.fromMillis(sinceMs);
  const snaps = await Promise.all(
    uids.map((uid) =>
      db
        .collection('trades')
        .where('uid', '==', uid)
        .where('timestamp', '>', since)
        .orderBy('timestamp', 'desc')
        .limit(perAccount)
        .get(),
    ),
  );
  const out: GroupTrade[] = [];
  for (const snap of snaps) {
    for (const d of snap.docs) {
      const t = d.data();
      if (!TRADE_RECORD_ACTIONS.has(t.action)) continue;
      out.push({
        uid: t.uid,
        ticker: t.ticker,
        action: t.action,
        amount: Number(t.amount) || 0,
        price: Number(t.price) || 0,
        ts: toMs(t.timestamp),
      });
    }
  }
  return out.sort((a, b) => a.ts - b.ts);
};

/** Shares held minus shares short, summed over the group, per stock. */
export const loadGroupExposure = async (uids: string[]): Promise<Record<string, number>> => {
  if (!uids.length) return {};
  const snaps = await db.getAll(...uids.map((u) => db.collection('users').doc(u)), {
    fieldMask: ['holdings', 'shorts'],
  });
  const out: Record<string, number> = {};
  for (const s of snaps) {
    const d = s.data() || {};
    for (const [t, h] of Object.entries(d.holdings || {})) {
      const n = typeof h === 'number' ? h : Number((h as { shares?: number })?.shares) || 0;
      if (n) out[t] = (out[t] || 0) + n;
    }
    for (const [t, sh] of Object.entries(d.shorts || {})) {
      const n = Number((sh as { shares?: number } | null)?.shares) || 0;
      if (n) out[t] = (out[t] || 0) - n;
    }
  }
  return out;
};

/**
 * Shares other players opened on one stock since `sinceMs` with the given
 * actions ('short' for a push down, 'buy' for a lift).
 */
export const loadOthersOpened = async (ticker: string, sinceMs: number, exclude: Set<string>, action: string) => {
  const snap = await db
    .collection('trades')
    .where('ticker', '==', ticker)
    .where('timestamp', '>', Timestamp.fromMillis(sinceMs))
    .orderBy('timestamp', 'desc')
    .limit(500)
    .get();
  let shares = 0;
  for (const d of snap.docs) {
    const t = d.data();
    if (t.action === action && !exclude.has(t.uid)) shares += Number(t.amount) || 0;
  }
  return shares;
};
