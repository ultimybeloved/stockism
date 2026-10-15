import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const R = require('./botRules') as typeof import('./botRules');
type Storyline = import('./botRules').Storyline;
type Kind = import('./botRules').Kind;

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 9, 1);

// Seeded so every run is the same.
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/** Run one stock for `days`, moving it every 6 hours. Returns daily prices. */
const simulate = (kind: Kind, days: number, seed: number, floor: number | null = null, start = 100) => {
  const rng = seeded(seed);
  let s: Storyline = R.normalizeStoryline(null, T0);
  let price = start;
  const daily = [price];
  const drifts: number[] = [];
  for (let step = 1; step <= days * 4; step++) {
    const now = T0 + step * (DAY / 4);
    s = R.normalizeStoryline(s, now);
    if (R.needsNewPhase(s, kind, now, kind === 'held' ? T0 : null))
      s = R.pickPhase(s, kind, now, rng, kind === 'held' ? T0 : null);
    const move = R.stepMove(s, kind, price, now, rng, floor);
    price = Math.max(0.01, price * (1 + move));
    s = R.recordMove(s, kind, move, now);
    if (step % 4 === 0) daily.push(price);
    drifts.push(kind === 'held' ? s.holdDrift : s.botDrift);
  }
  return { daily, drifts, s };
};

describe('neglect slides', () => {
  it('average about 0.8% a day down', () => {
    const rates: number[] = [];
    for (let seed = 1; seed <= 40; seed++) {
      const { daily } = simulate('neglected', 120, seed);
      rates.push(Math.log(daily[daily.length - 1]! / daily[0]!) / 120);
    }
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(mean).toBeLessThan(-0.006);
    expect(mean).toBeGreaterThan(-0.01);
  });

  it('is not a straight ramp: some days are flat or up', () => {
    const { daily } = simulate('neglected', 90, 7);
    const changes = daily.slice(1).map((p, i) => p / daily[i]! - 1);
    expect(changes.some((c) => c > 0)).toBe(true);
    expect(changes.some((c) => c < -0.009)).toBe(true);
    const distinct = new Set(changes.map((c) => c.toFixed(3)));
    expect(distinct.size).toBeGreaterThan(20);
  });

  it('never slides below the floor', () => {
    const { daily } = simulate('neglected', 200, 3, 60);
    expect(Math.min(...daily)).toBeGreaterThanOrEqual(60 - 1e-9);
  });

  it('a frozen stock only wiggles flat', () => {
    const rates: number[] = [];
    for (let seed = 1; seed <= 30; seed++) {
      const { daily } = simulate('neglected_still', 60, seed);
      rates.push(Math.log(daily[daily.length - 1]! / daily[0]!) / 60);
    }
    const mean = rates.reduce((a, b) => a + b, 0) / rates.length;
    expect(Math.abs(mean)).toBeLessThan(0.001);
  });
});

describe('ordinary storylines', () => {
  it('never let the bots move a stock past the drift limit', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { drifts } = simulate('normal', 365, seed);
      expect(Math.max(...drifts.map(Math.abs))).toBeLessThanOrEqual(R.BOT_DRIFT_LIMIT + 1e-9);
    }
  });

  it('net out over time instead of trending', () => {
    const ends: number[] = [];
    for (let seed = 1; seed <= 60; seed++) ends.push(simulate('normal', 365, seed).s.botDrift);
    const mean = ends.reduce((a, b) => a + b, 0) / ends.length;
    expect(Math.abs(mean)).toBeLessThan(0.06);
  });

  it('give the chart shape: a year is not flat', () => {
    const { daily } = simulate('normal', 365, 11);
    const range = Math.max(...daily) / Math.min(...daily) - 1;
    expect(range).toBeGreaterThan(0.1);
  });

  it('stay under the stabilizer line: no week moves 12%', () => {
    let worst = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { daily } = simulate('normal', 365, seed);
      for (let i = 7; i < daily.length; i++) {
        const avg = daily.slice(i - 7, i).reduce((a, b) => a + b, 0) / 7;
        worst = Math.max(worst, Math.abs(daily[i]! / avg - 1));
      }
    }
    expect(worst).toBeLessThan(0.12);
  });

  it('cap every single move', () => {
    const rng = seeded(5);
    for (let i = 0; i < 2000; i++) {
      const s = R.pickPhase(R.normalizeStoryline(null, T0), 'normal', T0, rng);
      expect(Math.abs(R.stepMove(s, 'normal', 100, T0 + DAY, rng))).toBeLessThanOrEqual(R.MAX_STEP);
    }
  });
});

describe('admin-set prices', () => {
  it('bots never drift away from the admin price', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { drifts } = simulate('held', 7, seed);
      expect(Math.max(...drifts.map(Math.abs))).toBeLessThanOrEqual(R.HOLD_BAND + 1e-9);
    }
  });

  it('a new admin price starts a fresh hold', () => {
    const s = {
      ...R.normalizeStoryline(null, T0),
      phase: 'hold' as const,
      holdFrom: T0,
      holdDrift: 0.01,
      until: T0 + DAY,
    };
    expect(R.needsNewPhase(s, 'held', T0 + 1000, T0 + 500)).toBe(true);
    expect(R.pickPhase(s, 'held', T0, seeded(1), T0 + 500).holdDrift).toBe(0);
    expect(R.needsNewPhase(s, 'held', T0 + 1000, T0)).toBe(false);
  });

  it('gets only a few bot points a day', () => {
    const s = { ...R.normalizeStoryline(null, T0), moves: R.HELD_MAX_MOVES_PER_DAY };
    expect(R.underDailyCap(s, 'held')).toBe(false);
    expect(R.underDailyCap(s, 'normal')).toBe(true);
  });
});

