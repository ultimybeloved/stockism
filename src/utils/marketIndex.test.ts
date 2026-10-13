import { describe, it, expect } from 'vitest';
import { buildIndexSeries, computeIndexAtTime, nonETFCharacters } from './marketIndex';

const HOUR = 60 * 60 * 1000;
const now = Date.now();
const busy = nonETFCharacters[0]!;
const quiet = nonETFCharacters[1]!;

// Every stock sits at 2x base. The busy one only kept points from the last 10 hours,
// the quiet one from 30 days back: the live price history's shape in production.
const doubled = (ticker: string, base: number, fromHoursAgo: number) => [
  { price: base * 2, timestamp: now - fromHoursAgo * HOUR },
  { price: base * 2, timestamp: now - HOUR },
];
const history = Object.fromEntries(nonETFCharacters.map((c) => [c.ticker, doubled(c.ticker, c.basePrice, 720)]));
history[busy.ticker] = doubled(busy.ticker, busy.basePrice, 10);

describe('computeIndexAtTime', () => {
  it("uses a stock's oldest kept price, not its base, before its history starts", () => {
    // Without the divisor the index is 1000 x the average multiple; everyone is at 2x.
    expect(computeIndexAtTime(history, now - 48 * HOUR, null)).toBeCloseTo(2000);
  });

  it('still treats a stock with no history as at base', () => {
    const noQuiet = { ...history, [quiet.ticker]: [] };
    expect(computeIndexAtTime(noQuiet, now, null)).toBeLessThan(2000);
  });
});

describe('buildIndexSeries', () => {
  it('uses recorded daily values before every stock has live points', () => {
    const recorded = [
      { t: now - 72 * HOUR, v: 1500 },
      { t: now - 48 * HOUR, v: 1600 },
      { t: now - 5 * HOUR, v: 9999 }, // inside the live window: rebuilt from prices instead
    ];
    const series = buildIndexSeries(history, 2000, 168, null, recorded);
    expect(series[0]).toEqual({ timestamp: now - 72 * HOUR, price: 1500 });
    expect(series[1]).toEqual({ timestamp: now - 48 * HOUR, price: 1600 });
    expect(series.some((p) => p.price === 9999)).toBe(false);
    // From where the busy stock's points begin, the line is rebuilt from live prices.
    expect(series[2]!.timestamp).toBe(now - 10 * HOUR);
    expect(series[2]!.price).toBeCloseTo(2000);
  });

  it('falls back to rebuilding the whole range before the recorded values load', () => {
    const series = buildIndexSeries(history, 2000, 168, null);
    for (const p of series) expect(p.price).toBeCloseTo(2000);
  });
});
