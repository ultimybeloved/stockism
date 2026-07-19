import { describe, it, expect } from 'vitest';
import {
  DIVIDEND_RATES,
  DIVIDEND_HOLD_MS,
  DIVIDEND_MAX_MULTIPLIER,
  dividendMultiplierForAgeMs,
  dividendWeightedShares,
  getDividendTier,
  getDividendRate,
} from '../characters';

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

// A lot bought `daysAgo` days ago, as the trade path stamps it.
const lot = (shares, daysAgo) => ({ shares, availableAt: NOW - daysAgo * DAY + DIVIDEND_HOLD_MS });

describe('dividendMultiplierForAgeMs (loyalty ladder)', () => {
  it('pays nothing inside the 10-day hold gate', () => {
    expect(dividendMultiplierForAgeMs(0)).toBe(0);
    expect(dividendMultiplierForAgeMs(9.9 * DAY)).toBe(0);
  });

  it('steps through the rungs at 10 days, 4 weeks, 8 weeks', () => {
    expect(dividendMultiplierForAgeMs(10 * DAY)).toBe(1.0);
    expect(dividendMultiplierForAgeMs(27 * DAY)).toBe(1.0);
    expect(dividendMultiplierForAgeMs(28 * DAY)).toBe(1.25);
    expect(dividendMultiplierForAgeMs(55 * DAY)).toBe(1.25);
    expect(dividendMultiplierForAgeMs(56 * DAY)).toBe(1.5);
    expect(dividendMultiplierForAgeMs(500 * DAY)).toBe(1.5);
  });
});

describe('dividendWeightedShares', () => {
  it('returns 0 for missing cohorts', () => {
    expect(dividendWeightedShares(null, NOW)).toBe(0);
    expect(dividendWeightedShares(undefined, NOW)).toBe(0);
  });

  it('pays eligible (fully matured) shares at the top multiplier', () => {
    expect(dividendWeightedShares({ eligible: 10, pending: [] }, NOW))
      .toBe(10 * DIVIDEND_MAX_MULTIPLIER);
  });

  it('weights each pending lot by its own age', () => {
    const cohort = {
      eligible: 4,               // 4 × 1.5  = 6
      pending: [
        lot(10, 5),              // inside hold gate → 0
        lot(10, 12),             // 10 × 1.0  = 10
        lot(8, 30),              // 8 × 1.25  = 10
        lot(2, 60),              // 2 × 1.5   = 3 (not yet folded into eligible)
      ],
    };
    expect(dividendWeightedShares(cohort, NOW)).toBe(6 + 10 + 10 + 3);
  });
});

describe('getDividendTier / getDividendRate', () => {
  const rarityTiers = { DG: 'legendary', JAY: 'rare', LAND: 'common' };

  it('follows the rarity tier for regular stocks', () => {
    expect(getDividendTier('DG', rarityTiers)).toBe('legendary');
    expect(getDividendRate('JAY', rarityTiers)).toBe(DIVIDEND_RATES.rare);
  });

  it('gives ETFs the flat etf rate regardless of rank', () => {
    expect(getDividendTier('ALLY', rarityTiers)).toBe('etf');
    expect(getDividendRate('ALLY', rarityTiers)).toBe(DIVIDEND_RATES.etf);
  });

  it('lets admin overrides trump the auto tier, including forcing none', () => {
    expect(getDividendTier('DG', rarityTiers, { DG: 'common' })).toBe('common');
    expect(getDividendRate('DG', rarityTiers, { DG: 'none' })).toBe(0);
  });

  it('maps legacy override values onto the new tiers', () => {
    expect(getDividendTier('DG', rarityTiers, { DG: 'blue-chip' })).toBe('legendary');
    expect(getDividendTier('DG', rarityTiers, { DG: 'dividend' })).toBe('uncommon');
    expect(getDividendRate('DG', rarityTiers, { DG: 'growth' })).toBe(0);
  });

  it('unknown tickers pay nothing; unranked stocks fall back to common', () => {
    expect(getDividendRate('NOPE', rarityTiers)).toBe(0);
    expect(getDividendTier('DG', {})).toBe('common');
  });

  it('every stock pays: all non-none tiers have a positive rate', () => {
    for (const [tier, rate] of Object.entries(DIVIDEND_RATES)) {
      if (tier === 'none') expect(rate).toBe(0);
      else expect(rate).toBeGreaterThan(0);
    }
  });
});
