import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  isWeeklyHalt,
  isPreMarketWindow,
  isMarketOpenGracePeriod,
  isPreMarketLockout,
  getMostRecentHaltWindow,
  getReviewChanges,
  mergeReviewChanges,
  buildReviewSections,
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
  const during = Date.parse('2026-01-01T22:00:00Z');
  const before = (price) => ({ timestamp: start - 60 * 60 * 1000, price });
  const inside = (mins, price, source) => ({ timestamp: start + mins * 60 * 1000, price, source });

  const run = (points, ticker = 'JAKE') => {
    vi.useFakeTimers();
    at(new Date(during).toISOString());
    return getReviewChanges({ [ticker]: points }, [{ ticker }])[ticker];
  };

  it('reports a hand-set adjustment as a direct change', () => {
    const c = run([before(100), inside(30, 120, 'admin_adjust')]);
    expect(c.oldPrice).toBe(100);
    expect(c.newPrice).toBe(120);
    expect(c.percentChange).toBeCloseTo(20);
    expect(c.directChange).toBeCloseTo(20);
    expect(c.trailingChange).toBeCloseTo(0);
  });

  it('ignores tickers the review never moved', () => {
    vi.useFakeTimers();
    at(new Date(during).toISOString());
    const history = { JAKE: [before(100), inside(30, 120)] }; // untagged, not a review move
    expect(getReviewChanges(history, [{ ticker: 'JAKE' }])).toEqual({});
  });

  it('hides the review once it is more than 7 days old', () => {
    vi.useFakeTimers();
    at('2026-01-10T00:00:00Z'); // >7 days after the 2026-01-01 halt
    const history = { JAKE: [before(100), inside(30, 120, 'admin_adjust')] };
    expect(getReviewChanges(history, [{ ticker: 'JAKE' }])).toEqual({});
  });

  it('counts a knock-on move after the adjustment, and keeps it separate', () => {
    const c = run([before(100), inside(30, 120, 'admin_adjust'), inside(45, 126, 'trailing')]);
    expect(c.newPrice).toBe(126);
    expect(c.percentChange).toBeCloseTo(26);
    expect(c.directChange).toBeCloseTo(20);
    expect(c.trailingChange).toBeCloseTo(5);
  });

  it('counts a knock-on move BEFORE the adjustment too', () => {
    // The $GAP case: dragged up by linked stocks, then adjusted by hand on top.
    const c = run([before(100), inside(10, 104, 'trailing'), inside(20, 109.2, 'admin_adjust')]);
    expect(c.oldPrice).toBe(100);
    expect(c.percentChange).toBeCloseTo(9.2);
    expect(c.trailingChange).toBeCloseTo(4);
    expect(c.directChange).toBeCloseTo(5);
  });

  it('reports a stock that ONLY moved by knock-on', () => {
    const c = run([before(80), inside(30, 84, 'trailing')], 'YAMA');
    expect(c.percentChange).toBeCloseTo(5);
    expect(c.directChange).toBeCloseTo(0);
    expect(c.trailingChange).toBeCloseTo(5);
  });

  it('compounds repeated adjustments into one direct change', () => {
    const c = run([before(100), inside(10, 110, 'admin_adjust'), inside(20, 130, 'admin_adjust')]);
    expect(c.oldPrice).toBe(100);
    expect(c.newPrice).toBe(130);
    expect(c.directChange).toBeCloseTo(30);
  });

  it('ignores an adjustment from a previous week', () => {
    vi.useFakeTimers();
    at(new Date(during).toISOString());
    const history = {
      JAKE: [
        { timestamp: start - 7 * 24 * 60 * 60 * 1000, price: 100, source: 'admin_adjust' },
        before(115),
      ],
    };
    expect(getReviewChanges(history, [{ ticker: 'JAKE' }])).toEqual({});
  });

  it('skips a stock whose pre-review price is no longer in history', () => {
    // Doubles as the completeness gate: without the point it started from there
    // is nothing to measure against, and the stored server copy takes over.
    vi.useFakeTimers();
    at(new Date(during).toISOString());
    const history = { JAKE: [inside(30, 120, 'admin_adjust')] };
    expect(getReviewChanges(history, [{ ticker: 'JAKE' }])).toEqual({});
  });
});

