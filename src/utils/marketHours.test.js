import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isWeeklyHalt,
  isPreMarketWindow,
  isMarketOpenGracePeriod,
  isPreMarketLockout,
  getMostRecentHaltWindow,
  getReviewChanges,
  formatCountdown,
} from './marketHours';

// 2026-01-01 is a Thursday (the weekly halt day). 2026-01-02 is a Friday.
const at = (iso) => vi.setSystemTime(new Date(iso));

afterEach(() => {
  vi.useRealTimers();
});

describe('isWeeklyHalt (Thursday 13:00–21:00 UTC)', () => {
  it('is true inside the window on Thursday', () => {
    vi.useFakeTimers();
    at('2026-01-01T14:00:00Z');
    expect(isWeeklyHalt()).toBe(true);
  });

  it('is false just before the window opens', () => {
    vi.useFakeTimers();
    at('2026-01-01T12:59:00Z');
    expect(isWeeklyHalt()).toBe(false);
  });

  it('is false exactly at reopen (21:00)', () => {
    vi.useFakeTimers();
    at('2026-01-01T21:00:00Z');
    expect(isWeeklyHalt()).toBe(false);
  });

  it('is true one minute before reopen', () => {
    vi.useFakeTimers();
    at('2026-01-01T20:59:00Z');
    expect(isWeeklyHalt()).toBe(true);
  });

  it('is false on a non-Thursday even inside the time window', () => {
    vi.useFakeTimers();
    at('2026-01-02T14:00:00Z'); // Friday
    expect(isWeeklyHalt()).toBe(false);
  });
});

describe('pre-market and grace windows', () => {
  it('pre-market window is 20:30–21:00 UTC Thursday', () => {
    vi.useFakeTimers();
    at('2026-01-01T20:45:00Z');
    expect(isPreMarketWindow()).toBe(true);
    at('2026-01-01T20:15:00Z');
    expect(isPreMarketWindow()).toBe(false);
  });

  it('lockout is the final 5 minutes (20:55–21:00)', () => {
    vi.useFakeTimers();
    at('2026-01-01T20:57:00Z');
    expect(isPreMarketLockout()).toBe(true);
    at('2026-01-01T20:45:00Z');
    expect(isPreMarketLockout()).toBe(false);
  });

  it('grace period is the 30 minutes after reopen', () => {
    vi.useFakeTimers();
    at('2026-01-01T21:15:00Z');
    expect(isMarketOpenGracePeriod()).toBe(true);
    at('2026-01-01T21:45:00Z');
    expect(isMarketOpenGracePeriod()).toBe(false);
  });
});

describe('getMostRecentHaltWindow', () => {
  it('returns today 13:00–21:00 when called after a Thursday halt', () => {
    vi.useFakeTimers();
    at('2026-01-01T22:00:00Z');
    const { start, end } = getMostRecentHaltWindow();
    expect(new Date(start).toISOString()).toBe('2026-01-01T13:00:00.000Z');
    expect(new Date(end).toISOString()).toBe('2026-01-01T21:00:00.000Z');
  });
});

