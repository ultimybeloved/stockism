import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { CHARACTER_MAP } from '../../../characters';

export type ActivitySide = 'buy' | 'sell';

/** As stored on market/activity (functions/src/market/activityFeed.ts). */
export interface RawItem {
  t: string;
  s: 'b' | 's';
  at: number;
}

export interface ActivityEntry {
  /** Stable per row, so React keys hold while its count grows. */
  id: string;
  ticker: string;
  side: ActivitySide;
  /** Latest trade in the row (ms). Shown only roughly. */
  at: number;
  /** Back-to-back entries for the same stock and side fold into one row. */
  count: number;
}

// Each entry shows once it is this old. The bot round writes every 15
// minutes, so entries come out one by one between writes.
export const ACTIVITY_REVEAL_MS = 20 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

/** Fold time-ordered entries into rows, newest first. */
export function foldEntries(items: RawItem[]): ActivityEntry[] {
  const rows: ActivityEntry[] = [];
  for (const x of items) {
    const side: ActivitySide = x.s === 'b' ? 'buy' : 'sell';
    const top = rows[rows.length - 1];
    if (top && top.ticker === x.t && top.side === side) {
      top.count++;
      top.at = x.at;
    } else {
      rows.push({ id: `${x.at}:${x.t}:${x.s}`, ticker: x.t, side, at: x.at, count: 1 });
    }
  }
  return rows.reverse();
}

/** Recent trades with no name and no size. Pass a ticker for one stock. */
export function useMarketActivity(ticker?: string) {
  const [raw, setRaw] = useState<RawItem[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'market', 'activity'),
        (snap) => setRaw(((snap.data()?.entries || []) as RawItem[]).filter((x) => CHARACTER_MAP[x.t])),
        () => {},
      ),
    [],
  );

  const mine = useMemo(() => (ticker ? raw.filter((x) => x.t === ticker) : raw), [raw, ticker]);

  // Wake up exactly when the next entry is due, so they land one at a time.
  useEffect(() => {
    const next = mine.find((x) => x.at + ACTIVITY_REVEAL_MS > now);
    if (!next) return;
    const t = setTimeout(() => setNow(Date.now()), Math.max(250, next.at + ACTIVITY_REVEAL_MS - Date.now()));
    return () => clearTimeout(t);
  }, [mine, now]);

  const visible = useMemo(() => mine.filter((x) => x.at + ACTIVITY_REVEAL_MS <= now), [mine, now]);
  const entries = useMemo(() => foldEntries(visible), [visible]);

  const lastHour = useMemo(() => {
    const since = now - ACTIVITY_REVEAL_MS - HOUR;
    let buys = 0;
    let sells = 0;
    for (const x of visible) {
      if (x.at < since) continue;
      if (x.s === 'b') buys++;
      else sells++;
    }
    return { buys, sells };
  }, [visible, now]);

  return { entries, lastHour };
}