describe('storyline bookkeeping', () => {
  it('switches phase as soon as the kind of stock changes', () => {
    const s = R.pickPhase(R.normalizeStoryline(null, T0), 'neglected', T0, seeded(2));
    expect(R.needsNewPhase(s, 'normal', T0 + 1000, null)).toBe(true);
    expect(R.needsNewPhase(s, 'neglected', T0 + 1000, null)).toBe(false);
  });

  it('resets the daily counters on a new UTC day', () => {
    const s = { ...R.normalizeStoryline(null, T0), moves: 5, impact: 0.04 };
    const next = R.normalizeStoryline(s, T0 + DAY);
    expect(next.moves).toBe(0);
    expect(next.impact).toBe(0);
  });

  it('picks distinct stocks', () => {
    const cands = ['A', 'B', 'C', 'D'].map((ticker) => ({ ticker, kind: 'normal' as Kind }));
    const out = R.chooseTickers(cands, 10, seeded(3));
    expect(out.sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('finds the newest admin point inside the window only', () => {
    const hist = [
      { timestamp: T0, price: 10, source: 'admin_adjust' },
      { timestamp: T0 + 1000, price: 11 },
    ];
    expect(R.lastAdminPoint(hist, DAY, T0 + 2000)?.price).toBe(10);
    expect(R.lastAdminPoint(hist, DAY, T0 + 2 * DAY)).toBeNull();
  });
});

describe('the guard', () => {
  const trade = (action: string, amount: number, price: number, ts = T0) => ({
    uid: 'm1',
    ticker: 'GOO',
    action,
    amount,
    price,
    ts,
  });

  it('pushes a pump back down while they still hold it', () => {
    const out = R.guardMove({ trades: [trade('buy', 1000, 100)], price: 110, exposure: 1000, othersOpposite: 0 });
    expect(out!.move).toBeLessThan(0);
    expect(out!.move).toBeGreaterThanOrEqual(-R.GUARD_MAX_STEP);
  });

  it('leaves a pump alone once they sold out', () => {
    expect(R.guardMove({ trades: [trade('buy', 1000, 100)], price: 110, exposure: 0, othersOpposite: 0 })).toBeNull();
  });

  it('lifts a dump while they are short', () => {
    const out = R.guardMove({ trades: [trade('short', 500, 100)], price: 90, exposure: -500, othersOpposite: 0 });
    expect(out!.move).toBeGreaterThan(0);
  });

  it('leaves a dump alone when the group bought the bottom', () => {
    const trades = [trade('sell', 1000, 100), trade('buy', 1500, 88, T0 + 1000)];
    // Net flow is up, so it does not even read as a dump: nothing to answer.
    expect(R.guardMove({ trades, price: 89, exposure: 500, othersOpposite: 0 })).toBeNull();
    // A dump they are net long on after it.
    const dump = [trade('sell', 1000, 100)];
    expect(R.guardMove({ trades: dump, price: 90, exposure: 300, othersOpposite: 0 })).toBeNull();
  });

  it('stands aside when other players would collect most of it', () => {
    expect(
      R.guardMove({ trades: [trade('buy', 1000, 100)], price: 110, exposure: 1000, othersOpposite: 600 }),
    ).toBeNull();
  });

  it('ignores small moves', () => {
    expect(
      R.guardMove({ trades: [trade('buy', 1000, 100)], price: 102, exposure: 1000, othersOpposite: 0 }),
    ).toBeNull();
  });

  it('never pushes past where they started', () => {
    const out = R.guardMove({
      trades: [trade('buy', 100, 100)],
      price: 101.5 * 1.03,
      exposure: 100,
      othersOpposite: 0,
    });
    const after = 101.5 * 1.03 * (1 + out!.move);
    expect(after).toBeGreaterThanOrEqual(100 - 1e-9);
  });

  it('only undoes the share of the push they still hold', () => {
    const full = R.guardMove({ trades: [trade('buy', 1000, 100)], price: 103, exposure: 1000, othersOpposite: 0 })!;
    const half = R.guardMove({ trades: [trade('buy', 1000, 100)], price: 103, exposure: 500, othersOpposite: 0 })!;
    expect(103 * (1 + full.move)).toBeCloseTo(100, 6);
    expect(103 * (1 + half.move)).toBeCloseTo(101.5, 6);
  });
});

describe('the stabilizer and confirmed manipulators', () => {
  it('skips a lift they bought the bottom of', () => {
    expect(R.stabilizerShouldSkip(false, 500, 500)).toBe(true);
    expect(R.stabilizerShouldSkip(false, -500, 500)).toBe(false);
  });

  it('skips a push down they shorted the top of', () => {
    expect(R.stabilizerShouldSkip(true, -500, -500)).toBe(true);
    expect(R.stabilizerShouldSkip(true, 500, 500)).toBe(false);
  });

  it('acts normally when they are not involved', () => {
    expect(R.stabilizerShouldSkip(false, 0, 0)).toBe(false);
    expect(R.stabilizerShouldSkip(true, 0, 0)).toBe(false);
  });

  it('netFlowByTicker signs buys up and sells down', () => {
    const t = (action: string, amount: number) => ({ uid: 'a', ticker: 'X', action, amount, price: 1, ts: 0 });
    expect(R.netFlowByTicker([t('buy', 10), t('sell', 3), t('short', 2), t('cover', 1)])).toEqual({ X: 6 });
  });
});
