// Market-index maintenance: the equal-weight index of every non-ETF character,
// and the divisor that keeps it honest when the roster changes.
//
// INTERNAL MODULE — required by market/market.js and shared/marketData.js; never in a services.js.
//
// The index is sum(price / basePrice) across its constituents, divided by a
// divisor. At genesis every ratio is 1 and the divisor is picked so the index
// reads INDEX_BASE_VALUE.
//
// The divisor exists because the roster grows. A new character enters at roughly
// its base price, so it contributes a ratio of about 1.0. Drop that into an
// average currently sitting at 1.8 and the index falls. On a 150-character
// roster, ten additions move it about 3% with no price having changed at all,
// and every player looks like they beat the market that month. Season tiers are
// scored against this index, so that is not a cosmetic problem.
//
// When the constituent set changes, the divisor is rescaled by newSum / oldSum
// measured at the SAME prices. The index value is identical across the change,
// and only real price moves can move it afterwards. This is what a real index
// does when a company joins or leaves it.
//
// Mirror of the value maths in src/utils/marketIndex.ts — keep both in sync.

import { CHARACTERS } from './characters';
import { INDEX_BASE_VALUE } from './constants';

/** One index constituent: ticker and its basePrice when it joined. */
export interface Constituent {
  t: string;
  b: number;
}

/** What the daily job stores on market/indexHistory. */
export interface StoredIndex {
  divisor?: number;
  constituents?: Constituent[];
  [field: string]: unknown;
}

type Prices = Record<string, number | null | undefined> | null | undefined;

/**
 * Today's constituents. Each carries its own basePrice so the OLD sum stays
 * computable even for a character that has since left the roster entirely and
 * is no longer in CHARACTER_MAP.
 */
export const indexConstituents = (): Constituent[] =>
  CHARACTERS.filter((c) => !c.isETF && c.basePrice > 0).map((c) => ({ t: c.ticker, b: c.basePrice }));

/** A missing price reads as "at base" (ratio 1), same fallback the chart uses. */
export const sumRatios = (prices: Prices, constituents: (Constituent | null | undefined)[] | null | undefined) =>
  (constituents || []).reduce((sum: number, entry) => {
    const base = entry?.b;
    if (!entry || base === undefined || !(base > 0)) return sum;
    const price = prices?.[entry.t];
    return sum + (price != null ? price : base) / base;
  }, 0);

export const sameConstituents = (a: unknown, b: unknown) => {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  const seen = new Set((a as (Constituent | null)[]).map((x) => x?.t));
  return (b as (Constituent | null)[]).every((x) => seen.has(x?.t));
};

/**
 * The divisor to use now, given whatever was stored last time.
 */
export const reconcileDivisor = ({
  prices,
  constituents,
  stored,
  lastIndexValue,
}: {
  prices: Prices;
  constituents: Constituent[];
  stored: StoredIndex | null | undefined;
  lastIndexValue?: number | null;
}): { divisor: number; adjusted: boolean; reason: string } => {
  const currentSum = sumRatios(prices, constituents);
  const storedDivisor = stored?.divisor;
  const storedConstituents = stored?.constituents;

  // First run under the divisor model. Pick the divisor that reproduces the last
  // value already on the chart, so the series doesn't step on the day this ships.
  // (With the old count-based formula that works out to count / base value, so
  // the handover is exact rather than approximate.)
  if (
    storedDivisor === undefined ||
    !(storedDivisor > 0) ||
    !Array.isArray(storedConstituents) ||
    !storedConstituents.length
  ) {
    if (lastIndexValue != null && lastIndexValue > 0 && currentSum > 0) {
      return { divisor: currentSum / lastIndexValue, adjusted: true, reason: 'bootstrap-continuous' };
    }
    return {
      divisor: (constituents.length || 1) / INDEX_BASE_VALUE,
      adjusted: true,
      reason: 'bootstrap-genesis',
    };
  }

  if (sameConstituents(storedConstituents, constituents)) {
    return { divisor: storedDivisor, adjusted: false, reason: 'unchanged' };
  }

  const oldSum = sumRatios(prices, storedConstituents);
  // Nothing sensible to rescale by. Keep the old divisor rather than inventing a
  // jump; the next run retries once prices are readable again.
  if (!(oldSum > 0) || !(currentSum > 0)) {
    return { divisor: storedDivisor, adjusted: false, reason: 'degenerate-sum' };
  }

  return {
    divisor: storedDivisor * (currentSum / oldSum),
    adjusted: true,
    reason: 'roster-change',
  };
};

export const computeIndexValue = (prices: Prices, constituents: Constituent[], divisor: number) =>
  divisor > 0 ? sumRatios(prices, constituents) / divisor : INDEX_BASE_VALUE;

/**
 * The index at `prices`, using the constituent list and divisor the daily job
 * last stored on market/indexHistory. Before one has ever been stored, today's
 * roster and the count-based divisor stand in.
 */
export const indexFromStored = (prices: Prices, stored: StoredIndex | null | undefined) => {
  const constituents =
    stored && Array.isArray(stored.constituents) && stored.constituents.length
      ? stored.constituents
      : indexConstituents();
  const divisor =
    stored?.divisor !== undefined && stored.divisor > 0
      ? stored.divisor
      : (constituents.length || 1) / INDEX_BASE_VALUE;
  return computeIndexValue(prices, constituents, divisor);
};
