import { describe, it, expect } from 'vitest';
import {
  DEFAULT_FILTERS, CREW_FILTER_ALL, matchesFilters, sortCharacters,
  activeFilterCount, buildCrewMembership,
} from './marketFilters';
import { GENERATION_FILTER_ALL, GENERATION_FILTER_UNASSIGNED } from '../constants/generations';

// Extracted from useMarketBrowser, so these lock in the behaviour that was
// already shipping as much as they cover the new status filter.

const ctx = (over = {}) => ({
  reviewChanges: {},
  crewMembership: {},
  watchlist: [],
  launchedTickers: [],
  ipoRestrictedTickers: [],
  ...over,
});

const f = (over = {}) => ({ ...DEFAULT_FILTERS, ...over });
const char = (over = {}) => ({ ticker: 'AAA', name: 'Test Person', dateAdded: '2026-01-01T00:00:00', ...over });

describe('tab filter', () => {
  it('shows characters and hides funds on the stocks tab', () => {
    expect(matchesFilters(char(), f(), ctx())).toBe(true);
    expect(matchesFilters(char({ isETF: true }), f(), ctx())).toBe(false);
  });

  it('inverts that on the ETFs tab', () => {
    expect(matchesFilters(char({ isETF: true }), f({ tab: 'etfs' }), ctx())).toBe(true);
    expect(matchesFilters(char(), f({ tab: 'etfs' }), ctx())).toBe(false);
  });

  it('shows only watchlisted tickers on the watchlist tab', () => {
    expect(matchesFilters(char(), f({ tab: 'watchlist' }), ctx({ watchlist: ['AAA'] }))).toBe(true);
    expect(matchesFilters(char(), f({ tab: 'watchlist' }), ctx({ watchlist: ['BBB'] }))).toBe(false);
  });

  it('shows only changed tickers on the review tab', () => {
    expect(matchesFilters(char(), f({ tab: 'review' }), ctx({ reviewChanges: { AAA: {} } }))).toBe(true);
    expect(matchesFilters(char(), f({ tab: 'review' }), ctx())).toBe(false);
  });
});

describe('IPO gating', () => {
  it('hides an IPO character that has not launched', () => {
    expect(matchesFilters(char({ ipoRequired: true }), f(), ctx())).toBe(false);
  });

  it('shows it once launched', () => {
    expect(matchesFilters(char({ ipoRequired: true }), f(), ctx({ launchedTickers: ['AAA'] }))).toBe(true);
  });

  it('hides a character currently mid-IPO', () => {
    expect(matchesFilters(char(), f(), ctx({ ipoRestrictedTickers: ['AAA'] }))).toBe(false);
  });
});

describe('generation filter', () => {
  it('matches the chosen generation', () => {
    expect(matchesFilters(char({ generation: 'pre' }), f({ generation: 'pre' }), ctx())).toBe(true);
    expect(matchesFilters(char({ generation: '1st' }), f({ generation: 'pre' }), ctx())).toBe(false);
  });

  it('finds characters with no generation under Unassigned', () => {
    expect(matchesFilters(char(), f({ generation: GENERATION_FILTER_UNASSIGNED }), ctx())).toBe(true);
    expect(matchesFilters(char({ generation: 'pre' }), f({ generation: GENERATION_FILTER_UNASSIGNED }), ctx())).toBe(false);
  });

  it('hides funds under any generation choice, since they have none', () => {
    const etf = char({ isETF: true });
    expect(matchesFilters(etf, f({ tab: 'etfs', generation: 'pre' }), ctx())).toBe(false);
    expect(matchesFilters(etf, f({ tab: 'etfs', generation: GENERATION_FILTER_UNASSIGNED }), ctx())).toBe(false);
    expect(matchesFilters(etf, f({ tab: 'etfs', generation: GENERATION_FILTER_ALL }), ctx())).toBe(true);
  });
});

describe('status filter', () => {
  it('shows everything by default', () => {
    expect(matchesFilters(char({ status: 'dead' }), f(), ctx())).toBe(true);
    expect(matchesFilters(char({ status: 'flashback' }), f(), ctx())).toBe(true);
    expect(matchesFilters(char(), f(), ctx())).toBe(true);
  });

  it('hides the dead when dead is switched off', () => {
    const filters = f({ statusHidden: ['dead'] });
    expect(matchesFilters(char({ status: 'dead' }), filters, ctx())).toBe(false);
    expect(matchesFilters(char({ status: 'flashback' }), filters, ctx())).toBe(true);
    expect(matchesFilters(char(), filters, ctx())).toBe(true);
  });

  it('treats a missing status as alive', () => {
    expect(matchesFilters(char(), f({ statusHidden: ['alive'] }), ctx())).toBe(false);
  });

  it('hides several states at once', () => {
    const filters = f({ statusHidden: ['dead', 'flashback'] });
    expect(matchesFilters(char({ status: 'dead' }), filters, ctx())).toBe(false);
    expect(matchesFilters(char({ status: 'flashback' }), filters, ctx())).toBe(false);
    expect(matchesFilters(char(), filters, ctx())).toBe(true);
  });

  it('never hides a fund, whose members may be any mix of states', () => {
    const etf = char({ isETF: true });
    expect(matchesFilters(etf, f({ tab: 'etfs', statusHidden: ['alive', 'dead'] }), ctx())).toBe(true);
  });
});

