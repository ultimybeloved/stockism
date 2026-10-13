// Pure market-index math: the equal-weight index of all non-ETF characters
// (1000 = everyone at base price) and historical series reconstruction.
//
// The index is divided by a DIVISOR that the backend maintains and publishes on
// market/indexHistory. It exists so adding characters to the roster can't move
// the index on its own: a new character enters at about 1.0x base, which would
// drag a plain average down and make everyone look like they beat the market.
// See functions/src/shared/indexMaintenance.js — keep the value maths in sync.
//
// Every function here takes the divisor as an optional last argument and falls
// back to the plain average when it is missing. That fallback is exact until the
// first roster change after the divisor shipped, which is what makes it safe to
// render before the backend has published one.

import { CHARACTERS } from '../characters';
import { INDEX_BASE_VALUE } from '../constants/economy';
import type { Character } from '../characters';
import type { PriceMap } from '../types';

/** A chart point; Firestore may hand back a Timestamp instead of epoch ms. */
interface IndexHistoryPoint {
  price: number;
  timestamp?: number | { seconds?: number } | null;
}

type IndexHistory = Record<string, IndexHistoryPoint[]>;

/** One daily close the backend records on market/indexHistory. */
export interface RecordedIndexPoint {
  t: number;
  v: number;
}

const valueFrom = (sum: number, count: number, divisor: number | null | undefined): number => {
  if (divisor && divisor > 0) return sum / divisor;
  return count > 0 ? INDEX_BASE_VALUE * (sum / count) : INDEX_BASE_VALUE;
};

export const nonETFCharacters = CHARACTERS.filter((c) => !c.isETF);

export const TIME_RANGES = [
  { key: '1d', label: 'Today', hours: 24 },
  { key: '7d', label: '7 Days', hours: 168 },
  { key: '1m', label: '1 Month', hours: 720 },
  { key: '3m', label: '3 Months', hours: 2160 },
  { key: 'all', label: 'All Time', hours: Infinity },
];

export const getTimestamp = (entry: IndexHistoryPoint): number | null => {
  if (typeof entry.timestamp === 'number') return entry.timestamp;
  if (entry.timestamp?.seconds) return entry.timestamp.seconds * 1000;
  return null;
};

export const computeIndex = (
  prices: PriceMap | null | undefined,
  characters: Pick<Character, 'ticker' | 'basePrice'>[],
  divisor: number | null | undefined,
): number => {
  let sum = 0;
  let count = 0;
  for (const char of characters) {
    const price = prices?.[char.ticker];
    const base = char.basePrice;
    if (base > 0) {
      sum += (price != null ? price : base) / base;
      count++;
    }
  }
  return valueFrom(sum, count, divisor);
};

export const computeIndexAtTime = (
  priceHistory: IndexHistory | null | undefined,
  t: number,
  divisor: number | null | undefined,
): number => {
  let sum = 0;
  let count = 0;
  for (const char of nonETFCharacters) {
    const base = char.basePrice;
    if (base <= 0) continue;
    const history = priceHistory?.[char.ticker];
    if (!history || history.length === 0) {
      sum += 1;
      count++;
      continue;
    }
    // Before a stock's oldest kept point, its oldest known price is the best guess.
    // Base price is not: busy stocks only keep a couple of days of points, and
    // assuming base before that drew a fake jump into the chart.
    let nearest = history[0]!.price;
    for (let j = history.length - 1; j >= 0; j--) {
      const point = history[j]!;
      const ts = getTimestamp(point);
      if (ts != null && ts <= t) {
        nearest = point.price;
        break;
      }
    }
    sum += nearest / base;
    count++;
  }
  return valueFrom(sum, count, divisor);
};

// The live price history keeps only the last ~60 points per stock, so it can
// rebuild the index only back to when the busiest stock's points begin. Older
// than that, the chart uses the daily values the backend recorded.
const fullCoverageStart = (priceHistory: IndexHistory): number => {
  let latestFirst = 0;
  for (const char of nonETFCharacters) {
    const history = priceHistory[char.ticker];
    if (!history || history.length === 0) continue;
    const ts = getTimestamp(history[0]!);
    if (ts != null && ts > latestFirst) latestFirst = ts;
  }
  return latestFirst;
};

export const buildIndexSeries = (
  priceHistory: IndexHistory | null | undefined,
  currentIndex: number,
  hours: number,
  divisor: number | null | undefined,
  recorded: RecordedIndexPoint[] = [],
): { timestamp: number; price: number }[] => {
  if (!priceHistory || Object.keys(priceHistory).length === 0) return [];

  const now = Date.now();
  const cutoff = hours === Infinity ? 0 : now - hours * 60 * 60 * 1000;

  // Determine interval based on time range for ~100-150 points
  let interval: number;
  if (hours <= 24)
    interval = 30 * 60 * 1000; // 30 min
  else if (hours <= 168)
    interval = 2 * 60 * 60 * 1000; // 2 hours
  else if (hours <= 720)
    interval = 8 * 60 * 60 * 1000; // 8 hours
  else if (hours <= 2160)
    interval = 24 * 60 * 60 * 1000; // 1 day
  else interval = 24 * 60 * 60 * 1000; // 1 day

  // For "all time", find earliest data point
  let start = cutoff || now - 30 * 24 * 60 * 60 * 1000; // default 30 days back
  if (hours === Infinity) {
    for (const char of nonETFCharacters) {
      const history = priceHistory?.[char.ticker];
      if (history && history.length > 0) {
        const ts = getTimestamp(history[0]!);
        if (ts && ts < start) start = ts;
      }
    }
    if (recorded.length > 0 && recorded[0]!.t < start) start = recorded[0]!.t;
  } else {
    start = cutoff;
  }

  const points: { timestamp: number; price: number }[] = [];
  let rebuildFrom = start;
  if (recorded.length > 0) {
    const coverage = fullCoverageStart(priceHistory);
    for (const r of recorded) {
      if (r.t >= start && r.t < coverage) points.push({ timestamp: r.t, price: r.v });
    }
    if (coverage > start) rebuildFrom = coverage;
  }
  for (let t = rebuildFrom; t <= now; t += interval) {
    points.push({ timestamp: t, price: computeIndexAtTime(priceHistory, t, divisor) });
  }
  // Always include current
  points.push({ timestamp: now, price: currentIndex });
  return points;
};
