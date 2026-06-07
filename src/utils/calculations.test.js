import { describe, it, expect } from 'vitest';
import {
  getBidAskPrices,
  calculatePortfolioValue,
  calculateMarginStatus,
  calculatePriceImpactDollars,
  getShortLiquidationPrice,
  getCurrentPrice,
  getMarginTierMultiplier,
  getMarginTierName,
  checkMarginEligibility,
  lmsrPrices,
  lmsrBuyCost,
  lmsrSellRefund,
} from './calculations';

// ─── getBidAskPrices ──────────────────────────────────────────────────────────

describe('getBidAskPrices', () => {
  it('ask is higher than bid', () => {
    const { bid, ask } = getBidAskPrices(100);
    expect(ask).toBeGreaterThan(bid);
  });

  it('mid price is between bid and ask', () => {
    const { bid, ask } = getBidAskPrices(100);
    expect(bid).toBeLessThan(100);
    expect(ask).toBeGreaterThan(100);
  });

  it('ETF spread is tighter than regular spread', () => {
    const regular = getBidAskPrices(100, false);
    const etf = getBidAskPrices(100, true);
    expect(etf.spread).toBeLessThan(regular.spread);
  });

  it('bid does not go below MIN_PRICE for tiny prices', () => {
    const { bid } = getBidAskPrices(0.001);
    expect(bid).toBeGreaterThanOrEqual(0.01);
  });
});

// ─── calculatePortfolioValue ──────────────────────────────────────────────────

describe('calculatePortfolioValue', () => {
  it('cash only portfolio equals cash', () => {
    const value = calculatePortfolioValue({ cash: 500, holdings: {}, shorts: {} }, {});
    expect(value).toBe(500);
  });

  it('includes holdings value at current prices', () => {
    const user = { cash: 0, holdings: { JAKE: 10 }, shorts: {} };
    const prices = { JAKE: 50 };
    expect(calculatePortfolioValue(user, prices)).toBe(500);
  });

  it('v2 short in profit adds to portfolio value', () => {
    const user = {
      cash: 0,
      holdings: {},
      shorts: {
        JAKE: { shares: 10, costBasis: 100, margin: 500, system: 'v2' }
      }
    };
    const prices = { JAKE: 80 };
    // margin + (entryPrice - currentPrice) * shares = 500 + (100-80)*10 = 700
    expect(calculatePortfolioValue(user, prices)).toBe(700);
  });

  it('v2 short at a loss reduces portfolio value', () => {
    const user = {
      cash: 0,
      holdings: {},
      shorts: {
        JAKE: { shares: 10, costBasis: 80, margin: 500, system: 'v2' }
      }
    };
    const prices = { JAKE: 100 };
    // 500 + (80-100)*10 = 300
    expect(calculatePortfolioValue(user, prices)).toBe(300);
  });

  it('returns 0 for null inputs', () => {
    expect(calculatePortfolioValue(null, {})).toBe(0);
    expect(calculatePortfolioValue({ cash: 0 }, null)).toBe(0);
  });
});

// ─── calculateMarginStatus ────────────────────────────────────────────────────

describe('calculateMarginStatus', () => {
  it('returns disabled status when margin is not enabled', () => {
    const status = calculateMarginStatus({ marginEnabled: false }, {});
    expect(status.enabled).toBe(false);
    expect(status.status).toBe('disabled');
  });

  it('returns safe status when margin is enabled with no debt', () => {
    const user = {
      marginEnabled: true,
      cash: 5000,
      holdings: {},
      marginUsed: 0,
      peakPortfolioValue: 0,
    };
    const status = calculateMarginStatus(user, {});
    expect(status.status).toBe('safe');
    expect(status.enabled).toBe(true);
  });

  it('returns warning when equity ratio drops to warning threshold', () => {
    // equityRatio = (cash - marginUsed) / cash
    // Warning threshold = 0.65, Danger threshold = 0.40
    // Use marginUsed = 4000 → equityRatio = 6000/10000 = 0.60 → falls in warning zone
    const user = {
      marginEnabled: true,
      cash: 10000,
      holdings: {},
      marginUsed: 4000,
      peakPortfolioValue: 0,
    };
    const status = calculateMarginStatus(user, {});
    expect(status.status).toBe('warning');
  });

  it('available margin is zero when max borrowable is already used', () => {
    const user = {
      marginEnabled: true,
      cash: 4000,
      holdings: {},
      marginUsed: 1000,   // Bronze tier: 0.25 * 4000 = 1000 max → 0 available
      peakPortfolioValue: 0,
    };
    const status = calculateMarginStatus(user, {});
    expect(status.availableMargin).toBe(0);
  });

  it('higher peak portfolio = higher tier multiplier = more available margin', () => {
    const base = {
      marginEnabled: true,
      cash: 10000,
      holdings: {},
      marginUsed: 0,
    };
    const bronze = calculateMarginStatus({ ...base, peakPortfolioValue: 0 }, {});
    const platinum = calculateMarginStatus({ ...base, peakPortfolioValue: 50000 }, {});
    expect(platinum.availableMargin).toBeGreaterThan(bronze.availableMargin);
  });
});

// ─── calculatePriceImpactDollars (the live trade-preview impact) ────────────────

