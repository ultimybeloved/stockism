// Guards the pool odds the predictions page shows. What a card or the bet slip
// promises must equal what claimPredictionPayout actually pays
// (functions/src/predictions/predictions.ts), so a formula change on either side
// should break this test.
import { describe, it, expect } from 'vitest';
import { betPayout, poolPayout, poolShare, poolTotal, winnersOf } from './odds';
import type { PredictionDoc } from '../../../types';

const pred = (pools: Record<string, number>, extra: Partial<PredictionDoc> = {}): PredictionDoc => ({
  id: 'p1',
  options: Object.keys(pools),
  pools,
  ...extra,
});

describe('pool odds', () => {
  it('pays the underdog more than the favorite', () => {
    const p = pred({ Yes: 900, No: 100 });
    // Yes: 50 * 1050 / 950 = 55.26   No: 50 * 1050 / 150 = 350
    expect(poolPayout(p, 'Yes', 50)).toBeCloseTo(55.26, 2);
    expect(poolPayout(p, 'No', 50)).toBeCloseTo(350, 6);
  });

  it('drops the multiplier as the stake grows', () => {
    const p = pred({ Yes: 1000, No: 0 });
    // $50 into the empty side returns 21x; $500 only returns 3x.
    expect(poolPayout(p, 'No', 50) / 50).toBeCloseTo(21, 6);
    expect(poolPayout(p, 'No', 500) / 500).toBeCloseTo(3, 6);
  });

  it('pays an existing bet its share of the whole pot', () => {
    // The stake is already in the pool: 100/300 of a 1000 pot.
    expect(betPayout(pred({ Yes: 300, No: 700 }), { option: 'Yes', amount: 100 })).toBeCloseTo(333.33, 2);
  });

  it('splits an empty pool evenly and reads old yes/no pools', () => {
    expect(poolShare(pred({ A: 0, B: 0, C: 0 }), 'A')).toBe(33);
    expect(poolTotal({ id: 'old', options: ['Yes', 'No'], yesPool: 30, noPool: 70 })).toBe(100);
  });

  it('lists every winner', () => {
    expect(winnersOf(pred({ A: 1 }, { outcome: 'A' }))).toEqual(['A']);
    expect(winnersOf(pred({ A: 1, B: 1 }, { outcomes: ['A', 'B'] }))).toEqual(['A', 'B']);
    expect(winnersOf(pred({ A: 1 }))).toEqual([]);
  });
});
