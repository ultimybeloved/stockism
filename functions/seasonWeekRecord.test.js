import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// season.js grabs a Firestore handle at import time. Nothing exercised here
// reads or writes; the app just has to exist.
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'offline-test' });

const { buildWeekRecord, appendWeekRecord } = require('./services/season');

const season = { id: 'S1' };
const prices = { GAP: 100, SHNG: 50, JAY: 20 };

describe('buildWeekRecord', () => {
  const base = {
    portfolioValue: 10000,
    grantedValue: 1500,
    seasonBaseline: { seasonId: 'S1', value: 5000, granted: 500 },
    holdings: { GAP: 60, SHNG: 40, JAY: 50 }, // 6000 / 2000 / 1000
  };

  it('records granted value SINCE the baseline, not lifetime', () => {
    const r = buildWeekRecord({ season, weeks: 3, userData: base, prices, indexValue: 1234.5 });
    expect(r.g).toBe(1000); // 1500 lifetime - 500 pinned at season start
  });

  it('records the largest holding and the holdings total', () => {
    const r = buildWeekRecord({ season, weeks: 3, userData: base, prices, indexValue: 1234.5 });
    expect(r.c).toBe(6000);
    expect(r.h).toBe(9000);
  });

  it('carries the index and the week so the row can be scored later', () => {
    const r = buildWeekRecord({ season, weeks: 7, userData: base, prices, indexValue: 1234.5 });
    expect(r.x).toBe(1234.5);
    expect(r.w).toBe(7);
    expect(r.s).toBe('S1');
    expect(r.v).toBe(10000);
  });

  it('stores no verdicts at all', () => {
    // The whole point: the tier rule can change later and rescore history. If a
    // boolean ever appears in here, that stops being true.
    const r = buildWeekRecord({ season, weeks: 1, userData: base, prices, indexValue: 1000 });
    expect(Object.values(r).every((v) => typeof v === 'number' || typeof v === 'string')).toBe(true);
    expect(Object.keys(r).sort()).toEqual(['c', 'g', 'h', 's', 't', 'v', 'w', 'x']);
  });

  it('ignores zero and negative share counts', () => {
    const userData = { ...base, holdings: { GAP: 0, SHNG: -5, JAY: 50 } };
    const r = buildWeekRecord({ season, weeks: 1, userData, prices, indexValue: 1000 });
    expect(r.c).toBe(1000);
    expect(r.h).toBe(1000);
  });

  it('prices an unknown ticker at zero rather than crashing', () => {
    const userData = { ...base, holdings: { MYSTERY: 10 } };
    const r = buildWeekRecord({ season, weeks: 1, userData, prices, indexValue: 1000 });
    expect(r.c).toBe(0);
    expect(r.h).toBe(0);
  });

  it('handles an empty account', () => {
    const r = buildWeekRecord({ season, weeks: 1, userData: {}, prices, indexValue: 1000 });
    expect(r.v).toBe(0);
    expect(r.g).toBe(0);
    expect(r.c).toBe(0);
  });

  it('gives a one-stock portfolio full concentration', () => {
    // The $GAP-sitter this measurement exists to catch.
    const userData = { ...base, holdings: { GAP: 60 } };
    const r = buildWeekRecord({ season, weeks: 1, userData, prices, indexValue: 1000 });
    expect(r.c / r.h).toBe(1);
  });
});

describe('appendWeekRecord', () => {
  const rec = (w, s = 'S1') => ({ s, w, t: w, v: 1, g: 0, x: 1000, c: 0, h: 0 });

  it('appends in order', () => {
    const out = appendWeekRecord([rec(1), rec(2)], rec(3));
    expect(out.map((e) => e.w)).toEqual([1, 2, 3]);
  });

  it('drops records from an earlier season', () => {
    const out = appendWeekRecord([rec(1, 'S0'), rec(2, 'S0')], rec(1, 'S1'));
    expect(out).toHaveLength(1);
    expect(out[0].s).toBe('S1');
  });

  it('replaces a week rather than duplicating it, so a re-run is safe', () => {
    const first = appendWeekRecord([rec(1)], rec(2));
    const rerun = appendWeekRecord(first, { ...rec(2), v: 999 });
    expect(rerun.map((e) => e.w)).toEqual([1, 2]);
    expect(rerun[1].v).toBe(999);
  });

  it('survives a missing or malformed existing array', () => {
    expect(appendWeekRecord(undefined, rec(1))).toHaveLength(1);
    expect(appendWeekRecord(null, rec(1))).toHaveLength(1);
    expect(appendWeekRecord([null, undefined], rec(1))).toHaveLength(1);
  });

  it('caps the series so one long season cannot grow the doc without bound', () => {
    let series = [];
    for (let w = 1; w <= 200; w++) series = appendWeekRecord(series, rec(w));
    expect(series.length).toBeLessThanOrEqual(80);
    expect(series[series.length - 1].w).toBe(200);
  });
});

describe('what the record makes computable', () => {
  // Nothing below is stored. All of it falls out of consecutive raw rows, which
  // is the reason the rule can still be changed after a season has started.
  const weekly = (prev, curr) => {
    const grantsThisWeek = curr.g - prev.g;
    return ((curr.v - grantsThisWeek) - prev.v) / prev.v;
  };
  const indexWeekly = (prev, curr) => (curr.x - prev.x) / prev.x;

  const w1 = { s: 'S1', w: 1, t: 1, v: 10000, g: 0, x: 1000, c: 5000, h: 9000 };
  const w2 = { s: 'S1', w: 2, t: 2, v: 11500, g: 500, x: 1020, c: 6000, h: 10000 };

  it('derives a weekly return with grants stripped out', () => {
    // 10000 -> 11500, but 500 of that was free money, so the real move is +10%.
    expect(weekly(w1, w2)).toBeCloseTo(0.10, 9);
  });

  it('derives whether the player beat the market that week', () => {
    expect(indexWeekly(w1, w2)).toBeCloseTo(0.02, 9);
    expect(weekly(w1, w2) > indexWeekly(w1, w2)).toBe(true);
  });

  it('derives concentration both ways', () => {
    expect(w2.c / w2.h).toBeCloseTo(0.6, 9);   // of invested money
    expect(w2.c / w2.v).toBeCloseTo(0.5217, 3); // of the whole portfolio
  });
});
