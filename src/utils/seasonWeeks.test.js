import { describe, it, expect } from 'vitest';
import { deriveSeasonWeeks, summariseSeasonWeeks, buildSeasonSeries } from './seasonWeeks';

const ctx = { seasonId: 'S1', baselineValue: 10000, indexAtStart: 1000 };
const row = (w, { v, g = 0, x, c = 0, h = 0 }) => ({ s: 'S1', w, t: w, v, g, x, c, h });

describe('deriveSeasonWeeks', () => {
  it('measures week 1 from the season baseline, not from the first checkpoint', () => {
    const out = deriveSeasonWeeks([row(1, { v: 11000, x: 1050 })], ctx);
    expect(out[0].weekReturn).toBeCloseTo(10, 9);
    expect(out[0].weekIndex).toBeCloseTo(5, 9);
    expect(out[0].beat).toBe(true);
  });

  it('strips free money collected during the week before scoring it', () => {
    // Portfolio 10000 -> 11000, but 1000 of it was handed over. Real move: zero.
    const out = deriveSeasonWeeks([row(1, { v: 11000, g: 1000, x: 1000 })], ctx);
    expect(out[0].weekReturn).toBeCloseTo(0, 9);
    expect(out[0].beat).toBe(false);
  });

  it('strips grants from the cumulative figure too', () => {
    const out = deriveSeasonWeeks([
      row(1, { v: 11000, g: 500, x: 1000 }),
      row(2, { v: 12000, g: 1500, x: 1000 }),
    ], ctx);
    expect(out[1].totalReturn).toBeCloseTo(5, 9); // (12000 - 1500 - 10000) / 10000
  });

  it('chains weeks off the previous row', () => {
    const out = deriveSeasonWeeks([
      row(1, { v: 11000, x: 1100 }),
      row(2, { v: 12100, x: 1210 }),
    ], ctx);
    expect(out[1].weekReturn).toBeCloseTo(10, 9);
    expect(out[1].weekIndex).toBeCloseTo(10, 9);
    expect(out[1].beat).toBe(false); // matching the market is not beating it
  });

  it('sorts out-of-order rows', () => {
    const out = deriveSeasonWeeks([
      row(3, { v: 13000, x: 1000 }),
      row(1, { v: 11000, x: 1000 }),
      row(2, { v: 12000, x: 1000 }),
    ], ctx);
    expect(out.map((d) => d.week)).toEqual([1, 2, 3]);
  });

  it('ignores rows from another season', () => {
    const out = deriveSeasonWeeks([
      { s: 'S0', w: 1, v: 99999, g: 0, x: 1, c: 0, h: 0 },
      row(1, { v: 11000, x: 1000 }),
    ], ctx);
    expect(out).toHaveLength(1);
    expect(out[0].totalReturn).toBeCloseTo(10, 9);
  });

  it('returns nothing without a usable baseline or opening index', () => {
    const rows = [row(1, { v: 11000, x: 1000 })];
    expect(deriveSeasonWeeks(rows, { ...ctx, baselineValue: 0 })).toEqual([]);
    expect(deriveSeasonWeeks(rows, { ...ctx, indexAtStart: 0 })).toEqual([]);
    expect(deriveSeasonWeeks(null, ctx)).toEqual([]);
    expect(deriveSeasonWeeks([], ctx)).toEqual([]);
  });

  it('reports concentration against invested money, not the whole portfolio', () => {
    // Half the portfolio is cash, and every invested dollar is in one character.
    const out = deriveSeasonWeeks([row(1, { v: 10000, x: 1000, c: 5000, h: 5000 })], ctx);
    expect(out[0].concentration).toBe(1);
  });

  it('reads zero concentration for someone holding nothing', () => {
    const out = deriveSeasonWeeks([row(1, { v: 10000, x: 1000, c: 0, h: 0 })], ctx);
    expect(out[0].concentration).toBe(0);
  });
});

