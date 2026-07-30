// Exit loyalty discount math. This number scales what a seller is paid, and it
// is mirrored across the regular sell path, the limit-order engine and the
// frontend preview, so the rules are pinned here rather than in any one caller.
//
// Every case passes an explicit `now` — a test anchored to the real clock would
// silently change meaning as lots age.
import { describe, it, expect } from 'vitest';
import {
  exitLoyaltyDiscount,
  exitDiscountForAgeMs,
  dividendWeightedShares,
  cohortLots,
  loyaltyTierFor,
  EXIT_LOYALTY_MAX_DISCOUNT,
  LOYALTY_NOTIFY_MIN_SHARES,
  DIVIDEND_HOLD_MS,
  DIVIDEND_HOLD_DAYS,
  DIVIDEND_LADDER_EPOCH,
} from './characters';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2027, 0, 1);
const LEGACY_ACQUIRED_AT = DIVIDEND_LADDER_EPOCH - DIVIDEND_HOLD_MS;

// A pending lot that is `ageDays` old at NOW
const lot = (shares, ageDays) => ({ shares, availableAt: NOW - ageDays * DAY + DIVIDEND_HOLD_MS });
const cohort = (eligible, pending = []) => ({ eligible, pending });

describe('exitDiscountForAgeMs', () => {
  it('pays nothing below the dividend hold gate', () => {
    expect(exitDiscountForAgeMs(0)).toBe(0);
    expect(exitDiscountForAgeMs((DIVIDEND_HOLD_DAYS - 0.1) * DAY)).toBe(0);
  });

  it('steps up at 10, 28 and 56 days', () => {
    expect(exitDiscountForAgeMs(DIVIDEND_HOLD_DAYS * DAY)).toBe(0.10);
    expect(exitDiscountForAgeMs(27.9 * DAY)).toBe(0.10);
    expect(exitDiscountForAgeMs(28 * DAY)).toBe(0.25);
    expect(exitDiscountForAgeMs(55.9 * DAY)).toBe(0.25);
    expect(exitDiscountForAgeMs(56 * DAY)).toBe(0.40);
  });

  it('never exceeds the cap, however long it is held', () => {
    expect(exitDiscountForAgeMs(10000 * DAY)).toBe(EXIT_LOYALTY_MAX_DISCOUNT);
    expect(EXIT_LOYALTY_MAX_DISCOUNT).toBeLessThan(1);
  });
});

describe('exitLoyaltyDiscount', () => {
  it('gives nothing without a cohort record', () => {
    expect(exitLoyaltyDiscount(null, 100, NOW)).toBe(0);
    expect(exitLoyaltyDiscount(undefined, 100, NOW)).toBe(0);
    expect(exitLoyaltyDiscount(cohort(0, []), 100, NOW)).toBe(0);
  });

  it('gives nothing for a zero or negative sale', () => {
    expect(exitLoyaltyDiscount(cohort(100), 0, NOW)).toBe(0);
    expect(exitLoyaltyDiscount(cohort(100), -5, NOW)).toBe(0);
  });

  it('rates a single pending lot by its own age', () => {
    expect(exitLoyaltyDiscount(cohort(0, [lot(100, 5)]), 100, NOW)).toBe(0);
    expect(exitLoyaltyDiscount(cohort(0, [lot(100, 15)]), 100, NOW)).toBe(0.10);
    expect(exitLoyaltyDiscount(cohort(0, [lot(100, 30)]), 100, NOW)).toBe(0.25);
    expect(exitLoyaltyDiscount(cohort(0, [lot(100, 60)]), 100, NOW)).toBe(0.40);
  });

  it('ages the eligible bucket from the ladder epoch, not from zero', () => {
    // Eligible carries no per-lot date, so it inherits the legacy stamp.
    const justAfterEpoch = LEGACY_ACQUIRED_AT + 5 * DAY;
    expect(exitLoyaltyDiscount(cohort(100), 100, justAfterEpoch)).toBe(0);

    const wellAfter = LEGACY_ACQUIRED_AT + 60 * DAY;
    expect(exitLoyaltyDiscount(cohort(100), 100, wellAfter)).toBe(0.40);
  });

  it('weights a mixed position by how many shares are actually old', () => {
    // 100 mature + 900 fresh, selling the lot: only the 100 earn anything.
    const mixed = cohort(0, [lot(100, 60), lot(900, 1)]);
    expect(exitLoyaltyDiscount(mixed, 1000, NOW)).toBeCloseTo(0.04, 10);
  });

  it('consumes oldest first, matching decrementCohort', () => {
    // Selling only 100 of the same position takes the mature shares first.
    const mixed = cohort(0, [lot(100, 60), lot(900, 1)]);
    expect(exitLoyaltyDiscount(mixed, 100, NOW)).toBe(0.40);

    // Eligible is consumed ahead of every pending lot.
    const withEligible = { eligible: 50, pending: [lot(50, 60)] };
    const at = LEGACY_ACQUIRED_AT + 30 * DAY;
    // 50 eligible @ 30d old = 0.25, then 50 pending — at `at` that lot is not
    // yet created, so build the expectation from the walk itself.
    const lots = cohortLots(withEligible, at);
    expect(lots[0].shares).toBe(50);
    expect(lots[0].ageMs).toBe(at - LEGACY_ACQUIRED_AT);
  });

  it('earns nothing on shares the cohort does not cover', () => {
    // Cohort knows about 100 mature shares but the user is selling 200. The
    // unaccounted 100 are treated as brand new.
    const partial = cohort(0, [lot(100, 60)]);
    expect(exitLoyaltyDiscount(partial, 200, NOW)).toBeCloseTo(0.20, 10);
  });

  it('never returns more than the cap', () => {
    const ancient = cohort(0, [lot(1000, 5000)]);
    expect(exitLoyaltyDiscount(ancient, 1000, NOW)).toBe(EXIT_LOYALTY_MAX_DISCOUNT);
  });

  it('ignores empty pending buckets', () => {
    const withEmpties = cohort(0, [{ shares: 0, availableAt: NOW }, lot(100, 60)]);
    expect(exitLoyaltyDiscount(withEmpties, 100, NOW)).toBe(0.40);
  });
});

