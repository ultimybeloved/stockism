import { describe, it, expect } from 'vitest';
import { foldEntries } from './useMarketActivity';

describe('foldEntries', () => {
  it('folds back-to-back repeats and puts the newest first', () => {
    const rows = foldEntries([
      { t: 'JAKE', s: 'b', at: 1 },
      { t: 'JAKE', s: 'b', at: 2 },
      { t: 'JAKE', s: 's', at: 3 },
      { t: 'GOO', s: 'b', at: 4 },
    ]);
    expect(rows.map((r) => [r.ticker, r.side, r.count])).toEqual([
      ['GOO', 'buy', 1],
      ['JAKE', 'sell', 1],
      ['JAKE', 'buy', 2],
    ]);
    expect(rows[2]!.at).toBe(2);
  });

  it('keeps a row id as its count grows', () => {
    const a = foldEntries([{ t: 'JAKE', s: 'b', at: 1 }]);
    const b = foldEntries([
      { t: 'JAKE', s: 'b', at: 1 },
      { t: 'JAKE', s: 'b', at: 5 },
    ]);
    expect(b[0]!.id).toBe(a[0]!.id);
  });
});
