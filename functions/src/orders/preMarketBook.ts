// Totals of the pre-market queue, per ticker, for the indicative opening price.
//
// The order docs themselves are private (owner + admin only): before 2026-10-13
// every signed-in player could read them, user IDs included, so anyone could
// see who had queued what. The opening-price preview only ever needed the
// totals, so the queue keeps this one public summary doc instead.
//
// market/preMarketBook = { session: 'YYYY-MM-DD', tickers: { T: { buy, sell, orders } } }
// A doc from an older session is treated as empty, so nothing has to reset it.
// Every writer must read the doc and write it in the same transaction as the
// order change it reflects.

import * as admin from 'firebase-admin';
import type { Timestamp } from 'firebase-admin/firestore';

const db = admin.firestore();

export const preMarketBookRef = () => db.collection('market').doc('preMarketBook');

export interface BookSide {
  buy: number;
  sell: number;
  orders: number;
}
export interface PreMarketBook {
  session: string;
  tickers: Record<string, BookSide>;
}
export interface BookChange {
  ticker: string;
  action: 'buy' | 'sell';
  shares: number;
  /** +1 when an order joins the queue, -1 when it leaves. */
  sign: 1 | -1;
  /** The session the order belongs to (its UTC creation date). */
  session: string;
}

export const sessionDateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** The UTC date an order was queued on; its session. */
export const orderSession = (createdAt: Timestamp | null | undefined, fallbackMs = Date.now()) =>
  sessionDateOf(createdAt?.toMillis?.() ?? fallbackMs);

const round6 = (n: number) => Math.round(n * 1e6) / 1e6;

// Pure: the book after `changes`. Changes for any session but `session` are
// ignored (an old order leaving doesn't touch today's totals).
export function applyBookChanges(
  current: Partial<PreMarketBook> | undefined,
  session: string,
  changes: BookChange[],
): PreMarketBook {
  const tickers: Record<string, BookSide> = current?.session === session ? { ...(current.tickers || {}) } : {};
  for (const c of changes) {
    if (c.session !== session) continue;
    const side = { buy: 0, sell: 0, orders: 0, ...(tickers[c.ticker] || {}) };
    side[c.action] = Math.max(0, round6(side[c.action] + c.sign * c.shares));
    side.orders = Math.max(0, side.orders + c.sign);
    tickers[c.ticker] = side;
  }
  return { session, tickers };
}

/** Reads the book inside `tx` and returns a writer for the changed book. */
export async function readBook(tx: admin.firestore.Transaction) {
  const snap = await tx.get(preMarketBookRef());
  const current = snap.exists ? (snap.data() as PreMarketBook) : undefined;
  return (changes: BookChange[], now = Date.now()) => {
    if (changes.length === 0) return;
    tx.set(preMarketBookRef(), applyBookChanges(current, sessionDateOf(now), changes));
  };
}
