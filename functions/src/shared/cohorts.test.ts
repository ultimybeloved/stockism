import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type Mod = typeof import('./cohorts');
let decrementCohort: Mod['decrementCohort'];
let addPendingShares: Mod['addPendingShares'];

beforeAll(() => {
  ({ decrementCohort, addPendingShares } = require('./cohorts') as Mod);
});

describe('decrementCohort', () => {
  it('closes the ledger on a full sell even when float math leaves a crumb', () => {
    // 0.1 + 0.2 = 0.30000000000000004, so selling the three lots' total used to
    // leave a lot of a few 1e-17 shares behind.
    let c = addPendingShares(null, 0.1, 1000);
    c = addPendingShares(c, 0.2, 2000);
    c = addPendingShares(c, 0.3, 3000);
    c.firstHeldAt = 1000;
    expect(decrementCohort(c, 0.6)).toBeNull();
    expect(decrementCohort({ eligible: 0.1 + 0.2, pending: [] }, 0.3)).toBeNull();
  });

  it('closes on many odd-sized lots sold in one go', () => {
    let seed = 7;
    const rand = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let run = 0; run < 2000; run++) {
      let c: ReturnType<typeof addPendingShares> | null = null;
      let held = 0;
      const lots = 2 + Math.floor(rand() * 6);
      for (let i = 0; i < lots; i++) {
        const shares = Math.round(rand() * 5e6) / 1e6 + 0.000001;
        c = addPendingShares(c, shares, i);
        held += shares;
      }
      expect(decrementCohort(c, held)).toBeNull();
    }
  });

  it('keeps what is left on a partial sell, oldest lot first, extra fields intact', () => {
    let c = addPendingShares(null, 5, 1000);
    c = addPendingShares(c, 3, 2000);
    c.firstHeldAt = 1000;
    const left = decrementCohort(c, 6);
    expect(left?.pending).toHaveLength(1);
    expect(left?.pending?.[0]?.shares).toBe(2);
    expect(left?.firstHeldAt).toBe(1000);
  });

  it('keeps a real millionth of a share', () => {
    const left = decrementCohort({ eligible: 1.000001, pending: [] }, 1);
    expect(left).not.toBeNull();
  });
});
