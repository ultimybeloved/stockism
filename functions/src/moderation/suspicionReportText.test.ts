import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildSuspicionReport, linkedGroups } =
  require('./suspicionReportText') as typeof import('./suspicionReportText');

const NOW = Date.parse('2026-10-28T16:00:00Z');
const DAY = 24 * 60 * 60 * 1000;

const pair = (a: string, b: string, ageDays = 1, extra = {}) => ({
  type: 'alt_suspected',
  severity: 'medium',
  reviewed: false,
  at: NOW - ageDays * DAY,
  watchedUID: a,
  relatedUID: b,
  ...extra,
});
const push = (ticker: string, names: string[], ageDays = 1, extra = {}) => ({
  type: 'coordinated_pressure',
  reviewed: false,
  at: NOW - ageDays * DAY,
  ticker,
  direction: 'down',
  combinedImpact: 11.4,
  day: '2026-10-27',
  participants: names,
  ...extra,
});
const member = (name: string, value = 1000, banned = false) => ({ name, value, banned });

describe('weekly suspicious-account report', () => {
  it('folds pairs into groups of linked accounts', () => {
    const groups = linkedGroups([pair('a', 'b'), pair('a', 'c'), pair('d', 'c'), pair('x', 'y')], NOW);
    expect(groups.map((g) => g.sort())).toEqual([
      ['a', 'b', 'c', 'd'],
      ['x', 'y'],
    ]);
  });

  it('drops reviewed and month-old pairs', () => {
    expect(linkedGroups([pair('a', 'b', 1, { reviewed: true }), pair('c', 'd', 31)], NOW)).toEqual([]);
  });

  it('flags a group tied to a banned account and leaves its money out', () => {
    const text = buildSuspicionReport(
      [pair('h', 'k'), pair('h', 'n')],
      { h: member('HakariJackpot', 50000), k: member('KuzaGentleman', 1000, true), n: member('Nero', 20000) },
      0,
      NOW,
      '!',
    );
    expect(text).toContain('**Tied to a banned account:**');
    expect(text).toContain('KuzaGentleman (banned)');
    expect(text).toContain('3 accounts · $70k combined');
  });

  it("lists this week's pushes and anyone in more than one", () => {
    const text = buildSuspicionReport(
      [
        push('MNSK', ['Papa_Park', 'AFPpKZ']),
        push('JYNG', ['Papa_Park', 'Slare'], 10),
        push('OLD', ['Z'], 1, { reviewed: true }),
      ],
      {},
      3,
      NOW,
      '!',
    );
    expect(text).toContain('$MNSK down 11.4% on 2026-10-27: Papa_Park, AFPpKZ');
    expect(text).not.toContain('$JYNG'); // not this week
    expect(text).not.toContain('$OLD'); // already reviewed
    expect(text).toContain('**In more than one push** (30 days): Papa_Park (2)');
    expect(text).toContain('3 this week');
  });

  it('says so on a quiet week, and never runs past a Discord message', () => {
    expect(buildSuspicionReport([], {}, 0, NOW, '!')).toContain('Quiet week');
    const many = Array.from({ length: 400 }, (_, i) => pair(`u${i}`, `v${i}`));
    expect(buildSuspicionReport(many, {}, 0, NOW, '!').length).toBeLessThanOrEqual(2000);
  });
});
