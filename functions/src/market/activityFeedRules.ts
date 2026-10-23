// Pure helpers for the Recent trades card. The job is activityFeed.ts.
import { TRADE_RECORD_ACTIONS } from '../shared/constants';

export interface ActivityItem {
  /** Ticker. */
  t: string;
  /** 'b' buy or 's' sell. A short reads as a sell and a cover as a buy. */
  s: 'b' | 's';
  /** Trade time in ms (bot entries: a random time in the window). */
  at: number;
}

// The window closes this far back, so the doc never holds the last few minutes.
export const ACTIVITY_LAG_MS = 5 * 60 * 1000;
// A gap longer than this (halt, outage) starts fresh instead of reading it all.
export const MAX_WINDOW_MS = 2 * 60 * 60 * 1000;
export const PER_RUN = 60;
export const JITTER_MS = 2 * 60 * 1000;
const KEEP = 150;

export const sideOf = (action: string): 'b' | 's' | null =>
  !TRADE_RECORD_ACTIONS.has(action) ? null : action === 'buy' || action === 'cover' ? 'b' : 's';

/** Keep at most n, evenly spread, in time order. */
export function thin<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]!);
}

/** Bot moves as entries at random times inside (from, to]: one or two per move. */
export function botItems(
  moves: { ticker: string; frac: number }[],
  from: number,
  to: number,
  rng = Math.random,
): ActivityItem[] {
  const out: ActivityItem[] = [];
  for (const m of moves) {
    const n = rng() < 0.35 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      out.push({ t: m.ticker, s: m.frac >= 0 ? 'b' : 's', at: Math.round(from + 1 + rng() * (to - from - 1)) });
    }
  }
  return out;
}

/** New entries onto the old list: time order, newest KEEP. */
export function mergeItems(old: ActivityItem[], add: ActivityItem[]): ActivityItem[] {
  return [...old, ...add].sort((a, b) => a.at - b.at).slice(-KEEP);
}
