import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const R = require('./activityFeedRules') as typeof import('./activityFeedRules');

describe('activity feed', () => {
  it('reads shorts as sells and covers as buys, and skips the rest', () => {
    expect(['buy', 'sell', 'short', 'cover', 'dividend', 'margin_liquidation'].map(R.sideOf)).toEqual([
      'b',
      's',
      's',
      'b',
      null,
      null,
    ]);
  });

  it('thins evenly and keeps order', () => {
    const list = Array.from({ length: 100 }, (_, i) => i);
    const out = R.thin(list, 10);
    expect(out).toHaveLength(10);
    expect([...out].sort((a, b) => a - b)).toEqual(out);
    expect(R.thin([1, 2], 10)).toEqual([1, 2]);
  });

  it('places bot entries inside the window, by direction', () => {
    const items = R.botItems(
      [
        { ticker: 'JAKE', frac: 0.01 },
        { ticker: 'GOO', frac: -0.02 },
      ],
      1000,
      2000,
    );
    expect(items.length).toBeGreaterThanOrEqual(2);
    for (const i of items) {
      expect(i.at).toBeGreaterThan(1000);
      expect(i.at).toBeLessThanOrEqual(2000);
      expect(i.s).toBe(i.t === 'JAKE' ? 'b' : 's');
    }
  });

  it('merges in time order and caps the list', () => {
    const old = Array.from({ length: 140 }, (_, i) => ({ t: 'A', s: 'b' as const, at: i }));
    const add = Array.from({ length: 20 }, (_, i) => ({ t: 'B', s: 's' as const, at: 500 - i }));
    const out = R.mergeItems(old, add);
    expect(out).toHaveLength(150);
    expect(out.at(-1)!.at).toBe(500);
    expect(out.every((x, i) => i === 0 || out[i - 1]!.at <= x.at)).toBe(true);
  });
});
