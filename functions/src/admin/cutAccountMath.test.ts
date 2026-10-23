import { describe, expect, it } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { planAccountCut } = require('./cutAccountMath') as typeof import('./cutAccountMath');

const prices = { AAA: 10, BBB: 50 };

describe('planAccountCut', () => {
  it('shrinks cash, shares, lots, lockups and debt by one factor to hit the target', () => {
    const plan = planAccountCut(
      {
        cash: 1000,
        marginUsed: 2000,
        holdings: { AAA: 100, BBB: 40 },
        holdingCohorts: { AAA: { eligible: 60, pending: [{ shares: 40, at: 1 }] } },
        marginLockup: { BBB: { shares: 10, until: 5 } },
      },
      prices,
      500,
    )!;
    // Net worth 1000 + 1000 + 2000 - 2000 = 2000; target 500 -> factor 0.25.
    expect(plan.factor).toBeCloseTo(0.25);
    expect(plan.before).toBe(2000);
    expect(plan.after).toBeCloseTo(500);
    expect(plan.dropPercent).toBe(75);
    expect(plan.updates.holdings).toEqual({ AAA: 25, BBB: 10 });
    expect(plan.updates['holdingCohorts.AAA']).toEqual({ eligible: 15, pending: [{ shares: 10, at: 1 }] });
    expect(plan.updates['marginLockup.BBB']).toEqual({ shares: 2.5, until: 5 });
    expect(plan.updates.cash).toBe(250);
    expect(plan.updates.marginUsed).toBe(500);
  });

  it('keeps long-term market positions and counts them toward the target', () => {
    const plan = planAccountCut({ cash: 900, eventPositionsValue: 100 }, prices, 500)!;
    expect(plan.updates.cash).toBe(400);
    expect(plan.after).toBe(500);
  });

  it('leaves an account already under the target alone', () => {
    expect(planAccountCut({ cash: 400 }, prices, 500)).toBeNull();
  });

  it('refuses open shorts and a target the event positions already pass', () => {
    expect(() => planAccountCut({ cash: 900, shorts: { AAA: { shares: 1 } } }, prices, 500)).toThrow(/shorts/);
    expect(() => planAccountCut({ cash: 900, eventPositionsValue: 600 }, prices, 500)).toThrow(/long-term/);
  });
});
