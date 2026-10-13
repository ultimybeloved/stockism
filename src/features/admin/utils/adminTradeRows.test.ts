import { describe, it, expect } from 'vitest';
import { botLogToRows, ipoLedgerToRow, matchesFilters, tradeRecordToRow } from './adminTradeRows';

const ts = (ms: number) => ({ toMillis: () => ms });

describe('tradeRecordToRow', () => {
  it('maps a manual buy', () => {
    const row = tradeRecordToRow('t1', {
      uid: 'u1',
      action: 'buy',
      ticker: 'JAY',
      amount: 5,
      price: 10,
      totalValue: 50,
      timestamp: ts(1000),
    });
    expect(row).toMatchObject({ type: 'BUY', source: 'manual', ticker: 'JAY', shares: 5, total: 50, timestamp: 1000 });
  });

  it('keeps the order source on limit, stop-loss and auction fills', () => {
    for (const source of ['limit', 'stop_loss', 'premarket']) {
      expect(tradeRecordToRow('t', { uid: 'u', action: 'sell', source, timestamp: ts(1) })?.source).toBe(source);
    }
  });

  it('labels forced margin closes', () => {
    expect(tradeRecordToRow('t', { uid: 'u', action: 'margin_call_cover', timestamp: ts(1) })).toMatchObject({
      type: 'SHORT_CLOSE',
      source: 'margin_call',
    });
    expect(tradeRecordToRow('t', { uid: 'u', action: 'margin_liquidation', totalValue: 80 })).toMatchObject({
      type: 'LIQUIDATION',
      total: 80,
    });
  });

  it('skips dividends', () => {
    expect(tradeRecordToRow('t', { uid: 'u', action: 'dividend' })).toBeNull();
  });
});

describe('ipoLedgerToRow', () => {
  it('turns an IPO purchase into a buy at cost per share', () => {
    const row = ipoLedgerToRow('l1', { uid: 'u', ref: 'NEW', amount: -120, detail: { shares: 4 }, timestamp: ts(5) });
    expect(row).toMatchObject({ type: 'BUY', source: 'ipo', ticker: 'NEW', shares: 4, price: 30, total: 120 });
  });
});

describe('botLogToRows', () => {
  it('keeps trades and drops other log entries', () => {
    const rows = botLogToRows('b1', 'Bot A', [
      { type: 'BUY', ticker: 'JAY', shares: 2, pricePerShare: 3, totalCost: 6, timestamp: 9 },
      { type: 'CHECKIN', timestamp: 10 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ isBot: true, source: 'bot', total: 6 });
  });
});

describe('matchesFilters', () => {
  const row = botLogToRows('b', 'B', [{ type: 'SELL', ticker: 'JAY', timestamp: 100 }])[0]!;
  it('applies time, type and ticker', () => {
    expect(matchesFilters(row, 50, 'all', '')).toBe(true);
    expect(matchesFilters(row, 150, 'all', '')).toBe(false);
    expect(matchesFilters(row, 0, 'BUY', '')).toBe(false);
    expect(matchesFilters(row, 0, 'SELL', 'jay')).toBe(true);
    expect(matchesFilters(row, 0, 'all', 'GUN')).toBe(false);
  });
});