describe('getReviewChanges — the real $GAP tape from 2026-08-20', () => {
  // The review that started this: $GAP was set +4.75% by hand but finished the
  // halt up 8.71%, because $JIN, $SHNG, $FIST and (via $SHNG) $YAMA all dragged
  // it. Players read the difference as trading during the halt. Every price here
  // is the live one. Must stay identical to getReviewWindowChanges in
  // functions/helpers.js, verified against the same tape.
  const t = (iso) => Date.parse(`2026-08-20T${iso}Z`);
  const history = {
    GAP: [
      { timestamp: t('11:40:23'), price: 1615.32 },
      { timestamp: t('17:32:08'), price: 1634.71, source: 'trailing' },
      { timestamp: t('18:12:36'), price: 1641.25, source: 'trailing' },
      { timestamp: t('18:19:13'), price: 1670.79, source: 'trailing' },
      { timestamp: t('18:20:11'), price: 1750.15, source: 'admin_adjust' },
      { timestamp: t('19:34:40'), price: 1755.48, source: 'trailing' },
      { timestamp: t('19:35:39'), price: 1755.95, source: 'trailing' },
    ],
  };

  it('splits the 8.71% into 4.75% set and 3.78% knock-on', () => {
    vi.useFakeTimers();
    at('2026-08-20T20:00:00Z'); // Thursday, inside the halt
    const c = getReviewChanges(history, [{ ticker: 'GAP' }]).GAP;
    expect(c.oldPrice).toBe(1615.32);
    expect(c.newPrice).toBe(1755.95);
    expect(c.percentChange).toBeCloseTo(8.71, 2);
    expect(c.directChange).toBeCloseTo(4.75, 2);
    expect(c.trailingChange).toBeCloseTo(3.78, 2);
  });

  it('has the two halves compound back to the total', () => {
    vi.useFakeTimers();
    at('2026-08-20T20:00:00Z');
    const c = getReviewChanges(history, [{ ticker: 'GAP' }]).GAP;
    const compounded = ((1 + c.directChange / 100) * (1 + c.trailingChange / 100) - 1) * 100;
    expect(compounded).toBeCloseTo(c.percentChange, 6);
  });
});

describe('mergeReviewChanges', () => {
  const local = { JAKE: { oldPrice: 100, newPrice: 130, percentChange: 30 } };
  const stored = { JAKE: { oldPrice: 100, newPrice: 110, percentChange: 10 } };

  it('lets the locally derived entry win, since it is complete and fresher', () => {
    expect(mergeReviewChanges(local, stored)).toEqual(local);
  });

  it('keeps a ticker only the stored copy knows about', () => {
    expect(mergeReviewChanges({}, stored)).toEqual(stored);
  });

  it('keeps a ticker only the local derivation knows about', () => {
    expect(mergeReviewChanges(local, {})).toEqual(local);
  });

  it('handles missing sources', () => {
    expect(mergeReviewChanges(null, null)).toEqual({});
    expect(mergeReviewChanges(undefined, undefined)).toEqual({});
  });

  it('does not mutate either input', () => {
    mergeReviewChanges(local, stored);
    expect(stored.JAKE.newPrice).toBe(110);
    expect(local.JAKE.newPrice).toBe(130);
  });
});

describe('buildReviewSections', () => {
  const chars = [
    { ticker: 'GAP' }, { ticker: 'JIN' }, { ticker: 'KTAE' },
    { ticker: 'FIST', isETF: true },
  ];
  const changes = {
    GAP: { percentChange: 8.71, directChange: 4.75, trailingChange: 3.78 },
    JIN: { percentChange: 4.97, directChange: 4.03, trailingChange: 0.9 },
    KTAE: { percentChange: 0.77, directChange: 0, trailingChange: 0.77 },
    FIST: { percentChange: 5.75, directChange: 5.75, trailingChange: 0 },
  };
  const byId = (sections) => Object.fromEntries(
    sections.map((s) => [s.id, s.characters.map((c) => c.ticker)]),
  );

  it('separates hand-set stocks, funds and knock-on-only stocks', () => {
    expect(byId(buildReviewSections(chars, changes))).toEqual({
      adjusted: ['GAP', 'JIN'],
      funds: ['FIST'],
      dragged: ['KTAE'],
    });
  });

  it('puts a directly adjusted fund in the fund section, not with the stocks', () => {
    const sections = buildReviewSections(chars, changes);
    expect(sections.find((s) => s.id === 'adjusted').characters).not.toContainEqual({ ticker: 'FIST', isETF: true });
  });

  it('drops empty sections', () => {
    const sections = buildReviewSections([{ ticker: 'GAP' }], { GAP: changes.GAP });
    expect(sections.map((s) => s.id)).toEqual(['adjusted']);
  });

  it('treats a stored entry with no split as hand-set', () => {
    // Nothing but admin adjustments made the list before the split existed.
    const sections = buildReviewSections([{ ticker: 'GAP' }], { GAP: { percentChange: 10 } });
    expect(sections[0].id).toBe('adjusted');
  });

  it('ignores characters the review never touched', () => {
    const sections = buildReviewSections([...chars, { ticker: 'DOO' }], changes);
    const all = sections.flatMap((s) => s.characters.map((c) => c.ticker));
    expect(all).not.toContain('DOO');
  });

  it('returns nothing when the review moved nothing', () => {
    expect(buildReviewSections(chars, {})).toEqual([]);
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