describe('getReviewChanges', () => {
  const start = Date.parse('2026-01-01T13:00:00Z');

  it('reports percent change for admin-adjusted tickers in the window', () => {
    vi.useFakeTimers();
    at('2026-01-01T22:00:00Z');
    const priceHistory = {
      JAKE: [
        { timestamp: start - 60 * 60 * 1000, price: 100 },                       // before halt
        { timestamp: start + 30 * 60 * 1000, price: 120, source: 'admin_adjust' }, // inside halt
      ],
    };
    const changes = getReviewChanges(priceHistory, [{ ticker: 'JAKE' }]);
    expect(changes.JAKE.oldPrice).toBe(100);
    expect(changes.JAKE.newPrice).toBe(120);
    expect(changes.JAKE.percentChange).toBeCloseTo(20);
  });

  it('ignores tickers with no admin adjustment in the window', () => {
    vi.useFakeTimers();
    at('2026-01-01T22:00:00Z');
    const priceHistory = {
      JAKE: [
        { timestamp: start - 60 * 60 * 1000, price: 100 },
        { timestamp: start + 30 * 60 * 1000, price: 120 }, // no admin_adjust source
      ],
    };
    expect(getReviewChanges(priceHistory, [{ ticker: 'JAKE' }])).toEqual({});
  });

  it('hides the review once it is more than 7 days old', () => {
    vi.useFakeTimers();
    at('2026-01-10T00:00:00Z'); // >7 days after the 2026-01-01 halt
    const priceHistory = {
      JAKE: [
        { timestamp: start - 60 * 60 * 1000, price: 100 },
        { timestamp: start + 30 * 60 * 1000, price: 120, source: 'admin_adjust' },
      ],
    };
    expect(getReviewChanges(priceHistory, [{ ticker: 'JAKE' }])).toEqual({});
  });

  it('excludes a trailing bump that lands after the admin adjustment', () => {
    vi.useFakeTimers();
    at('2026-01-01T22:00:00Z');
    const priceHistory = {
      JAKE: [
        { timestamp: start - 60 * 60 * 1000, price: 100 },
        { timestamp: start + 30 * 60 * 1000, price: 120, source: 'admin_adjust' },
        { timestamp: start + 45 * 60 * 1000, price: 126, source: 'trailing' }, // from another stock
      ],
    };
    const changes = getReviewChanges(priceHistory, [{ ticker: 'JAKE' }]);
    expect(changes.JAKE.newPrice).toBe(120); // not 126
    expect(changes.JAKE.percentChange).toBeCloseTo(20);
  });

  it('ignores tickers that only trailed', () => {
    vi.useFakeTimers();
    at('2026-01-01T22:00:00Z');
    const priceHistory = {
      YAMA: [
        { timestamp: start - 60 * 60 * 1000, price: 80 },
        { timestamp: start + 30 * 60 * 1000, price: 84, source: 'trailing' },
      ],
    };
    expect(getReviewChanges(priceHistory, [{ ticker: 'YAMA' }])).toEqual({});
  });

  it('spans from before the first adjustment to the last one', () => {
    vi.useFakeTimers();
    at('2026-01-01T22:00:00Z');
    const priceHistory = {
      JAKE: [
        { timestamp: start - 60 * 60 * 1000, price: 100 },
        { timestamp: start + 10 * 60 * 1000, price: 110, source: 'admin_adjust' },
        { timestamp: start + 20 * 60 * 1000, price: 130, source: 'admin_adjust' },
      ],
    };
    const changes = getReviewChanges(priceHistory, [{ ticker: 'JAKE' }]);
    expect(changes.JAKE.oldPrice).toBe(100);
    expect(changes.JAKE.newPrice).toBe(130);
    expect(changes.JAKE.percentChange).toBeCloseTo(30);
  });

  it('ignores an adjustment from a previous week', () => {
    vi.useFakeTimers();
    at('2026-01-01T22:00:00Z');
    const priceHistory = {
      JAKE: [
        { timestamp: start - 7 * 24 * 60 * 60 * 1000, price: 100, source: 'admin_adjust' },
        { timestamp: start - 60 * 60 * 1000, price: 115 },
      ],
    };
    expect(getReviewChanges(priceHistory, [{ ticker: 'JAKE' }])).toEqual({});
  });
});

describe('formatCountdown', () => {
  it('shows 0m at or below zero', () => {
    expect(formatCountdown(0)).toBe('0m');
  });

  it('shows hours and minutes', () => {
    expect(formatCountdown(2 * 60 * 60 * 1000 + 30 * 60 * 1000)).toBe('2h 30m');
  });

  it('shows only minutes under an hour', () => {
    expect(formatCountdown(45 * 60 * 1000)).toBe('45m');
  });
});
