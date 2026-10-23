// Pure helpers for the Recent trades card, kept apart from the Firestore hook.

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
