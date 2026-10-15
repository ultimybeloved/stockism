import { useEffect, useState } from 'react';
import { collection, getDocs, limit, limitToLast, orderBy, query, where } from 'firebase/firestore';
import * as Sentry from '@sentry/react';
import { db } from '../../../firebase';
import type { TradeRecord } from '../../../utils/tradeHistory';

/** A trades/{id} doc as the portfolio reads it. */
export interface PlayerTrade extends TradeRecord {
  id: string;
  source?: string;
}

const RECENT = 100;
const PER_STOCK = 40;

const read = (docs: { id: string; data: () => unknown }[]) =>
  docs.map((d) => ({ id: d.id, ...(d.data() as object) }) as PlayerTrade);

// The player's latest trades, newest first, loaded once per visit. Feeds the
// portfolio's activity list and recently closed positions.
export function useRecentTrades(uid: string | null | undefined) {
  const [trades, setTrades] = useState<PlayerTrade[]>([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    setLoading(true);
    getDocs(query(collection(db, 'trades'), where('uid', '==', uid), orderBy('timestamp', 'desc'), limit(RECENT)))
      .then((snap) => !cancelled && setTrades(read(snap.docs)))
      .catch((e) => Sentry.captureException(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uid]);
  return { trades, loading, limited: trades.length >= RECENT };
}

// Every trade the player made in one stock (the latest 40), oldest first.
export function useStockTrades(uid: string | null | undefined, ticker: string | null) {
  const [trades, setTrades] = useState<PlayerTrade[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    setTrades([]);
    if (!uid || !ticker) return;
    let cancelled = false;
    setLoading(true);
    getDocs(
      query(
        collection(db, 'trades'),
        where('uid', '==', uid),
        where('ticker', '==', ticker),
        orderBy('timestamp', 'asc'),
        limitToLast(PER_STOCK),
      ),
    )
      .then((snap) => !cancelled && setTrades(read(snap.docs)))
      .catch((e) => Sentry.captureException(e))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [uid, ticker]);
  return { trades, loading, limited: trades.length >= PER_STOCK };
}
