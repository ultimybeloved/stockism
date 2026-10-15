import { describe, expect, it } from 'vitest';
import { summarizeWeek, toRedditMarkdown, weekLabel, weekWindow } from './weeklyChanges';
import type { AdminLogEntry } from '../../../api/types';

const at = (iso: string) => Date.parse(iso);
const adjust = (iso: string, ticker: string, from: number, to: number): AdminLogEntry => ({
  id: `${ticker}-${iso}`,
  at: at(iso),
  action: 'adjust_price',
  by: 'admin',
  uid: null,
  name: null,
  before: { ticker, price: from },
  after: { ticker, price: to },
  detail: null,
});

describe('weekWindow', () => {
  it('uses last week before the review starts and this week once it has', () => {
    expect(weekWindow(0, at('2026-10-15T12:59:00Z')).end).toBe(at('2026-10-08T21:00:00Z'));
    expect(weekWindow(0, at('2026-10-15T13:00:00Z')).end).toBe(at('2026-10-15T21:00:00Z'));
    expect(weekWindow(0, at('2026-10-18T09:00:00Z')).end).toBe(at('2026-10-15T21:00:00Z'));
  });

  it('steps a week at a time and runs review close to review close', () => {
    const w = weekWindow(1, at('2026-10-15T15:00:00Z'));
    expect(w).toEqual({ start: at('2026-10-01T21:00:00Z'), end: at('2026-10-08T21:00:00Z') });
    expect(weekWindow(-1, at('2026-10-15T15:00:00Z')).end).toBe(at('2026-10-22T21:00:00Z'));
    expect(weekLabel(w)).toBe('Oct 1 to Oct 8, 2026');
  });
});

describe('summarizeWeek', () => {
  const week = { start: at('2026-10-08T21:00:00Z'), end: at('2026-10-15T21:00:00Z') };

  it('compounds repeat edits on one stock and ignores trading between them', () => {
    const rows = summarizeWeek(
      [adjust('2026-10-15T14:00:00Z', 'GAP', 100, 110), adjust('2026-10-15T15:00:00Z', 'GAP', 120, 132)],
      week,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ticker: 'GAP', from: 100, to: 132, edits: 2 });
    expect(rows[0].percent).toBeCloseTo(21);
  });

  it('keeps only price edits inside the week, biggest move first', () => {
    const rows = summarizeWeek(
      [
        adjust('2026-10-08T20:00:00Z', 'OLD', 10, 20),
        adjust('2026-10-15T14:00:00Z', 'JAKE', 100, 99),
        adjust('2026-10-15T14:05:00Z', 'VIN', 100, 90),
        adjust('2026-10-15T14:10:00Z', 'ZACK', 100, 100),
        { ...adjust('2026-10-15T14:00:00Z', 'X', 1, 2), action: 'create_ipo' },
      ],
      week,
    );
    expect(rows.map((r) => r.ticker)).toEqual(['VIN', 'JAKE']);
  });

  it('writes a markdown table with risers first', () => {
    const rows = summarizeWeek(
      [adjust('2026-10-15T14:00:00Z', 'VIN', 100, 90), adjust('2026-10-15T14:00:00Z', 'GAP', 100, 105)],
      week,
    );
    const md = toRedditMarkdown(rows, week, { GAP: 'Gapryong Kim' });
    expect(md).toContain('| Gapryong Kim | $GAP | $100.00 | $105.00 | +5.00% |');
    expect(md.indexOf('$GAP')).toBeLessThan(md.indexOf('$VIN'));
    expect(md).toContain('1 up, 1 down.');
  });
});
