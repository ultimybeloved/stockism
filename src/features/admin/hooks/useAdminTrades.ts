import { useState } from 'react';
import {
  collection,
  documentId,
  getDocs,
  limitToLast,
  orderBy,
  query,
  where,
  Timestamp,
  type QueryConstraint,
} from 'firebase/firestore';
import { db } from '../../../firebase';
import type { AdminHookDeps } from '../utils/adminShared';
import {
  botLogToRows,
  ipoLedgerToRow,
  matchesFilters,
  tradeRecordToRow,
  type AdminTradeRow,
} from '../utils/adminTradeRows';

export type { AdminTradeRow } from '../utils/adminTradeRows';

/** Newest player fills fetched per load; keeps "All Time" from reading the whole collection. */
export const TRADE_LOAD_CAP = 3000;

const PERIOD_MS: Record<string, number> = {
  '24h': 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

// Display names for the players in the feed, 30 per read (the `in` limit).
async function loadNames(uids: string[]) {
  const names = new Map<string, string>();
  for (let i = 0; i < uids.length; i += 30) {
    const chunk = uids.slice(i, i + 30);
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)));
    snap.forEach((d) => names.set(d.id, (d.data().displayName as string) || 'Unknown'));
  }
  return names;
}

// Trades tab: every fill (manual, limit, stop loss, pre-market, IPO, forced
// margin closes, bots) with time/type/ticker/bot filters.
export function useAdminTrades({ showMessage }: Pick<AdminHookDeps, 'showMessage'>) {
  const [recentTrades, setRecentTrades] = useState<AdminTradeRow[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [tradesCapped, setTradesCapped] = useState(false);
  const [tradeFilterTicker, setTradeFilterTicker] = useState('');
  const [tradeTimePeriod, setTradeTimePeriod] = useState('24h'); // '24h', 'week', 'month', 'all'
  const [tradeTypeFilter, setTradeTypeFilter] = useState('all'); // 'all' or an AdminTradeType
  const [tradeBotFilter, setTradeBotFilter] = useState('real'); // 'real', 'bots', 'all'

  const loadRecentTrades = async (timePeriod = '24h', typeFilter = 'all', tickerFilter = '', botFilter = 'real') => {
    setTradesLoading(true);
    try {
      const cutoff = PERIOD_MS[timePeriod] ? Date.now() - PERIOD_MS[timePeriod] : 0;
      const ticker = tickerFilter.trim().toUpperCase();
      const rows: AdminTradeRow[] = [];
      let capped = false;

      if (botFilter !== 'bots') {
        // Ticker + time range uses the (ticker, timestamp) index; ordering
        // ascending and keeping the last N gives the newest N.
        const constraints: QueryConstraint[] = [];
        if (ticker) constraints.push(where('ticker', '==', ticker));
        if (cutoff) constraints.push(where('timestamp', '>=', Timestamp.fromMillis(cutoff)));
        constraints.push(orderBy('timestamp', 'asc'), limitToLast(TRADE_LOAD_CAP));
        const [tradeSnap, ipoSnap] = await Promise.all([
          getDocs(query(collection(db, 'trades'), ...constraints)),
          getDocs(query(collection(db, 'ledger'), where('type', '==', 'ipo_buy'))),
        ]);
        capped = tradeSnap.size >= TRADE_LOAD_CAP;

        const partial = [
          ...tradeSnap.docs.map((d) => tradeRecordToRow(d.id, d.data())),
          ...ipoSnap.docs.map((d) => ipoLedgerToRow(d.id, d.data())),
        ].filter((r): r is Omit<AdminTradeRow, 'userName' | 'isBot'> => r !== null);
        const kept = partial.filter((r) =>
          matchesFilters({ ...r, userName: '', isBot: false }, cutoff, typeFilter, ticker),
        );
        const names = await loadNames([...new Set(kept.map((r) => r.userId))]);
        for (const r of kept) {
          rows.push({ ...r, userName: names.get(r.userId) || 'Deleted account', isBot: false });
        }
      }

      if (botFilter !== 'real') {
        const botSnap = await getDocs(query(collection(db, 'users'), where('isBot', '==', true)));
        botSnap.forEach((d) => {
          const data = d.data();
          for (const r of botLogToRows(d.id, (data.displayName as string) || 'Bot', data.transactionLog || [])) {
            if (matchesFilters(r, cutoff, typeFilter, ticker)) rows.push(r);
          }
        });
      }

      rows.sort((a, b) => b.timestamp - a.timestamp);
      setRecentTrades(rows);
      setTradesCapped(capped);
      showMessage('success', `Found ${rows.length} trades`);
    } catch (err) {
      console.error('Failed to load trades:', err);
      showMessage('error', 'Failed to load trades');
    }
    setTradesLoading(false);
  };

  return {
    tradeTimePeriod,
    setTradeTimePeriod,
    tradeTypeFilter,
    setTradeTypeFilter,
    tradeFilterTicker,
    setTradeFilterTicker,
    tradeBotFilter,
    setTradeBotFilter,
    tradesLoading,
    tradesCapped,
    recentTrades,
    loadRecentTrades,
  };
}
