import { describe, it, expect } from 'vitest';
import {
  getDynamicPrices,
  getMaxShares,
  getCumulativeVolume,
  tradeBlockMessage,
  dailyImpactLeft,
  maxSharesInDailyLimit,
} from './tradeLimits';
import { estimateTradeTotal } from './calculations';
import { MAX_TRADE_SHARES, SHORT_MARGIN_REQUIREMENT, BID_ASK_SPREAD } from '../constants/economy';
import type { TradeAction } from '../types';

// The trade form and the confirmation dialog quote the player a price, and the
// server then charges them. All three have to agree. They did not: the form
// priced against the player's rolling 24h volume while the confirmation assumed
// a first trade, and the short preview took its collateral off the impacted bid
// while the server charges the current mid. These lock down the agreement.

const CHAR = { ticker: 'TEST', isETF: false, basePrice: 100 };
const PRICE = 100;

// A user who has already sold 200 shares of TEST in the rolling window.
const userWithVolume = (action: TradeAction, shares: number) => ({
  tickerTradeHistory: {
    TEST: { [action]: [{ ts: Date.now(), shares, impact: 0.01 }] },
  },
});

describe('getCumulativeVolume', () => {
  it('reads the rolling window for that ticker and action', () => {
    expect(getCumulativeVolume(userWithVolume('buy', 200), 'TEST', 'buy')).toBe(200);
  });

  it('does not leak across actions', () => {
    expect(getCumulativeVolume(userWithVolume('buy', 200), 'TEST', 'sell')).toBe(0);
  });

  it('ignores entries older than the window', () => {
    const stale = {
      tickerTradeHistory: {
        TEST: { buy: [{ ts: Date.now() - 25 * 60 * 60 * 1000, shares: 500, impact: 0.01 }] },
      },
    };
    expect(getCumulativeVolume(stale, 'TEST', 'buy')).toBe(0);
  });
});

describe('getDynamicPrices', () => {
  it('prices a buy above the mid and a sell below it', () => {
    const buy = getDynamicPrices(CHAR, PRICE, 10, 'buy', {});
    const sell = getDynamicPrices(CHAR, PRICE, 10, 'sell', {});
    expect(buy.ask).toBeGreaterThan(PRICE);
    expect(sell.bid).toBeLessThan(PRICE);
  });

  it('charges the marginal cost once the player has already moved the stock', () => {
    const first = getDynamicPrices(CHAR, PRICE, 10, 'buy', {});
    const later = getDynamicPrices(CHAR, PRICE, 10, 'buy', userWithVolume('buy', 200));
    // Impact is sqrt-shaped, so it is CONCAVE in cumulative volume: the next 10
    // shares after 200 move the price less than the first 10 did. That is the
    // whole point of the cumulative model — splitting an order costs the same
    // as placing it whole. Whatever the direction, the form and the server have
    // to use the same number.
    expect(later.ask).toBeLessThan(first.ask);
  });
});

// ─── The agreement that was broken ───────────────────────────────────────────

describe('trade form and confirmation agree', () => {
  it('buy: confirmation total matches the form quote at the same volume', () => {
    const userData = userWithVolume('buy', 200);
    const amount = 10;
    const { ask } = getDynamicPrices(CHAR, PRICE, amount, 'buy', userData);
    const total = estimateTradeTotal({
      action: 'buy',
      price: PRICE,
      amount,
      isETF: false,
      cumulativeVolume: getCumulativeVolume(userData, 'TEST', 'buy'),
    });
    expect(total).toBeCloseTo(ask * amount, 6);
  });

  it('sell: confirmation total matches the form quote at the same volume', () => {
    const userData = userWithVolume('sell', 150);
    const amount = 25;
    const { bid } = getDynamicPrices(CHAR, PRICE, amount, 'sell', userData);
    const total = estimateTradeTotal({
      action: 'sell',
      price: PRICE,
      amount,
      isETF: false,
      cumulativeVolume: getCumulativeVolume(userData, 'TEST', 'sell'),
    });
    expect(total).toBeCloseTo(bid * amount, 6);
  });

  it('ignoring cumulative volume misquotes a repeat buy', () => {
    const userData = userWithVolume('buy', 200);
    const amount = 10;
    const naive = estimateTradeTotal({ action: 'buy', price: PRICE, amount, isETF: false });
    const real = estimateTradeTotal({
      action: 'buy',
      price: PRICE,
      amount,
      isETF: false,
      cumulativeVolume: getCumulativeVolume(userData, 'TEST', 'buy'),
    });
    // The bug: the confirmation quoted `naive` (first-trade impact) while the
    // form and the server both used `real`. On a repeat trade that overstated
    // the cost, because marginal impact falls as cumulative volume rises.
    expect(real).toBeLessThan(naive);
    expect(real).not.toBeCloseTo(naive, 2);
  });
});

describe('estimateTradeTotal short collateral', () => {
  it('is the full current mid price, not the impacted bid', () => {
    const amount = 10;
    const total = estimateTradeTotal({ action: 'short', price: PRICE, amount, isETF: false });
    // Mirrors computeShort: currentPrice * amount * SHORT_MARGIN_RATIO.
    expect(total).toBeCloseTo(PRICE * amount * SHORT_MARGIN_REQUIREMENT, 6);
  });

  it('is not reduced by the spread', () => {
    const amount = 10;
    const total = estimateTradeTotal({ action: 'short', price: PRICE, amount, isETF: false });
    const impactedBid = PRICE * (1 - BID_ASK_SPREAD / 2) * amount * SHORT_MARGIN_REQUIREMENT;
    expect(total).toBeGreaterThan(impactedBid);
  });
});

