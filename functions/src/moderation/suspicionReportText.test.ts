import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { buildSuspicionReport, linkedGroups, groupLinks } =
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
  combinedImpact: 11.36,
  day: '2026-10-27',
  participants: names,
  ...extra,
});
const member = (name: string, value = 1000, banned = false) => ({ name, value, banned });
const report = (...args: Parameters<typeof buildSuspicionReport>) => buildSuspicionReport(...args).join('\n');

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

  it('says who shares a connection with whom, each pair once', () => {
    const pairs = [
      ['h', 'n'],
      ['h', 'g'],
      ['h', 'k'],
      ['g', 'n'],
    ] as const;
    const lines = groupLinks(['h', 'n', 'g', 'k'], [...pairs], (u) => u.toUpperCase());
    expect(lines).toEqual(['H shares a connection with N, G and K', 'N also shares one with G']);
  });

  it('names who a group is tied to, including a banned account', () => {
    const text = report(
      [pair('h', 'k'), pair('h', 'n'), pair('u', 'a')],
      {
        h: member('HakariJackpot', 50000),
        k: member('KuzaGentleman', 1000, true),
        n: member('Nero', 20000),
        u: member('.unk_b', 700000),
        a: member('Aurora', 55000),
      },
      [],
      NOW,
      '!',
    );
    expect(text).toContain('**Group 1:** 3 accounts, $70k between the active ones. **Includes banned KuzaGentleman**');
    expect(text).toContain('• HakariJackpot shares a connection with KuzaGentleman (banned) and Nero');
    expect(text).toContain('**Group 2:** 2 accounts, $755k between the active ones');
    expect(text).toContain('• .unk_b shares a connection with Aurora');
  });

  it('says who each blocked signup was linked to', () => {
    const text = report(
      [],
      {},
      [
        { name: 'Avery', kind: 'banned', reason: 'TSA group', linked: ['Chart11', 'Stitch'] },
        { name: 'Supar', kind: 'cap', linked: ['Duke', 'RinJang'] },
        { name: 'Temp', kind: 'email', linked: [] },
      ],
      NOW,
      '!',
    );
    expect(text).toContain(
      '"Avery" tried to sign up from a connection blocked in a ban (TSA group), used by Chart11 and Stitch',
    );
    expect(text).toContain('"Supar" was refused because their connection already has 2 accounts: Duke and RinJang');
    expect(text).toContain('"Temp" used a throwaway email address');
  });

  it("lists this week's pushes and anyone in more than one", () => {
    const text = report(
      [
        push('MNSK', ['Papa_Park', 'AFPpKZ']),
        push('JYNG', ['Papa_Park', 'Slare'], 10),
        push('OLD', ['Z'], 1, { reviewed: true }),
      ],
      {},
      [],
      NOW,
      '!',
    );
    expect(text).toContain('$MNSK down 11.4% on 2026-10-27: Papa_Park, AFPpKZ');
    expect(text).not.toContain('$JYNG'); // not this week
    expect(text).not.toContain('$OLD'); // already reviewed
    expect(text).toContain('**In more than one push** (30 days): Papa_Park (2)');
  });

  it('says so on a quiet week, and splits a long report into Discord-sized messages', () => {
    expect(report([], {}, [], NOW, '!')).toContain('Quiet week');
    const many = Array.from({ length: 8 }, (_, i) =>
      Array.from({ length: 20 }, (_, k) => pair(`hub${i}`, `member${i}-${k}-with-a-long-name`)),
    ).flat();
    const msgs = buildSuspicionReport(many, {}, [], NOW, '!');
    expect(msgs.length).toBeGreaterThan(1);
    for (const m of msgs) expect(m.length).toBeLessThanOrEqual(2000);
  });
});
