import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// Pure maths, no Firestore handle. Lives at the functions root because the
// backend lint predeploy hook parses services/ as CommonJS.
const {
  indexConstituents, sumRatios, sameConstituents, reconcileDivisor, computeIndexValue,
} = require('./services/indexMaintenance');
const { INDEX_BASE_VALUE } = require('./constants');

// A small synthetic roster keeps the arithmetic checkable by hand.
const roster = (n, base = 10) =>
  Array.from({ length: n }, (_, i) => ({ t: `T${i}`, b: base }));
const flat = (constituents, multiplier = 1) =>
  Object.fromEntries(constituents.map((c) => [c.t, c.b * multiplier]));

describe('index value', () => {
  it('reads the base value when every character sits at its base price', () => {
    const c = roster(50);
    const { divisor } = reconcileDivisor({ prices: flat(c), constituents: c, stored: {}, lastIndexValue: 0 });
    expect(computeIndexValue(flat(c), c, divisor)).toBeCloseTo(INDEX_BASE_VALUE, 6);
  });

  it('doubles when every price doubles', () => {
    const c = roster(50);
    const { divisor } = reconcileDivisor({ prices: flat(c), constituents: c, stored: {}, lastIndexValue: 0 });
    expect(computeIndexValue(flat(c, 2), c, divisor)).toBeCloseTo(INDEX_BASE_VALUE * 2, 6);
  });

  it('treats a missing price as sitting at base', () => {
    const c = roster(3);
    expect(sumRatios({ T0: 10, T1: 10 }, c)).toBeCloseTo(3, 6);
  });

  it('falls back to the base value rather than dividing by zero', () => {
    expect(computeIndexValue({}, roster(3), 0)).toBe(INDEX_BASE_VALUE);
  });
});

describe('divisor bootstrap', () => {
  it('reproduces the last recorded value exactly, so the chart does not step', () => {
    const c = roster(150);
    const prices = flat(c, 1.8);
    const lastIndexValue = 1800;
    const { divisor, adjusted, reason } =
      reconcileDivisor({ prices, constituents: c, stored: {}, lastIndexValue });
    expect(adjusted).toBe(true);
    expect(reason).toBe('bootstrap-continuous');
    expect(computeIndexValue(prices, c, divisor)).toBeCloseTo(lastIndexValue, 6);
  });

  it('bootstraps to the genesis divisor when there is no history at all', () => {
    const c = roster(150);
    const { divisor, reason } =
      reconcileDivisor({ prices: flat(c), constituents: c, stored: {}, lastIndexValue: 0 });
    expect(reason).toBe('bootstrap-genesis');
    expect(divisor).toBeCloseTo(150 / INDEX_BASE_VALUE, 9);
  });
});

describe('divisor on a roster change', () => {
  // The bug this exists to stop: 150 characters averaging 1.8x base, then ten
  // new ones arrive at 1.0x. Under a plain average the index drops ~3% and every
  // player looks like they beat the market that month.
  const before = roster(150);
  const prices = { ...flat(before, 1.8) };
  const added = Array.from({ length: 10 }, (_, i) => ({ t: `NEW${i}`, b: 10 }));
  const after = [...before, ...added];
  for (const a of added) prices[a.t] = a.b; // new characters enter at base

  const bootstrap = reconcileDivisor({ prices, constituents: before, stored: {}, lastIndexValue: 1800 });
  const stored = { divisor: bootstrap.divisor, constituents: before };

  it('a plain average would have dropped, which is the whole problem', () => {
    const naive = INDEX_BASE_VALUE * (sumRatios(prices, after) / after.length);
    expect(naive).toBeLessThan(1790);
  });

  it('holds the index steady across the change', () => {
    const valueBefore = computeIndexValue(prices, before, stored.divisor);
    const { divisor, adjusted, reason } =
      reconcileDivisor({ prices, constituents: after, stored, lastIndexValue: valueBefore });
    expect(adjusted).toBe(true);
    expect(reason).toBe('roster-change');
    expect(computeIndexValue(prices, after, divisor)).toBeCloseTo(valueBefore, 6);
  });

  it('still tracks real price moves after the adjustment', () => {
    const valueBefore = computeIndexValue(prices, before, stored.divisor);
    const { divisor } = reconcileDivisor({ prices, constituents: after, stored, lastIndexValue: valueBefore });
    const movedUp = Object.fromEntries(Object.entries(prices).map(([t, p]) => [t, p * 1.1]));
    expect(computeIndexValue(movedUp, after, divisor)).toBeCloseTo(valueBefore * 1.1, 6);
  });

  it('holds steady when a character LEAVES the roster too', () => {
    const valueBefore = computeIndexValue(prices, before, stored.divisor);
    const shrunk = before.slice(0, 140);
    const { divisor, reason } =
      reconcileDivisor({ prices, constituents: shrunk, stored, lastIndexValue: valueBefore });
    expect(reason).toBe('roster-change');
    expect(computeIndexValue(prices, shrunk, divisor)).toBeCloseTo(valueBefore, 6);
  });

  it('values a departed character from its stored base price, not the roster', () => {
    // stored.constituents carries basePrice precisely so a character that is gone
    // from characters.js entirely can still be priced on the way out.
    const gone = { t: 'GONE', b: 4 };
    const storedWithGone = { divisor: stored.divisor, constituents: [...before, gone] };
    const pricesWithGone = { ...prices, GONE: 8 }; // 2x base
    const oldSum = sumRatios(pricesWithGone, storedWithGone.constituents);
    expect(oldSum).toBeCloseTo(sumRatios(pricesWithGone, before) + 2, 6);
  });

  it('leaves the divisor alone when it cannot compute a sane rescale', () => {
    const { divisor, adjusted, reason } = reconcileDivisor({
      prices: {}, constituents: [], stored, lastIndexValue: 1800,
    });
    expect(adjusted).toBe(false);
    expect(reason).toBe('degenerate-sum');
    expect(divisor).toBe(stored.divisor);
  });

  it('does not adjust when the set is unchanged, whatever the order', () => {
    const shuffled = [...before].reverse();
    const { adjusted, reason, divisor } =
      reconcileDivisor({ prices, constituents: shuffled, stored, lastIndexValue: 1800 });
    expect(adjusted).toBe(false);
    expect(reason).toBe('unchanged');
    expect(divisor).toBe(stored.divisor);
  });
});

describe('sameConstituents', () => {
  it('ignores order', () => {
    expect(sameConstituents(roster(5), [...roster(5)].reverse())).toBe(true);
  });
  it('notices additions and removals', () => {
    expect(sameConstituents(roster(5), roster(6))).toBe(false);
    expect(sameConstituents(roster(6), roster(5))).toBe(false);
  });
});

describe('the real roster', () => {
  it('excludes ETFs and anything without a base price', () => {
    const c = indexConstituents();
    expect(c.length).toBeGreaterThan(100);
    expect(c.every((x) => x.b > 0)).toBe(true);
    const { CHARACTERS } = require('./characters');
    const etfTickers = new Set(CHARACTERS.filter((x) => x.isETF).map((x) => x.ticker));
    expect(c.some((x) => etfTickers.has(x.t))).toBe(false);
  });
});