describe('loyaltyTierFor', () => {
  it('reports no tier below the first rung', () => {
    expect(loyaltyTierFor(cohort(0, [lot(100, 5)]), NOW)).toEqual({ tier: 0, shares: 0 });
    expect(loyaltyTierFor(null, NOW)).toEqual({ tier: 0, shares: 0 });
    expect(loyaltyTierFor(cohort(0, []), NOW)).toEqual({ tier: 0, shares: 0 });
  });

  it('reports each rung with the shares that reached it', () => {
    expect(loyaltyTierFor(cohort(0, [lot(100, 15)]), NOW)).toEqual({ tier: DIVIDEND_HOLD_DAYS, shares: 100 });
    expect(loyaltyTierFor(cohort(0, [lot(100, 30)]), NOW)).toEqual({ tier: 28, shares: 100 });
    expect(loyaltyTierFor(cohort(0, [lot(100, 60)]), NOW)).toEqual({ tier: 56, shares: 100 });
  });

  it('reports the highest rung reached, not an average', () => {
    // 10 mature + 900 fresh: the holding HAS reached 8 weeks, on 10 shares.
    const mixed = cohort(0, [lot(10, 60), lot(900, 1)]);
    expect(loyaltyTierFor(mixed, NOW)).toEqual({ tier: 56, shares: 10 });
  });

  it('sums every lot at or above the reported rung', () => {
    const spread = cohort(0, [lot(10, 90), lot(15, 60), lot(40, 30)]);
    expect(loyaltyTierFor(spread, NOW)).toEqual({ tier: 56, shares: 25 });
  });

  it('falls to a lower rung when the top one is below the dust threshold', () => {
    const dust = cohort(0, [lot(LOYALTY_NOTIFY_MIN_SHARES / 2, 60), lot(50, 30)]);
    expect(loyaltyTierFor(dust, NOW)).toEqual({ tier: 28, shares: 50.5 });
  });

  it('ages the eligible bucket from the ladder epoch', () => {
    expect(loyaltyTierFor(cohort(100), LEGACY_ACQUIRED_AT + 5 * DAY)).toEqual({ tier: 0, shares: 0 });
    expect(loyaltyTierFor(cohort(100), LEGACY_ACQUIRED_AT + 30 * DAY)).toEqual({ tier: 28, shares: 100 });
    expect(loyaltyTierFor(cohort(100), LEGACY_ACQUIRED_AT + 60 * DAY)).toEqual({ tier: 56, shares: 100 });
  });
});

describe('dividendWeightedShares still matches the pre-refactor walk', () => {
  // Both readers now share cohortLots; this pins the dividend result so the
  // shared walk can't quietly change payouts.
  const reference = (c, now) => {
    if (!c) return 0;
    const mult = (ageMs) => {
      const d = ageMs / DAY;
      if (d >= 56) return 1.5;
      if (d >= 28) return 1.25;
      if (d >= DIVIDEND_HOLD_DAYS) return 1.0;
      return 0;
    };
    let w = (c.eligible || 0) * mult(now - LEGACY_ACQUIRED_AT);
    for (const p of (c.pending || [])) {
      w += (p.shares || 0) * mult(now - ((p.availableAt || 0) - DIVIDEND_HOLD_MS));
    }
    return w;
  };

  const cases = [
    null,
    cohort(0, []),
    cohort(100, []),
    cohort(0, [lot(100, 5)]),
    cohort(0, [lot(100, 15), lot(50, 30), lot(25, 60)]),
    cohort(200, [lot(100, 1), lot(40, 40)]),
  ];

  it.each(cases.map((c, i) => [i, c]))('case %i matches', (_i, c) => {
    for (const now of [NOW, LEGACY_ACQUIRED_AT + 20 * DAY, LEGACY_ACQUIRED_AT + 90 * DAY]) {
      expect(dividendWeightedShares(c, now)).toBeCloseTo(reference(c, now), 10);
    }
  });
});
