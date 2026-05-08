import { describe, it, expect } from 'vitest';
import {
  calculatePriceImpact,
  getBidAskPrices,
  calculateNewPrice,
  calculatePortfolioValue,
  calculateMarginStatus,
} from './calculations';

// ─── calculatePriceImpact ──────────────────────────────────────────────────────

describe('calculatePriceImpact', () => {
  it('returns positive impact for any trade', () => {
    expect(calculatePriceImpact(10, 100)).toBeGreaterThan(0);
  });

  it('larger trades have larger impact', () => {
    const small = calculatePriceImpact(10, 100);
    const large = calculatePriceImpact(100, 100);
    expect(large).toBeGreaterThan(small);
  });

  it('impact is capped at MAX_PRICE_CHANGE_PERCENT (0.05)', () => {
    // Very large trade should hit the cap
    expect(calculatePriceImpact(100000, 100)).toBeLessThanOrEqual(0.05);
  });

  it('cumulative volume reduces marginal impact', () => {
    const fresh = calculatePriceImpact(10, 100, 1, 0);
    const afterBig = calculatePriceImpact(10, 100, 1, 500);
    expect(afterBig).toBeLessThan(fresh);
  });

  it('higher volatility multiplier increases impact', () => {
    const base = calculatePriceImpact(10, 100, 1);
    const hot = calculatePriceImpact(10, 100, 2);
    expect(hot).toBeGreaterThan(base);
  });

  it('higher priced stocks (>$50) have higher liquidity → lower impact', () => {
    const cheap = calculatePriceImpact(10, 10);
    const expensive = calculatePriceImpact(10, 200);
    expect(expensive).toBeLessThan(cheap);
  });
});

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

// ─── calculateNewPrice ────────────────────────────────────────────────────────

describe('calculateNewPrice', () => {
  it('buy raises the price', () => {
    const newPrice = calculateNewPrice(100, 10, true);
    expect(newPrice).toBeGreaterThan(100);
  });

  it('sell lowers the price', () => {
    const newPrice = calculateNewPrice(100, 10, false);
    expect(newPrice).toBeLessThan(100);
  });

  it('result is rounded to 2 decimal places', () => {
    const newPrice = calculateNewPrice(100, 7, true);
    expect(newPrice).toBe(Math.round(newPrice * 100) / 100);
  });

  it('price never goes below MIN_PRICE (0.01)', () => {
    // Sell a huge amount of a penny stock
    const newPrice = calculateNewPrice(0.01, 100000, false);
    expect(newPrice).toBeGreaterThanOrEqual(0.01);
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
    // Warning threshold = 0.35 → need (cash - marginUsed) / cash ≈ 0.34
    const user = {
      marginEnabled: true,
      cash: 10000,
      holdings: {},
      marginUsed: 6700,   // equity = 3300/10000 = 0.33 → below warning (0.35)
      peakPortfolioValue: 0,
    };
    const status = calculateMarginStatus(user, {});
    expect(['warning', 'margin_call', 'liquidation']).toContain(status.status);
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
