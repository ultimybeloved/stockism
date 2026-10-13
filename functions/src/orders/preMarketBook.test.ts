import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// The module grabs a Firestore handle at load; applyBookChanges itself is pure.
let B: typeof import('./preMarketBook');

beforeAll(() => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'book-test' });
  B = require('./preMarketBook') as typeof import('./preMarketBook');
});

const TODAY = '2026-10-15';

describe('applyBookChanges', () => {
  it('adds a queued order to the ticker totals', () => {
    const out = B.applyBookChanges(undefined, TODAY, [
      { ticker: 'JAY', action: 'buy', shares: 10, sign: 1, session: TODAY },
      { ticker: 'JAY', action: 'sell', shares: 4, sign: 1, session: TODAY },
    ]);
    expect(out).toEqual({ session: TODAY, tickers: { JAY: { buy: 10, sell: 4, orders: 2 } } });
  });

  it('starts fresh when the stored book is from an older session', () => {
    const old = { session: '2026-10-08', tickers: { JAY: { buy: 500, sell: 0, orders: 9 } } };
    const out = B.applyBookChanges(old, TODAY, [{ ticker: 'JAY', action: 'buy', shares: 1, sign: 1, session: TODAY }]);
    expect(out.tickers.JAY).toEqual({ buy: 1, sell: 0, orders: 1 });
  });

  it('removes a cancelled order and never goes below zero', () => {
    const cur = { session: TODAY, tickers: { JAY: { buy: 10, sell: 0, orders: 1 } } };
    const once = B.applyBookChanges(cur, TODAY, [
      { ticker: 'JAY', action: 'buy', shares: 10, sign: -1, session: TODAY },
    ]);
    expect(once.tickers.JAY).toEqual({ buy: 0, sell: 0, orders: 0 });
    const twice = B.applyBookChanges(once, TODAY, [
      { ticker: 'JAY', action: 'buy', shares: 10, sign: -1, session: TODAY },
    ]);
    expect(twice.tickers.JAY).toEqual({ buy: 0, sell: 0, orders: 0 });
  });

  it("ignores an old session's order leaving the queue", () => {
    const cur = { session: TODAY, tickers: { JAY: { buy: 10, sell: 0, orders: 1 } } };
    const out = B.applyBookChanges(cur, TODAY, [
      { ticker: 'JAY', action: 'buy', shares: 10, sign: -1, session: '2026-10-08' },
    ]);
    expect(out.tickers.JAY).toEqual({ buy: 10, sell: 0, orders: 1 });
  });

  it('keeps other tickers untouched', () => {
    const cur = { session: TODAY, tickers: { GUN: { buy: 3, sell: 1, orders: 2 } } };
    const out = B.applyBookChanges(cur, TODAY, [{ ticker: 'JAY', action: 'sell', shares: 2, sign: 1, session: TODAY }]);
    expect(out.tickers.GUN).toEqual({ buy: 3, sell: 1, orders: 2 });
  });
});
