// What moved prices during a Thursday chapter-review halt. Pure, so it is
// tested on its own; haltAudit.ts reads the data and reports.
//
// Nothing should move a price during a halt. Everything that legitimately
// writes inside the window (admin adjustments, their trailing knock-on, the
// 20:56 opening auction and its stop-loss sweep) tags its price-history point
// with a `source`. An UNTAGGED point inside the window is therefore the signal:
// something moved a price during the halt without checking the halt.
import { WEEKLY_HALT_START_MINUTE, WEEKLY_HALT_END_MINUTE } from '../shared/constants';
import type { PricePoint } from '../shared/types';

type History = Record<string, unknown>;

export interface HaltAudit {
  start: number;
  end: number;
  total: number;
  bySource: Record<string, number>;
  /** Untagged points, grouped by the timestamp they share (one write = one batch). */
  untagged: { at: number; tickers: string[] }[];
}

/** The halt window (13:00 to 21:00 UTC) on the UTC day of `day`. */
export const haltWindowOn = (day: number) => {
  const d = new Date(day);
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { start: dayStart + WEEKLY_HALT_START_MINUTE * 60000, end: dayStart + WEEKLY_HALT_END_MINUTE * 60000 };
};

/**
 * Buckets every price point inside [start, end] by source. The 20:54 collapse
 * folds the review's own points into one `collapsed` point and stashes the
 * detail in market/reviewDetail, so the stash is stitched back in when it
 * belongs to this window, or a tidied week would look emptier than it was.
 */
export const auditHaltWindow = (
  live: History,
  stash: { windowEnd?: number; detail?: History } | null | undefined,
  start: number,
  end: number,
): HaltAudit => {
  const history: History = { ...live };
  if (stash && stash.windowEnd === end) {
    for (const [ticker, points] of Object.entries(stash.detail || {})) {
      if (!Array.isArray(points)) continue;
      const kept = Array.isArray(history[ticker]) ? (history[ticker] as PricePoint[]).filter((p) => !p?.collapsed) : [];
      history[ticker] = [...kept, ...points];
    }
  }

  const bySource: Record<string, number> = {};
  const batches = new Map<number, string[]>();
  let total = 0;
  for (const [ticker, points] of Object.entries(history)) {
    if (!Array.isArray(points)) continue;
    for (const p of points as PricePoint[]) {
      if (!p || !(p.timestamp >= start && p.timestamp <= end)) continue;
      total++;
      const key = p.source === undefined ? 'UNTAGGED' : String(p.source);
      bySource[key] = (bySource[key] || 0) + 1;
      if (key === 'UNTAGGED') {
        const list = batches.get(p.timestamp) || [];
        list.push(ticker);
        batches.set(p.timestamp, list);
      }
    }
  }
  const untagged = [...batches.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([at, tickers]) => ({ at, tickers: tickers.sort() }));
  return { start, end, total, bySource, untagged };
};