// ─── The order-size ceiling ──────────────────────────────────────────────────

describe('getMaxShares respects MAX_TRADE_SHARES', () => {
  const base = {
    character: CHAR,
    price: PRICE,
    prices: { TEST: PRICE },
    priceHistory: {},
  };

  it('caps a sell by a holder above the ceiling', () => {
    const max = getMaxShares({
      ...base,
      action: 'sell',
      holdings: MAX_TRADE_SHARES * 3,
      userCash: 0,
      userData: {},
    });
    expect(max).toBe(MAX_TRADE_SHARES);
  });

  it('caps a cover on an oversized short position', () => {
    const max = getMaxShares({
      ...base,
      action: 'cover',
      holdings: 0,
      shortPosition: { shares: MAX_TRADE_SHARES * 2 },
      userCash: 0,
      userData: {},
    });
    expect(max).toBe(MAX_TRADE_SHARES);
  });

  it('caps a buy backed by more cash than the ceiling allows', () => {
    const max = getMaxShares({
      ...base,
      action: 'buy',
      holdings: 0,
      userCash: PRICE * MAX_TRADE_SHARES * 5,
      userData: {},
      includeMargin: false,
    });
    expect(max).toBe(MAX_TRADE_SHARES);
  });

  it('still returns the real figure when it is under the ceiling', () => {
    const max = getMaxShares({
      ...base,
      action: 'sell',
      holdings: 42,
      userCash: 0,
      userData: {},
    });
    expect(max).toBe(42);
  });

  it('subtracts locked shares before capping', () => {
    const until = Date.now() + 60 * 60 * 1000;
    const max = getMaxShares({
      ...base,
      action: 'sell',
      holdings: 100,
      userCash: 0,
      userData: { ipoLockup: { TEST: { shares: 30, until } } },
    });
    expect(max).toBe(70);
  });
});

// The server refuses these with a timed message. The trade window has to show
// the same block, with the same time left, before the button is pressed.
describe('trade blocks shown before the order is sent', () => {
  const now = Date.UTC(2026, 9, 25, 12, 0);
  const HOUR = 3600 * 1000;

  it('wash rule: a market buy is blocked, a limit buy is told it will wait', () => {
    const u = { lastHeavySell: { TEST: now - 2 * HOUR } } as never;
    expect(tradeBlockMessage(u, 'TEST', 'buy', PRICE, { now })).toBe(
      "Wash rule: you pushed $TEST down recently, so you can't buy it back for 46h 0m.",
    );
    expect(tradeBlockMessage(u, 'TEST', 'buy', PRICE, { now, limit: true })).toMatch(/will wait/);
    expect(tradeBlockMessage(u, 'TEST', 'sell', PRICE, { now })).toBeNull();
    expect(tradeBlockMessage(u, 'TEST', 'buy', PRICE, { now: now + 47 * HOUR })).toBeNull();
  });

  it('no shorting after a dump, and 3 shorts per 8 hours', () => {
    const dumped = { lastHeavyExit: { TEST: { toMillis: () => now - HOUR } } } as never;
    expect(tradeBlockMessage(dumped, 'TEST', 'short', PRICE, { now })).toMatch(/can't short it for 47h 0m/);
    const shorts = { shortHistory: { TEST: [now - 7 * HOUR, now - HOUR, now - 30 * 60000] } } as never;
    expect(tradeBlockMessage(shorts, 'TEST', 'short', PRICE, { now })).toMatch(/short it again in 1h 0m/);
    expect(tradeBlockMessage(shorts, 'TEST', 'short', PRICE, { now: now + HOUR + 1 })).toBeNull();
  });

  it("today's move limit caps a buy, and blocks it once used up", () => {
    const some = { tickerTradeHistory: { TEST: { buy: [{ ts: now - HOUR, shares: 1, impact: 0.08 }] } } };
    expect(dailyImpactLeft(some, 'TEST', 'buy', now)).toBeCloseTo(0.02);
    expect(dailyImpactLeft(some, 'TEST', 'sell', now)).toBeCloseTo(0.1); // down has its own 10%
    const cap = maxSharesInDailyLimit(some, 'TEST', PRICE, 'buy', now);
    expect(cap).toBeGreaterThan(0);
    expect(cap).toBeLessThan(maxSharesInDailyLimit({}, 'TEST', PRICE, 'buy', now));
    expect(maxSharesInDailyLimit(some, 'TEST', PRICE, 'sell', now)).toBe(Infinity);
    const used = {
      tickerTradeHistory: {
        TEST: {
          buy: [{ ts: now - HOUR, shares: 1, impact: 0.06 }],
          cover: [{ ts: now - HOUR, shares: 1, impact: 0.04 }],
        },
      },
    };
    expect(tradeBlockMessage(used, 'TEST', 'buy', PRICE, { now })).toMatch(/used today's limit/);
    expect(tradeBlockMessage(used, 'TEST', 'buy', PRICE, { now, limit: true })).toBeNull();
  });
});