describe('calculatePriceImpactDollars', () => {
  it('returns a positive dollar impact for any trade', () => {
    expect(calculatePriceImpactDollars(100, 10)).toBeGreaterThan(0);
  });

  it('larger trades move the price more', () => {
    const small = calculatePriceImpactDollars(100, 10);
    const large = calculatePriceImpactDollars(100, 100);
    expect(large).toBeGreaterThan(small);
  });

  it('prior cumulative volume reduces the marginal impact of the next trade', () => {
    const fresh = calculatePriceImpactDollars(100, 10, 100, 0);
    const afterBig = calculatePriceImpactDollars(100, 10, 100, 500);
    expect(afterBig).toBeLessThan(fresh);
  });

  it('caps a single trade at 5% of price, matching the backend', () => {
    // A massive trade would blow past 5% without the cap; the preview must not
    // quote more impact than the backend actually applies.
    const huge = calculatePriceImpactDollars(100, 1000000);
    expect(huge).toBeCloseTo(100 * 0.05, 5);
  });
});

// ─── getShortLiquidationPrice (the short force-cover price) ──────────────────────

describe('getShortLiquidationPrice', () => {
  it('returns null for an empty position', () => {
    expect(getShortLiquidationPrice(0, 100, 0)).toBe(null);
  });

  it('force-covers ~60% above entry with 100% collateral', () => {
    // margin = entryPrice * shares (dollar-for-dollar collateral)
    const liq = getShortLiquidationPrice(1000, 100, 10);
    expect(liq).toBeCloseTo(160, 5); // 1.6x the $100 entry
  });
});

// ─── getCurrentPrice ────────────────────────────────────────────────────────────

describe('getCurrentPrice', () => {
  it('prefers the latest price-history entry', () => {
    const history = { JAKE: [{ price: 10, ts: 1 }, { price: 12, ts: 2 }] };
    expect(getCurrentPrice('JAKE', history, {})).toBe(12);
  });

  it('falls back to the prices map when there is no history', () => {
    expect(getCurrentPrice('JAKE', {}, { JAKE: 7 })).toBe(7);
  });

  it('returns 0 for an unknown ticker with no data', () => {
    expect(getCurrentPrice('ZZZ_NOT_A_TICKER', {}, {})).toBe(0);
  });
});

// ─── margin tiers ───────────────────────────────────────────────────────────────

describe('getMarginTierMultiplier / getMarginTierName', () => {
  it('maps peak portfolio value to the right multiplier', () => {
    expect(getMarginTierMultiplier(0)).toBe(0.25);
    expect(getMarginTierMultiplier(8000)).toBe(0.35);
    expect(getMarginTierMultiplier(20000)).toBe(0.50);
    expect(getMarginTierMultiplier(50000)).toBe(0.75);
  });

  it('names the tiers consistently', () => {
    expect(getMarginTierName(0)).toBe('Bronze (0.25x)');
    expect(getMarginTierName(50000)).toBe('Platinum (0.75x)');
  });
});

// ─── checkMarginEligibility ─────────────────────────────────────────────────────

describe('checkMarginEligibility', () => {
  it('returns not-eligible with no requirements for null user', () => {
    const result = checkMarginEligibility(null);
    expect(result.eligible).toBe(false);
    expect(result.requirements).toEqual([]);
  });

  it('always eligible for admins', () => {
    expect(checkMarginEligibility({}, true).eligible).toBe(true);
  });

  it('eligible when all three thresholds are met', () => {
    const user = { totalCheckins: 10, totalTrades: 35, peakPortfolioValue: 7500 };
    expect(checkMarginEligibility(user).eligible).toBe(true);
  });

  it('not eligible when any threshold is missed', () => {
    const user = { totalCheckins: 10, totalTrades: 34, peakPortfolioValue: 7500 };
    expect(checkMarginEligibility(user).eligible).toBe(false);
  });
});

// ─── LMSR event-market pricing ────────────────────────────────────────────────

describe('LMSR event-market pricing', () => {
  const b = 1000;

  it('starts at even odds summing to 1', () => {
    const p = lmsrPrices([0, 0], b);
    expect(p[0]).toBeCloseTo(0.5, 6);
    expect(p[0] + p[1]).toBeCloseTo(1, 9);
  });

  it('keeps multi-outcome prices summing to 1', () => {
    const p = lmsrPrices([300, 100, 50], b);
    expect(p.reduce((a, c) => a + c, 0)).toBeCloseTo(1, 9);
  });

  it('raises an outcome price when it is bought', () => {
    const before = lmsrPrices([0, 0], b)[0];
    const after = lmsrPrices([100, 0], b)[0];
    expect(after).toBeGreaterThan(before);
  });

  it('is lossless on an immediate buy then sell', () => {
    const cost = lmsrBuyCost([0, 0], b, 0, 100);
    const refund = lmsrSellRefund([100, 0], b, 0, 100);
    expect(refund).toBeCloseTo(cost, 9);
  });

  it('bounds the house loss at b*ln(n)', () => {
    const shares = 5000; // redeem value if this outcome wins
    const collected = lmsrBuyCost([0, 0], b, 0, shares);
    const houseLoss = shares - collected; // payout minus what the AMM took in
    expect(houseLoss).toBeLessThanOrEqual(b * Math.log(2) + 1e-6);
  });
});
