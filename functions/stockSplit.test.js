import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'offline-test' });

const {
  splitPrice, splitShares, splitPoints, splitTradeHistory,
  buildUserSplitUpdates, buildMarketSplitUpdates, buildOrderSplitUpdates, buildTradeSplitUpdates,
} = require('./services/stockSplit');

describe('stock split arithmetic', () => {
  it('divides prices and multiplies shares, value unchanged', () => {
    expect(splitPrice(2190.92, 10)).toBe(219.092);
    expect(splitShares(3660.54, 10)).toBe(36605.4);
    expect(splitShares(3660.54, 10) * splitPrice(2190.92, 10)).toBeCloseTo(3660.54 * 2190.92, 4);
  });

  it('rescales chart points and leaves everything else on them', () => {
    expect(splitPoints([{ timestamp: 1, price: 100, source: 'trade' }], 4)).toEqual([{ timestamp: 1, price: 25, source: 'trade' }]);
  });

  it('multiplies trade-history shares but not their impact', () => {
    expect(splitTradeHistory({ sell: [{ ts: 1, shares: 5, impact: 0.02 }] }, 10))
      .toEqual({ sell: [{ ts: 1, shares: 50, impact: 0.02 }] });
  });
});

describe('buildUserSplitUpdates', () => {
  const player = {
    holdings: { SHNG: 30, GOO: 5 },
    costBasis: { SHNG: 1800, GOO: 40 },
    lowestWhileHolding: { SHNG: 1500 },
    holdingCohorts: { SHNG: { eligible: 20, pending: [{ shares: 10, availableAt: 99 }] } },
    shorts: { SHNG: { shares: 4, costBasis: 2000, margin: 8000, system: 'v2' } },
    marginLockup: { SHNG: { shares: 3, until: 123 } },
    ipoPurchases: { SHNG: 2 },
    tickerTradeHistory: { SHNG: { buy: [{ ts: 1, shares: 7, impact: 0.01 }] } },
  };

  it('splits every SHNG field and leaves GOO alone', () => {
    const up = buildUserSplitUpdates(player, 'SHNG', 10, 's1');
    expect(up['holdings.SHNG']).toBe(300);
    expect(up['costBasis.SHNG']).toBe(180);
    expect(up['lowestWhileHolding.SHNG']).toBe(150);
    expect(up['holdingCohorts.SHNG']).toEqual({ eligible: 200, pending: [{ shares: 100, availableAt: 99 }] });
    // Short collateral is dollars and stays put; the entry price comes down.
    expect(up['shorts.SHNG']).toEqual({ shares: 40, costBasis: 200, margin: 8000, system: 'v2' });
    expect(up['marginLockup.SHNG']).toEqual({ shares: 30, until: 123 });
    expect(up['ipoPurchases.SHNG']).toBe(20);
    expect(up['tickerTradeHistory.SHNG']).toEqual({ buy: [{ ts: 1, shares: 70, impact: 0.01 }] });
    expect(up['splitsApplied.s1']).toBe(true);
    expect(Object.keys(up).some((k) => k.includes('GOO'))).toBe(false);
  });

  it('keeps what the position is worth and what it cost', () => {
    const up = buildUserSplitUpdates(player, 'SHNG', 10, 's1');
    expect(up['holdings.SHNG'] * splitPrice(2190.92, 10)).toBeCloseTo(30 * 2190.92, 6);
    expect(up['holdings.SHNG'] * up['costBasis.SHNG']).toBeCloseTo(30 * 1800, 6);
  });

  it('never applies the same split twice', () => {
    expect(buildUserSplitUpdates({ ...player, splitsApplied: { s1: true } }, 'SHNG', 10, 's1')).toEqual({});
  });

  it('writes nothing for someone with no stake', () => {
    expect(buildUserSplitUpdates({ holdings: { GOO: 5 } }, 'SHNG', 10, 's1')).toEqual({});
  });
});

describe('market, orders and trades', () => {
  it('market/current: price and records down, IPO volume up, others untouched', () => {
    const up = buildMarketSplitUpdates({
      prices: { SHNG: 2000, GOO: 50 }, ath: { SHNG: 2200 }, atl: { SHNG: 1300 }, volumes: { SHNG: 40 },
    }, 'SHNG', 10);
    expect(up).toEqual({ 'prices.SHNG': 200, 'ath.SHNG': 220, 'atl.SHNG': 130, 'volumes.SHNG': 400 });
  });

  it('an open limit order keeps its dollar size', () => {
    const up = buildOrderSplitUpdates({ shares: 51, filledShares: 0, limitPrice: 469.08 }, 10, 's1');
    expect(up.shares).toBe(510);
    expect(up.limitPrice).toBe(46.908);
    expect(buildOrderSplitUpdates({ shares: 5, splitsApplied: { s1: true } }, 10, 's1')).toEqual({});
  });

  it('a trade record keeps its total', () => {
    const up = buildTradeSplitUpdates({ amount: 100, price: 150, totalValue: 15000 }, 10, 's1');
    expect(up.amount).toBe(1000);
    expect(up.price).toBe(15);
    expect(up.totalValue).toBeUndefined();
  });
});
