import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'offline-test' });

const { buildRow, scoreDryRuns } = require('./services/seasonDryRun');

const week = (weekId, ranAt, index, rows) => ({ weekId, ranAt, index, rows });
const row = (uid, v, { g = 0, c = 0, h = 0, n = uid } = {}) => ({ uid, n, v, g, c, h });

describe('buildRow', () => {
  const prices = { GAP: 100, SHNG: 50 };

  it('records net equity and the biggest holding', () => {
    const r = buildRow('u1', {
      displayName: 'One', cash: 1000, holdings: { GAP: 10, SHNG: 20 }, marginUsed: 500, grantedValue: 250,
    }, prices);
    expect(r.v).toBe(2500); // 1000 cash + 1000 + 1000 holdings - 500 loan
    expect(r.c).toBe(1000);
    expect(r.h).toBe(2000);
    expect(r.g).toBe(250);
  });

  it('holds no verdicts, so the rules can change before season 1', () => {
    const r = buildRow('u1', { cash: 10, holdings: {} }, prices);
    expect(Object.keys(r).sort()).toEqual(['c', 'g', 'h', 'n', 'uid', 'v']);
    expect(Object.values(r).every((x) => typeof x === 'number' || typeof x === 'string')).toBe(true);
  });
});

describe('scoreDryRuns', () => {
  it('says nothing useful until there are two reports', () => {
    expect(scoreDryRuns([]).weeks).toBe(0);
    expect(scoreDryRuns([week('2026-09-17', 1, 1000, [row('a', 10000)])]).scored).toEqual([]);
  });

  it('measures each player from their first appearance', () => {
    const out = scoreDryRuns([
      week('2026-09-17', 1, 1000, [row('a', 10000)]),
      week('2026-09-24', 2, 1100, [row('a', 12000), row('b', 5000)]),
      week('2026-10-01', 3, 1100, [row('a', 13000), row('b', 6000)]),
    ]);
    const a = out.scored.find((p) => p.uid === 'a');
    const b = out.scored.find((p) => p.uid === 'b');
    expect(a.returnPercent).toBe(30);
    expect(a.marketPercent).toBe(10);
    expect(a.excess).toBe(20);
    // b joined in week two, so b is measured from 1100, where the market has not moved.
    expect(b.returnPercent).toBe(20);
    expect(b.marketPercent).toBe(0);
  });

  it('strips free money from the week and from the total', () => {
    const out = scoreDryRuns([
      week('w1', 1, 1000, [row('a', 10000)]),
      week('w2', 2, 1000, [row('a', 12000, { g: 2000 })]),
    ]);
    const a = out.scored[0];
    expect(a.returnPercent).toBe(0);
    expect(a.beatWeeks).toBe(0);
  });

  it('counts a missed week as a week not beaten', () => {
    const out = scoreDryRuns([
      week('w1', 1, 1000, [row('a', 10000), row('b', 10000)]),
      week('w2', 2, 1000, [row('a', 11000)]),
      week('w3', 3, 1000, [row('a', 12000), row('b', 30000)]),
    ]);
    const b = out.scored.find((p) => p.uid === 'b');
    expect(b.weeks).toBe(2);
    expect(b.beatWeeks).toBe(1);
    expect(b.beatShare).toBe(0.5);
  });

  it('keeps the highest concentration any week showed', () => {
    const out = scoreDryRuns([
      week('w1', 1, 1000, [row('a', 10000, { c: 300, h: 1000 })]),
      week('w2', 2, 1000, [row('a', 11000, { c: 950, h: 1000 })]),
      week('w3', 3, 1000, [row('a', 12000, { c: 100, h: 1000 })]),
    ]);
    expect(out.scored[0].peakConcentration).toBe(0.95);
  });

  it('applies the real tiers, including the one-character limit on Diamond', () => {
    // Fourteen on the board, so there are two Platinum places and one Diamond.
    // The twelve fillers go nowhere, which is what leaves the places to be won.
    const fillers = Array.from({ length: 12 }, (_, i) => row(`f${i}`, 10000 + i, { c: 100, h: 1000 }));
    const rows1 = [row('sitter', 10000, { c: 1000, h: 1000 }), row('spread', 10000, { c: 400, h: 1000 }), ...fillers];
    const rows2 = [row('sitter', 30000, { c: 1000, h: 1000 }), row('spread', 15000, { c: 400, h: 1000 }), ...fillers];
    const rows3 = [row('sitter', 40000, { c: 1000, h: 1000 }), row('spread', 20000, { c: 400, h: 1000 }), ...fillers];
    const out = scoreDryRuns([week('w1', 1, 1000, rows1), week('w2', 2, 1000, rows2), week('w3', 3, 1000, rows3)]);
    const tier = (uid) => out.scored.find((p) => p.uid === uid).tier;
    expect(tier('sitter')).toBe('platinum');
    expect(tier('spread')).toBe('diamond');
    expect(out.tierCounts.diamond).toBe(1);
  });

  it('drops players under the season floor and counts them', () => {
    const out = scoreDryRuns([
      week('w1', 1, 1000, [row('tiny', 400), row('ok', 10000)]),
      week('w2', 2, 1000, [row('tiny', 900), row('ok', 11000)]),
    ]);
    expect(out.scored.map((p) => p.uid)).toEqual(['ok']);
    expect(out.belowFloor).toBe(1);
  });

  it('reads reports in any order and reports the market move', () => {
    const out = scoreDryRuns([
      week('w2', 2, 1100, [row('a', 11000)]),
      week('w1', 1, 1000, [row('a', 10000)]),
    ]);
    expect(out.from).toBe('w1');
    expect(out.to).toBe('w2');
    expect(out.marketPercent).toBe(10);
    expect(out.scored[0].excess).toBe(0);
  });
});
