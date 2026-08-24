import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// tradePricing is pure roster maths — no Firestore handle, no network.
const { computePriceUpdates } = require('./tradePricing');
const { CHARACTERS, CHARACTER_MAP } = require('../characters');

// $JIN, $SHNG and $GAP are mutually linked, which is what made the old
// depth-first walk order-dependent. Coefficients are read from the roster rather
// than hardcoded so re-weighting them does not break these tests.
const linkTo = (from, to) =>
  CHARACTER_MAP[from].trailingFactors.find((t) => t.ticker === to).coefficient;

const flatPrices = () => {
  const prices = {};
  CHARACTERS.forEach((c) => { prices[c.ticker] = 100; });
  return prices;
};

describe('computePriceUpdates trailing effects', () => {
  it('moves both direct links by their own coefficient, not by roster order', () => {
    // The bug this locks down: trading $JIN reached $GAP first, $GAP's own link
    // to $SHNG fired (0.2 x 0.2), $SHNG was marked visited, and $JIN's own 0.2
    // link to $SHNG was then skipped. $SHNG moved +0.20% where $GAP moved
    // +1.00%, off identical coefficients, purely because $GAP is typed first in
    // src/characters.js.
    const updates = computePriceUpdates({
      ticker: 'JIN', currentPrice: 100, newPrice: 105, prices: flatPrices(),
    });
    expect(updates.GAP).toBeCloseTo(100 * (1 + 0.05 * linkTo('JIN', 'GAP')), 2);
    expect(updates.SHNG).toBeCloseTo(100 * (1 + 0.05 * linkTo('JIN', 'SHNG')), 2);
  });

  it('gives equally linked stocks the same move', () => {
    expect(linkTo('JIN', 'GAP')).toBe(linkTo('JIN', 'SHNG'));
    const updates = computePriceUpdates({
      ticker: 'JIN', currentPrice: 100, newPrice: 105, prices: flatPrices(),
    });
    expect(updates.GAP).toBe(updates.SHNG);
  });

  it('does not depend on the order links are listed in', () => {
    const prices = flatPrices();
    const before = computePriceUpdates({ ticker: 'JIN', currentPrice: 100, newPrice: 105, prices });

    const original = CHARACTER_MAP.JIN.trailingFactors;
    CHARACTER_MAP.JIN.trailingFactors = [...original].reverse();
    try {
      const after = computePriceUpdates({ ticker: 'JIN', currentPrice: 100, newPrice: 105, prices });
      expect(after).toEqual(before);
    } finally {
      CHARACTER_MAP.JIN.trailingFactors = original;
    }
  });

  it('reaches stocks that are only linked indirectly', () => {
    // JIN does not link to KTAE. GAP does, and JIN links to GAP.
    const updates = computePriceUpdates({
      ticker: 'JIN', currentPrice: 100, newPrice: 105, prices: flatPrices(),
    });
    expect(updates.KTAE).toBeGreaterThan(100);
  });

  it('carries the direction of the move', () => {
    const updates = computePriceUpdates({
      ticker: 'JIN', currentPrice: 100, newPrice: 95, prices: flatPrices(),
    });
    expect(updates.GAP).toBeLessThan(100);
    expect(updates.SHNG).toBeLessThan(100);
  });

  it('returns only the traded ticker when nothing moved', () => {
    const updates = computePriceUpdates({
      ticker: 'JIN', currentPrice: 100, newPrice: 100, prices: flatPrices(),
    });
    expect(updates).toEqual({ JIN: 100 });
  });

  it('skips stocks with no live price', () => {
    const updates = computePriceUpdates({
      ticker: 'JIN', currentPrice: 100, newPrice: 105, prices: { JIN: 100, GAP: 100 },
    });
    expect(updates.GAP).toBeGreaterThan(100);
    expect(updates.SHNG).toBeUndefined();
  });

  it('never lets a price fall below the floor', () => {
    const prices = flatPrices();
    prices.GAP = 0.01;
    prices.SHNG = 0.01;
    const updates = computePriceUpdates({ ticker: 'JIN', currentPrice: 100, newPrice: 1, prices });
    Object.values(updates).forEach((p) => expect(p).toBeGreaterThanOrEqual(0.01));
  });
});

describe('computePriceUpdates ETF propagation', () => {
  const etfOf = (stock) =>
    CHARACTERS.find((c) => c.isETF && c.trailingFactors?.some((t) => t.ticker === stock));

  it('drags a parent ETF when a constituent moves', () => {
    // $GAP sits inside $FIST. Trading the stock has to move the fund.
    const etf = etfOf('GAP');
    expect(etf).toBeDefined();
    const updates = computePriceUpdates({
      ticker: 'GAP', currentPrice: 100, newPrice: 105, prices: flatPrices(),
    });
    expect(updates[etf.ticker]).toBeGreaterThan(100);
  });

  it('does not feed an ETF move back into the traded ticker', () => {
    const updates = computePriceUpdates({
      ticker: 'GAP', currentPrice: 100, newPrice: 105, prices: flatPrices(),
    });
    expect(updates.GAP).toBe(105);
  });

  it('leaves a traded ETF at the price the trade set', () => {
    const etf = CHARACTERS.find((c) => c.isETF && c.trailingFactors?.length);
    const updates = computePriceUpdates({
      ticker: etf.ticker, currentPrice: 100, newPrice: 105, prices: flatPrices(),
    });
    expect(updates[etf.ticker]).toBe(105);
  });

  it('totals every constituent instead of compounding them in roster order', () => {
    // Several constituents of one fund move on the same trade. The fund has to
    // land in the same place whichever of them the walk reaches first.
    const etf = etfOf('GAP');
    const prices = flatPrices();
    const forward = computePriceUpdates({ ticker: 'GAP', currentPrice: 100, newPrice: 105, prices });

    const original = etf.trailingFactors;
    etf.trailingFactors = [...original].reverse();
    try {
      const reversed = computePriceUpdates({ ticker: 'GAP', currentPrice: 100, newPrice: 105, prices });
      expect(reversed[etf.ticker]).toBe(forward[etf.ticker]);
    } finally {
      etf.trailingFactors = original;
    }
  });
});
