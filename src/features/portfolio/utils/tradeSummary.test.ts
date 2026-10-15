import { describe, it, expect } from 'vitest';
import { recentlyClosed, summarizeStock } from './tradeSummary';
import type { PlayerTrade } from '../hooks/usePlayerTrades';

const t = (over: Partial<PlayerTrade>): PlayerTrade => ({
  id: Math.random().toString(),
  action: 'buy',
  ticker: 'GOO',
  amount: 10,
  price: 10,
  timestamp: 1000,
  ...over,
});

describe('summarizeStock', () => {
  it('adds up buys, sells and booked profit', () => {
    const s = summarizeStock([
      t({ action: 'buy', amount: 10, price: 10, timestamp: 1000 }),
      t({ action: 'sell', amount: 4, price: 15, profitPercent: 50, timestamp: 3000 }),
      t({ action: 'buy', amount: 2, price: 12, timestamp: 2000 }),
    ]);
    expect(s.bought).toBe(12);
    expect(s.spent).toBe(124);
    expect(s.sold).toBe(4);
    expect(s.received).toBe(60);
    expect(s.realized).toBeCloseTo(30);
    expect(s.first).toBe(1000);
    expect(s.last).toBe(3000);
  });
});

describe('recentlyClosed', () => {
  it('lists only stocks no longer held, newest first', () => {
    const rows = recentlyClosed(
      [
        t({ ticker: 'GOO', action: 'sell', amount: 5, price: 20, costBasisAtTrade: 10, timestamp: 5000 }),
        t({ ticker: 'JAKE', action: 'sell', amount: 1, price: 8, costBasisAtTrade: 10, timestamp: 7000 }),
        t({ ticker: 'DG', action: 'sell', amount: 1, price: 8, timestamp: 9000 }),
      ],
      { DG: 3 },
    );
    expect(rows.map((r) => r.ticker)).toEqual(['JAKE', 'GOO']);
    expect(rows[1]!.realized).toBe(50);
    expect(rows[0]!.realized).toBe(-2);
  });
});
