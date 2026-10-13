import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type Mod = typeof import('./dividends');
let dividendWeekKey: Mod['dividendWeekKey'];
let computeDividend: Mod['computeDividend'];

beforeAll(() => {
  const admin = require('firebase-admin');
  if (!admin.apps.length) admin.initializeApp({ projectId: 'dividend-test' });
  ({ dividendWeekKey, computeDividend } = require('./dividends') as Mod);
});

const DAY = 24 * 60 * 60 * 1000;

describe('dividendWeekKey', () => {
  it('gives every moment from one Thursday to the next the same key', () => {
    const thu = Date.UTC(2026, 9, 15, 12, 58); // Thu 2026-10-15
    expect(dividendWeekKey(thu)).toBe('2026-10-15');
    expect(dividendWeekKey(thu + 2 * 60 * 1000)).toBe('2026-10-15'); // re-run minutes later
    expect(dividendWeekKey(thu + 6 * DAY)).toBe('2026-10-15'); // following Wednesday
    expect(dividendWeekKey(Date.UTC(2026, 9, 22, 0, 0))).toBe('2026-10-22'); // next Thursday
    expect(dividendWeekKey(Date.UTC(2026, 9, 14, 23, 59))).toBe('2026-10-08'); // Wednesday before
  });
});

describe('computeDividend', () => {
  const now = Date.UTC(2026, 9, 15, 12, 58);
  const rateFor = () => 0.01;

  it('pays nothing on shares still inside the holding period', () => {
    const r = computeDividend(
      {
        holdings: { AAA: 10 },
        holdingCohorts: { AAA: { eligible: 0, pending: [{ shares: 10, availableAt: now + DAY }] } },
      },
      now,
      { AAA: 100 },
      rateFor,
    );
    expect(r.totalPaid).toBe(0);
    expect(r.cohortUpdates.AAA!.pending[0]!.shares).toBe(10);
  });

  it('puts unaccounted shares into a fresh pending lot rather than paying on them', () => {
    const r = computeDividend({ holdings: { AAA: 5 }, holdingCohorts: {} }, now, { AAA: 100 }, rateFor);
    expect(r.totalPaid).toBe(0);
    expect(r.cohortUpdates.AAA!.pending).toHaveLength(1);
  });

  it('skips stocks with no snapshot price and books paid value as granted', () => {
    const data = {
      holdings: { AAA: 10, BBB: 10 },
      holdingCohorts: { AAA: { eligible: 10, pending: [] }, BBB: { eligible: 10, pending: [] } },
    };
    const r = computeDividend(data, now, { AAA: 100 }, rateFor);
    expect(r.payoutsByTicker.BBB).toBeUndefined();
    expect(r.totalPaid).toBeGreaterThan(0);
    expect(r.grantedTotal).toBe(r.totalPaid);
  });
});
