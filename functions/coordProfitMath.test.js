import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'offline-test' });

const { pushWindows, windowProfit, planRemoval } = require('./services/coordProfitMath');

const H = 3600000;
const T0 = Date.UTC(2026, 8, 17, 4, 0);
const tr = (action, shares, price, ts) => ({ action, shares, value: shares * price, ts });

describe('windowProfit', () => {
  it('matches the $SHNG raid as worked out by hand (Stitch)', () => {
    // Sold 4,125 at 1,948, shorted 400 + 500, covered 900, bought 1,000 back at 1,585.
    const trades = [
      tr('sell', 4125, 1948.23, T0 + 4 * 60000),
      tr('short', 400, 1592.48, T0 + 24 * 60000),
      tr('short', 500, 1390.91, T0 + 21 * H),
      tr('cover', 900, 1481.62, T0 + 23 * H),
      tr('buy', 1000, 1584.77, T0 + 24 * H),
    ];
    const p = windowProfit(trades, { start: T0, end: T0 + 48 * H }, 2190.92);
    // 1,000 x (1,948.23 - 1,584.77) + ~0 on the shorts.
    expect(p.lockedIn).toBeGreaterThan(362000);
    expect(p.lockedIn).toBeLessThan(364000);
    // Sold more than he bought back: nothing left over to gain on.
    expect(p.gainSince).toBe(0);
  });

  it('counts shares bought beyond what was sold as gain since (Callmebot)', () => {
    const trades = [tr('short', 400, 1631.64, T0 + 24 * 60000), tr('cover', 400, 1472.72, T0 + 23 * H), tr('buy', 1000, 1683.23, T0 + 24 * H)];
    const p = windowProfit(trades, { start: T0, end: T0 + 48 * H }, 2190.92);
    expect(Math.round(p.lockedIn)).toBe(63568);
    expect(Math.round(p.gainSince)).toBe(507690);
  });

  it('matches a cover to a short opened before the window instead of calling it a loss', () => {
    // $DG: shorted over three days, flagged on the last, covered all at once.
    const start = Date.UTC(2026, 8, 20, 5, 0);
    const trades = [
      tr('short', 1200, 491.14, start - 50 * H),
      tr('short', 1200, 447.35, start - 26 * H),
      tr('short', 1300, 397.83, start + 15 * 60000),
      tr('cover', 3700, 464.28, start + 24 * H),
    ];
    const p = windowProfit(trades, { start, end: start + 48 * H }, 451.9);
    // Real result: shorted $1,643,370, covered $1,717,836 — a ~$74k loss, not ~$1.2M.
    expect(p.lockedIn).toBeLessThan(-70000);
    expect(p.lockedIn).toBeGreaterThan(-80000);
  });

  it('ignores trades outside the window', () => {
    const p = windowProfit([tr('buy', 10, 100, T0 - H), tr('sell', 10, 200, T0 + 49 * H)], { start: T0, end: T0 + 48 * H }, 150);
    expect(p).toEqual({ trades: 0, lockedIn: 0, gainSince: 0 });
  });

  it('values a pump still held at today\'s price', () => {
    const p = windowProfit([tr('buy', 4800, 288.03, T0)], { start: T0, end: T0 + 48 * H }, 329.01);
    expect(Math.round(p.gainSince)).toBe(196704);
  });
});

describe('pushWindows', () => {
  it('merges overlapping pushes on one stock and keeps other stocks apart', () => {
    const w = pushWindows([
      { ticker: 'DG', day: '2026-09-20', startedAt: Date.UTC(2026, 8, 20, 5) },
      { ticker: 'DG', day: '2026-09-21', startedAt: Date.UTC(2026, 8, 21, 3) },
      { ticker: 'GUN', day: '2026-09-21', startedAt: Date.UTC(2026, 8, 21, 3) },
    ]);
    expect(w).toHaveLength(2);
    const dg = w.find((x) => x.ticker === 'DG');
    expect(dg.days).toEqual(['2026-09-20', '2026-09-21']);
    expect(dg.end).toBe(Date.UTC(2026, 8, 21, 3) + 48 * H);
  });

  it('falls back to the start of the day for alerts written before startedAt existed', () => {
    const [w] = pushWindows([{ ticker: 'SHNG', day: '2026-09-17' }]);
    expect(w.start).toBe(Date.UTC(2026, 8, 17));
  });
});

describe('planRemoval', () => {
  it('takes shares of the pushed stock, not cash or debt (Madness)', () => {
    // ~$468 cash, 4,803 $JYNG at 329.01, $592k owed.
    const u = { cash: 468, holdings: { JYNG: 4803, SHNG: 0.2 }, portfolioValue: 1581450, marginUsed: 591962 };
    const out = planRemoval(u, 559988, { JYNG: 329.01, SHNG: 2190.92 }, ['SHNG', 'JYNG']);
    // SHNG comes first but there is only a speck of it; the rest is JYNG.
    expect(out.shares.map((s) => s.ticker)).toEqual(['SHNG', 'JYNG']);
    const jyng = out.shares.find((s) => s.ticker === 'JYNG');
    expect(jyng.shares).toBeCloseTo((559988 - 0.2 * 2190.92) / 329.01, 1);
    expect(out.fromShares).toBeCloseTo(559988, 0);
    expect(out.fromCash).toBe(0);
    expect(out.toDebt).toBe(0);
    // Debt unchanged, so equity only falls by the value taken.
    expect(out.owedAfter).toBe(591962);
  });

  it('moves on to their largest other holding, then cash, then debt', () => {
    const u = { cash: 100, holdings: { A: 10, B: 1, C: 5 }, portfolioValue: 1100, marginUsed: 0 };
    const out = planRemoval(u, 1300, { A: 50, B: 100, C: 100 }, ['A']);
    // A first (preferred), then C ($500) before B ($100).
    expect(out.shares.map((s) => [s.ticker, s.shares, s.closes])).toEqual([['A', 10, true], ['C', 5, true], ['B', 1, true]]);
    expect(out.fromCash).toBe(100);
    expect(out.toDebt).toBe(100);
  });

  it('never takes more than the amount', () => {
    const out = planRemoval({ cash: 0, holdings: { A: 100 }, portfolioValue: 3000 }, 1000, { A: 30 }, ['A']);
    expect(out.fromShares).toBe(1000);
    expect(out.shares[0].shares).toBe(33.34);
    expect(out.shares[0].closes).toBe(false);
  });
});