describe('search', () => {
  const c = char({ name: 'Takuma Arashimaya', ticker: 'YOKO', altNames: ['Buff Guy'] });
  it('matches on name, ticker and alt name, case insensitively', () => {
    expect(matchesFilters(c, f({ search: 'arashi' }), ctx())).toBe(true);
    expect(matchesFilters(c, f({ search: 'yoko' }), ctx())).toBe(true);
    expect(matchesFilters(c, f({ search: 'buff guy' }), ctx())).toBe(true);
  });
  it('rejects a non-match', () => {
    expect(matchesFilters(c, f({ search: 'zzzz' }), ctx())).toBe(false);
  });
});

describe('activeFilterCount', () => {
  it('is zero for a clean slate, so no Clear All button appears', () => {
    expect(activeFilterCount(f())).toBe(0);
  });
  it('does not count the search box, which is a separate act', () => {
    expect(activeFilterCount(f({ search: 'abc' }))).toBe(0);
  });
  it('counts crew, generation and each hidden status', () => {
    expect(activeFilterCount(f({ crew: 'YAMAZAKI' }))).toBe(1);
    expect(activeFilterCount(f({ crew: 'YAMAZAKI', generation: 'pre' }))).toBe(2);
    expect(activeFilterCount(f({ statusHidden: ['dead', 'flashback'] }))).toBe(2);
  });
});

describe('crew membership map', () => {
  it('is built from the real roster and lists a ticker under its crews', () => {
    const map = buildCrewMembership();
    // YOKO was renamed from BUFF and must still resolve to the Yamazaki crew.
    expect(map.YOKO).toContain('YAMAZAKI');
  });

  it('supports a character belonging to more than one crew', () => {
    const map = buildCrewMembership();
    const multi = Object.values(map).filter((crews) => crews.length > 1);
    expect(multi.length).toBeGreaterThan(0);
  });
});

describe('sorting', () => {
  const list = () => [
    char({ ticker: 'AAA', dateAdded: '2026-01-01T00:00:00' }),
    char({ ticker: 'BBB', dateAdded: '2026-06-01T00:00:00' }),
    char({ ticker: 'CCC', dateAdded: '2026-03-01T00:00:00' }),
  ];
  const sctx = (over = {}) => ({
    prices: { AAA: 10, BBB: 30, CCC: 20 },
    priceHistory: {},
    priceChanges: { AAA: 5, BBB: -2, CCC: 1 },
    reviewChanges: {},
    tab: 'stocks',
    ...over,
  });
  const tickers = (sorted) => sorted.map((c) => c.ticker);

  it('sorts by price in both directions', () => {
    expect(tickers(sortCharacters(list(), 'price-high', sctx()))).toEqual(['BBB', 'CCC', 'AAA']);
    expect(tickers(sortCharacters(list(), 'price-low', sctx()))).toEqual(['AAA', 'CCC', 'BBB']);
  });

  it('sorts gainers and losers by 24h change', () => {
    expect(tickers(sortCharacters(list(), 'change-high', sctx()))[0]).toBe('AAA');
    expect(tickers(sortCharacters(list(), 'change-low', sctx()))[0]).toBe('BBB');
  });

  it('sorts by ticker and by date added', () => {
    expect(tickers(sortCharacters(list(), 'ticker', sctx()))).toEqual(['AAA', 'BBB', 'CCC']);
    expect(tickers(sortCharacters(list(), 'newest', sctx()))).toEqual(['BBB', 'CCC', 'AAA']);
    expect(tickers(sortCharacters(list(), 'oldest', sctx()))).toEqual(['AAA', 'CCC', 'BBB']);
  });

  it('falls back to price outside the review tab, rather than silently doing nothing', () => {
    // review-change used to piggyback on price-high, which made picking
    // "Price: High" in the review tab do nothing at all.
    expect(tickers(sortCharacters(list(), 'review-change', sctx()))).toEqual(['BBB', 'CCC', 'AAA']);
  });

  it('honours the review sort inside the review tab', () => {
    const out = sortCharacters(list(), 'review-change', sctx({
      tab: 'review',
      reviewChanges: { AAA: { percentChange: 1 }, BBB: { percentChange: -9 }, CCC: { percentChange: 4 } },
    }));
    // Ranked by size of move regardless of direction.
    expect(tickers(out)).toEqual(['BBB', 'CCC', 'AAA']);
  });
});
