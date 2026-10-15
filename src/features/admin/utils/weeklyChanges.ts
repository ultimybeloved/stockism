// The admin's hand-made price changes for one week, read from the admin
// history (adjust_price entries), for the shareable Weekly changes card.
//
// A week ends when a chapter review ends (Thursday 21:00 UTC) and starts when
// the one before it ended, so a post made after the review covers the review
// plus every tweak since the last one. Only stocks the admin set by hand are
// listed, but each one's number includes the knock-on moves it took when a
// linked stock was adjusted, so it matches what the stock actually did.
import type { AdminLogEntry } from '../../../api/types';

const WEEK_MS = 7 * 86_400_000;

export interface Week {
  start: number;
  end: number;
}

/**
 * The week of the latest review that has started (back = 0), so on review day
 * it is the one in progress and right after it the one just finished. Each
 * step of `back` goes a week earlier; -1 is the week after it, in progress.
 */
export const weekWindow = (back = 0, now = Date.now()): Week => {
  const d = new Date(now);
  const review = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 13));
  review.setUTCDate(review.getUTCDate() - ((review.getUTCDay() - 4 + 7) % 7));
  if (review.getTime() > now) review.setUTCDate(review.getUTCDate() - 7);
  const end = review.getTime() + 8 * 3_600_000 - back * WEEK_MS;
  return { start: end - WEEK_MS, end };
};

export interface WeeklyChange {
  ticker: string;
  from: number;
  to: number;
  /** Every admin-caused move compounded (own edits plus knock-on), so trading between them doesn't count. */
  percent: number;
  /** The admin's own edits alone. */
  directPercent: number;
  edits: number;
}

type Side = { ticker?: unknown; price?: unknown };
type Move = { ticker?: unknown; from?: unknown; to?: unknown };

/** Fold the week's adjust_price entries into one change per hand-set stock, biggest first. */
export const summarizeWeek = (entries: AdminLogEntry[], { start, end }: Week): WeeklyChange[] => {
  const adjustments = entries
    .filter((e) => e.action === 'adjust_price' && e.at != null && e.at > start && e.at <= end)
    .sort((x, y) => (x.at as number) - (y.at as number));

  // Each adjustment's own move first, then the linked stocks it dragged.
  const moves = adjustments.flatMap((e) => {
    const b = (e.before || {}) as Side;
    const a = (e.after || {}) as Side;
    const trailing = (Array.isArray(e.detail?.trailing) ? e.detail.trailing : []) as Move[];
    return [
      { ticker: String(a.ticker || b.ticker || ''), from: Number(b.price), to: Number(a.price), direct: true },
      ...trailing.map((m) => ({
        ticker: String(m.ticker || ''),
        from: Number(m.from),
        to: Number(m.to),
        direct: false,
      })),
    ].filter((m) => m.ticker && m.from > 0 && m.to > 0);
  });
  const handSet = new Set(moves.filter((m) => m.direct).map((m) => m.ticker));

  type Row = { ticker: string; from: number; to: number; edits: number; total: number; own: number };
  const byTicker = new Map<string, Row>();
  for (const m of moves) {
    if (!handSet.has(m.ticker)) continue;
    const row = byTicker.get(m.ticker) || { ticker: m.ticker, from: m.from, to: m.from, edits: 0, total: 1, own: 1 };
    row.total *= m.to / m.from;
    if (m.direct) {
      row.own *= m.to / m.from;
      row.edits += 1;
    }
    row.to = m.to;
    byTicker.set(m.ticker, row);
  }

  return [...byTicker.values()]
    .map(({ total, own, ...row }) => ({ ...row, percent: (total - 1) * 100, directPercent: (own - 1) * 100 }))
    .filter((row) => Math.abs(row.percent) >= 0.005)
    .sort((a, b) => Math.abs(b.percent) - Math.abs(a.percent));
};

const day = (ms: number) =>
  new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });

/** "Oct 8 to Oct 15, 2026". */
export const weekLabel = ({ start, end }: Week) => `${day(start)} to ${day(end)}, ${new Date(end).getUTCFullYear()}`;

const price = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

/** A Reddit-ready markdown post body: one table, risers first. */
export const toRedditMarkdown = (rows: WeeklyChange[], week: Week, names: Record<string, string>) => {
  const sorted = [...rows].sort((a, b) => b.percent - a.percent);
  return [
    `**Stockism price changes, ${weekLabel(week)}**`,
    '',
    '| Stock | Ticker | Before | After | Change |',
    '|:--|:--|--:|--:|--:|',
    ...sorted.map(
      (r) =>
        `| ${names[r.ticker] || r.ticker} | $${r.ticker} | ${price(r.from)} | ${price(r.to)} | ${signed(r.percent)} |`,
    ),
    '',
    `${rows.filter((r) => r.percent > 0).length} up, ${rows.filter((r) => r.percent < 0).length} down. Trade at https://stockism.app`,
  ].join('\n');
};
