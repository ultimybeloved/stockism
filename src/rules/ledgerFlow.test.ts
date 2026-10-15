import { describe, expect, it } from 'vitest';
import { lastDays, ledgerTypeInfo, rollupLedger, utcDay } from './ledgerFlow';

describe('rollupLedger', () => {
  it('splits money in and out per account and type', () => {
    const day = rollupLedger('2026-10-14', [
      { uid: 'a', type: 'checkin_reward', amount: 100 },
      { uid: 'b', type: 'checkin_reward', amount: 50.005 },
      { uid: 'a', type: 'trade_buy', amount: -250 },
      { uid: 'a', type: 'trade_buy', amount: 10 },
      { uid: 'c', type: 'ladder_deposit', account: 'ladder', amount: 40 },
    ]);
    expect(day.rows['cash:checkin_reward']).toEqual({ in: 150.01, out: 0, count: 2 });
    expect(day.rows['cash:trade_buy']).toEqual({ in: 10, out: 250, count: 2 });
    expect(day.rows['ladder:ladder_deposit']).toEqual({ in: 40, out: 0, count: 1 });
    expect(day.players).toBe(3);
  });

  it('skips zero and broken amounts', () => {
    const day = rollupLedger('2026-10-14', [
      { uid: 'a', type: 'x', amount: 0 },
      { uid: 'a', type: 'x', amount: Number.NaN },
      { uid: 'a', type: 'x' },
    ]);
    expect(day.rows).toEqual({});
    expect(day.players).toBe(0);
  });
});

describe('days', () => {
  it('lists UTC days oldest first', () => {
    const now = Date.UTC(2026, 9, 14, 23, 59);
    expect(utcDay(now)).toBe('2026-10-14');
    expect(lastDays(now, 3)).toEqual(['2026-10-12', '2026-10-13', '2026-10-14']);
  });
});

describe('ledgerTypeInfo', () => {
  it('labels known types and passes unknown ones through', () => {
    expect(ledgerTypeInfo('welcome_streak')).toEqual({ group: 'rewards', label: 'Welcome week' });
    expect(ledgerTypeInfo('brand_new_thing')).toEqual({ group: 'other', label: 'brand new thing' });
  });
});