describe('summariseSeasonWeeks', () => {
  const weeks = [
    row(1, { v: 11000, x: 1010, c: 900, h: 1000 }),
    row(2, { v: 10500, x: 1050, c: 500, h: 1000 }),
    row(3, { v: 12000, x: 1060, c: 800, h: 1000 }),
  ];
  const summary = summariseSeasonWeeks(deriveSeasonWeeks(weeks, ctx));

  it('counts the weeks that beat the market', () => {
    expect(summary.weeks).toBe(3);
    expect(summary.beatCount).toBe(2); // week 2 lost while the market rose
    expect(summary.beatShare).toBeCloseTo(2 / 3, 9);
  });

  it('reports the gap to the market', () => {
    expect(summary.totalReturn).toBeCloseTo(20, 9);
    expect(summary.totalIndex).toBeCloseTo(6, 9);
    expect(summary.excess).toBeCloseTo(14, 9);
  });

  it('reports peak AND average concentration, so either rule can be applied later', () => {
    expect(summary.peakConcentration).toBeCloseTo(0.9, 9);
    expect(summary.avgConcentration).toBeCloseTo((0.9 + 0.5 + 0.8) / 3, 9);
  });

  it('returns null with nothing to summarise', () => {
    expect(summariseSeasonWeeks([])).toBeNull();
    expect(summariseSeasonWeeks(null)).toBeNull();
  });
});

describe('the $GAP-sitter', () => {
  // The live complaint: a flashback arc about two characters, and someone parks
  // everything in one of them and earns millions doing nothing.
  //
  // Neither of the two obvious tests catches them on its own. They beat the
  // index nearly every week, so consistency waves them through. Only the
  // concentration figure separates them, which is why it is recorded.
  const sitter = [1, 2, 3, 4, 5].map((w) =>
    row(w, { v: 10000 * Math.pow(1.4, w), x: 1000 + w * 8, c: 1000, h: 1000 }));
  const derived = deriveSeasonWeeks(sitter, ctx);
  const summary = summariseSeasonWeeks(derived);

  it('sails past a beat-the-market test', () => {
    expect(summary.beatCount).toBe(5);
    expect(summary.excess).toBeGreaterThan(400);
  });

  it('is caught by concentration, on both readings', () => {
    expect(summary.peakConcentration).toBe(1);
    expect(summary.avgConcentration).toBe(1);
  });
});

describe('buildSeasonSeries', () => {
  const derived = deriveSeasonWeeks([
    row(1, { v: 11000, x: 1010 }),
    row(2, { v: 9000, x: 1020 }),
  ], ctx);

  it('puts both lines on one shared scale, which is the entire point', () => {
    const s = buildSeasonSeries(derived, { width: 100, height: 50, pad: 0 });
    const ys = [...s.you.split(' '), ...s.market.split(' ')].map((p) => Number(p.split(',')[1]));
    expect(Math.min(...ys)).toBeCloseTo(0, 6);
    expect(Math.max(...ys)).toBeCloseTo(50, 6);
  });

  it('starts both lines at the season opening, not the first checkpoint', () => {
    const s = buildSeasonSeries(derived, { width: 100, height: 50, pad: 0 });
    expect(s.you.split(' ')).toHaveLength(3); // week 0 plus two checkpoints
    expect(s.you.split(' ')[0].split(',')[0]).toBe('0.00');
  });

  it('locates the zero line inside the drawing area when the range crosses it', () => {
    const s = buildSeasonSeries(derived, { width: 100, height: 50, pad: 0 });
    expect(s.min).toBeLessThan(0);
    expect(s.max).toBeGreaterThan(0);
    expect(s.zeroY).toBeGreaterThan(0);
    expect(s.zeroY).toBeLessThan(50);
  });

  it('does not divide by zero on a single flat week', () => {
    const flat = deriveSeasonWeeks([row(1, { v: 10000, x: 1000 })], ctx);
    const s = buildSeasonSeries(flat, { width: 100, height: 50, pad: 0 });
    expect(s.you.split(' ').every((p) => p.split(',').every((n) => Number.isFinite(Number(n))))).toBe(true);
  });

  it('returns null with nothing to draw', () => {
    expect(buildSeasonSeries([])).toBeNull();
    expect(buildSeasonSeries(null)).toBeNull();
  });
});
