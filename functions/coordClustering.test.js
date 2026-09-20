import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { clusterTrades, foldTrades } = require('./services/coordClustering');
const {
  COORD_MIN_ACCOUNTS,
  COORD_MIN_COMBINED_IMPACT,
  COORD_MIN_EACH_IMPACT,
  COORD_TIGHT_WINDOW_MS,
  COORD_HIGH_COMBINED_IMPACT,
} = require('./constants');

// A fixed midday timestamp so nothing here straddles a UTC date boundary.
const T0 = Date.parse('2026-09-17T12:00:00Z');
const at = (mins) => T0 + mins * 60 * 1000;

const sell = (uid, impact, mins = 0, extra = {}) =>
  ({ uid, ticker: 'SHNG', action: 'sell', priceImpact: impact, ts: at(mins), ...extra });
const buy = (uid, impact, mins = 0) =>
  ({ uid, ticker: 'SHNG', action: 'buy', priceImpact: impact, ts: at(mins) });

describe('clusterTrades', () => {
  it('flags several accounts pushing the same way past the combined threshold', () => {
    const out = clusterTrades([sell('a', 0.05, 0), sell('b', 0.05, 5)]);
    expect(out).toHaveLength(1);
    expect(out[0].ticker).toBe('SHNG');
    expect(out[0].direction).toBe('down');
    expect(out[0].combined).toBeCloseTo(0.10, 10);
    expect(out[0].uids.sort()).toEqual(['a', 'b']);
  });

  it('ignores one account moving a stock alone, however hard', () => {
    expect(clusterTrades([sell('a', 0.10, 0), sell('a', 0.10, 30)])).toHaveLength(0);
  });

  it('ignores several accounts whose combined pressure is small', () => {
    const tiny = (COORD_MIN_COMBINED_IMPACT / 2) / 2;
    expect(clusterTrades([sell('a', tiny, 0), sell('b', tiny, 1)])).toHaveLength(0);
  });

  it('does not count an account that barely took part', () => {
    // 'b' is under the per-account floor, so only 'a' really participated.
    const out = clusterTrades([sell('a', 0.12, 0), sell('b', COORD_MIN_EACH_IMPACT / 10, 1)]);
    expect(out).toHaveLength(0);
  });

  it('keeps opposite directions in separate clusters', () => {
    const out = clusterTrades([
      sell('a', 0.05, 0), sell('b', 0.05, 1),
      buy('c', 0.05, 2), buy('d', 0.05, 3),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((c) => c.direction).sort()).toEqual(['down', 'up']);
  });

  it('skips automated fills, so a stop loss never implicates its owner', () => {
    const out = clusterTrades([
      sell('a', 0.05, 0, { source: 'stop_loss' }),
      sell('b', 0.05, 1, { source: 'limit' }),
    ]);
    expect(out).toHaveLength(0);
  });

  it('marks a tight cluster high, measured from each account first trade', () => {
    const out = clusterTrades([sell('a', 0.03, 0), sell('b', 0.03, 2), sell('c', 0.03, 4)]);
    expect(out[0].tight).toBe(true);
    expect(out[0].severity).toBe('high');
  });

  it('does not call a spread-out day tight', () => {
    const past = COORD_TIGHT_WINDOW_MS / 60000 + 10;
    const out = clusterTrades([sell('a', 0.05, 0), sell('b', 0.05, past)]);
    expect(out[0].tight).toBe(false);
    expect(out[0].severity).toBe('medium');
  });

  it('one account grinding on afterwards does not hide a shared start', () => {
    // Both start together; 'a' keeps going for hours. Tightness reads the
    // starts, so this stays high.
    const out = clusterTrades([
      sell('a', 0.03, 0), sell('a', 0.03, 300), sell('b', 0.04, 3),
    ]);
    expect(out[0].tight).toBe(true);
  });

  it('calls a large combined move high even when spread across the day', () => {
    const past = COORD_TIGHT_WINDOW_MS / 60000 + 60;
    const half = COORD_HIGH_COMBINED_IMPACT;
    const out = clusterTrades([sell('a', half, 0), sell('b', half, past)]);
    expect(out[0].tight).toBe(false);
    expect(out[0].severity).toBe('high');
  });

  it('splits the same ticker across UTC days', () => {
    const nextDay = 24 * 60;
    const out = clusterTrades([
      sell('a', 0.05, 0), sell('b', 0.05, 1),
      sell('a', 0.05, nextDay), sell('b', 0.05, nextDay + 1),
    ]);
    expect(out).toHaveLength(2);
    expect(new Set(out.map((c) => c.day)).size).toBe(2);
  });

  it('ranks the heaviest cluster first', () => {
    const out = clusterTrades([
      sell('a', 0.05, 0), sell('b', 0.05, 1),
      { uid: 'c', ticker: 'GOO', action: 'short', priceImpact: 0.15, ts: at(0) },
      { uid: 'd', ticker: 'GOO', action: 'short', priceImpact: 0.15, ts: at(1) },
    ]);
    expect(out[0].ticker).toBe('GOO');
  });

  it('needs at least COORD_MIN_ACCOUNTS distinct accounts', () => {
    const rows = [];
    for (let i = 0; i < COORD_MIN_ACCOUNTS - 1; i++) rows.push(sell(`u${i}`, 0.2, i));
    expect(clusterTrades(rows)).toHaveLength(0);
  });

  it('survives junk rows without throwing', () => {
    const out = clusterTrades([
      null, undefined, {}, { uid: 'a' },
      { uid: 'a', ticker: 'SHNG', action: 'dividend', priceImpact: 0.5, ts: at(0) },
      { uid: 'b', ticker: 'SHNG', action: 'sell', priceImpact: NaN, ts: at(0) },
      { uid: 'c', ticker: 'SHNG', action: 'sell', priceImpact: 0.05, ts: 0 },
      sell('d', 0.06, 0), sell('e', 0.06, 1),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].uids.sort()).toEqual(['d', 'e']);
  });
});

describe('foldTrades', () => {
  it('sums an account repeated trades and keeps its first timestamp', () => {
    const cells = foldTrades([sell('a', 0.02, 10), sell('a', 0.03, 40)]);
    const cell = cells['SHNG|2026-09-17|down'];
    expect(cell.a.impact).toBeCloseTo(0.05, 10);
    expect(cell.a.trades).toBe(2);
    expect(cell.a.firstMs).toBe(at(10));
    expect(cell.a.lastMs).toBe(at(40));
  });
});
