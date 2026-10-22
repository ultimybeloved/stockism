import { useEffect, useMemo, useRef, useState } from 'react';
import { useMarket } from '../../../context/AppContext';
import { CHARACTER_MAP } from '../../../characters';

export type ActivitySide = 'buy' | 'sell';

export interface ActivityEntry {
  /** Unique per row, so React keys stay stable while counts change. */
  id: string;
  ticker: string;
  side: ActivitySide;
  /** When the trade happened (ms). Shown only roughly. */
  at: number;
  /** Back-to-back entries for the same stock and side fold into one row. */
  count: number;
  /** Changes on every fold, so the counter can replay its bump. */
  bump: number;
}

const KEEP = 30;
const HOUR = 60 * 60 * 1000;
// How far behind real time the feed runs.
export const ACTIVITY_DELAY_MS = 20 * 60 * 1000;

/** Fold a new entry onto the list: same stock and side as the top row adds to its count. */
export function addEntry(list: ActivityEntry[], next: Omit<ActivityEntry, 'count' | 'bump'>): ActivityEntry[] {
  const top = list[0];
  if (top && top.ticker === next.ticker && top.side === next.side) {
    return [{ ...top, at: next.at, count: top.count + 1, bump: top.bump + 1 }, ...list.slice(1)];
  }
  return [{ ...next, count: 1, bump: 0 }, ...list].slice(0, KEEP);
}

/**
 * MOCKUP SOURCE. Makes up entries on a hold-then-tick rhythm so the design can
 * be judged in motion. The real feed will read one public doc the bot round
 * writes, holding only ticker, side and a rough time.
 */
function useMockStream(onEntry: (e: Omit<ActivityEntry, 'count' | 'bump'>) => void, only?: string) {
  const { prices } = useMarket();
  // Joined so price ticks don't restart the stream.
  const roster =
    only ||
    Object.keys(prices)
      .filter((t) => CHARACTER_MAP[t])
      .sort()
      .join(',');
  const seq = useRef(0);
  const cb = useRef(onEntry);
  cb.current = onEntry;

  useEffect(() => {
    const tickers = roster ? roster.split(',') : [];
    if (!tickers.length) return;
    let hot = tickers[0]!;
    let timer: ReturnType<typeof setTimeout>;
    const pick = () => tickers[Math.floor(Math.random() * tickers.length)]!;
    const fire = () => {
      // Now and then a stock gets a run of trades, which is what stacking is for.
      if (Math.random() < 0.15) hot = pick();
      const ticker = Math.random() < 0.35 ? hot : pick();
      const side: ActivitySide = Math.random() < 0.56 ? 'buy' : 'sell';
      cb.current({ id: `m${seq.current++}`, ticker, side, at: Date.now() - ACTIVITY_DELAY_MS });
      timer = setTimeout(fire, (only ? 5000 : 1600) + Math.random() * (only ? 9000 : 4200));
    };
    // Start with a short backlog so the panel isn't empty on load.
    for (let i = 0; i < 8; i++) {
      const ticker = pick();
      cb.current({
        id: `m${seq.current++}`,
        ticker,
        side: Math.random() < 0.5 ? 'buy' : 'sell',
        at: Date.now() - ACTIVITY_DELAY_MS - (8 - i) * 2 * 60 * 1000,
      });
    }
    timer = setTimeout(fire, 1200);
    return () => clearTimeout(timer);
  }, [roster, only]);
}

/** The market activity feed: nameless, sizeless, delayed buys and sells. Pass a ticker for one stock. */
export function useMarketActivity(ticker?: string) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  useMockStream((e) => setEntries((list) => addEntry(list, e)), ticker);

  const lastHour = useMemo(() => {
    const since = Date.now() - ACTIVITY_DELAY_MS - HOUR;
    let buys = 0;
    let sells = 0;
    for (const e of entries) {
      if (e.at < since) continue;
      if (e.side === 'buy') buys += e.count;
      else sells += e.count;
    }
    return { buys, sells };
  }, [entries]);

  return { entries, lastHour };
}
