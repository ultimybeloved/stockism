import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type Mod = typeof import('./calloutRules');
let m: Mod;

beforeAll(() => {
  m = require('./calloutRules') as Mod;
});

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;

describe('bigWinOf', () => {
  const before = {
    holdings: { GUN: 100 },
    costBasis: { GUN: 100 },
    shorts: { GOO: { shares: 50, costBasis: 400 } },
  };

  it('posts a full exit worth $25k or more', () => {
    expect(m.bigWinOf(before, 'GUN', 'sell', 100, 360)).toEqual({ side: 'long', profit: 26000, percent: 260 });
  });

  it('skips a partial exit, however big', () => {
    expect(m.bigWinOf(before, 'GUN', 'sell', 99, 1000)).toBeNull();
  });

  it('posts a big percent only when the dollars clear the floor', () => {
    const small = { holdings: { X: 10 }, costBasis: { X: 10 } };
    expect(m.bigWinOf(small, 'X', 'sell', 10, 100)).toBeNull();
    const mid = { holdings: { X: 100 }, costBasis: { X: 10 } };
    expect(m.bigWinOf(mid, 'X', 'sell', 100, 40)).toEqual({ side: 'long', profit: 3000, percent: 300 });
  });

  it('counts a fully covered short', () => {
    // $19,500 at +97.5%: under both bars.
    expect(m.bigWinOf(before, 'GOO', 'cover', 50, 10)).toBeNull();
    const bigShort = { shorts: { GOO: { shares: 100, costBasis: 400 } } };
    expect(m.bigWinOf(bigShort, 'GOO', 'cover', 100, 100)).toEqual({ side: 'short', profit: 30000, percent: 75 });
  });

  it('ignores losses, buys, and missing cost', () => {
    expect(m.bigWinOf(before, 'GUN', 'sell', 100, 50)).toBeNull();
    expect(m.bigWinOf(before, 'GUN', 'buy', 100, 1000)).toBeNull();
    expect(m.bigWinOf({ holdings: { GUN: 1 } }, 'GUN', 'sell', 1, 1e6)).toBeNull();
    expect(m.bigWinOf(null, 'GUN', 'sell', 1, 1e6)).toBeNull();
  });
});

describe('isStreakMilestone', () => {
  it('fires at 30, 60, 100, and every 100 after', () => {
    expect([29, 30, 31, 60, 90, 100, 150, 200, 300].filter(m.isStreakMilestone)).toEqual([30, 60, 100, 200, 300]);
  });
});

describe('shakeups', () => {
  const top = (...uids: string[]) => uids;

  it('only records on the first run', () => {
    const r = m.shakeups(null, top('a', 'b', 'c'), 0);
    expect(r.posts).toEqual([]);
    expect(r.next.seeded).toBe(true);
    expect(r.next.postedLeader).toBe('a');
  });

  it('posts a newcomer to the top 10 once a week', () => {
    let s = m.shakeups(null, top('a', 'b'), 0).next;
    let r = m.shakeups(s, top('a', 'b', 'c'), 15 * MIN);
    expect(r.posts).toEqual([{ kind: 'top', uid: 'c', rank: 3 }]);
    s = r.next;
    // Drops out and comes straight back: not news.
    s = m.shakeups(s, top('a', 'b'), 30 * MIN).next;
    r = m.shakeups(s, top('a', 'b', 'c'), 45 * MIN);
    expect(r.posts).toEqual([]);
    // Back after more than a week away: news again.
    s = m.shakeups(r.next, top('a', 'b'), 60 * MIN).next;
    s = m.shakeups(s, top('a', 'b'), 8 * DAY).next;
    r = m.shakeups(s, top('a', 'b', 'c'), 8 * DAY + 15 * MIN);
    expect(r.posts).toEqual([{ kind: 'top', uid: 'c', rank: 3 }]);
  });

  it('posts at most 3 arrivals in one run', () => {
    const s = m.shakeups(null, top('a'), 0).next;
    const r = m.shakeups(s, top('a', 'b', 'c', 'd', 'e', 'f'), 15 * MIN);
    expect(r.posts.map((p) => p.uid)).toEqual(['b', 'c', 'd']);
    // The rest are recorded as seen, so they are not posted next run either.
    expect(m.shakeups(r.next, top('a', 'b', 'c', 'd', 'e', 'f'), 30 * MIN).posts).toEqual([]);
  });

  it('posts a new #1 only after they hold it', () => {
    let s = m.shakeups(null, top('a', 'b'), 0).next;
    let r = m.shakeups(s, top('b', 'a'), 15 * MIN);
    expect(r.posts).toEqual([]);
    r = m.shakeups(r.next, top('b', 'a'), 30 * MIN);
    expect(r.posts).toEqual([]);
    r = m.shakeups(r.next, top('b', 'a'), 45 * MIN);
    expect(r.posts).toEqual([{ kind: 'leader', uid: 'b', previous: 'a' }]);
    s = r.next;
    // A brief swap back and forth is never posted.
    r = m.shakeups(s, top('a', 'b'), 60 * MIN);
    r = m.shakeups(r.next, top('b', 'a'), 75 * MIN);
    r = m.shakeups(r.next, top('b', 'a'), 120 * MIN);
    expect(r.posts).toEqual([]);
  });

  it('does not repost the same leader within a day', () => {
    let r = m.shakeups(m.shakeups(null, top('a', 'b'), 0).next, top('b', 'a'), MIN);
    r = m.shakeups(r.next, top('b', 'a'), 30 * MIN);
    expect(r.posts[0]).toMatchObject({ kind: 'leader', uid: 'b' });
    r = m.shakeups(r.next, top('a', 'b'), 60 * MIN);
    r = m.shakeups(r.next, top('a', 'b'), 120 * MIN);
    expect(r.posts[0]).toMatchObject({ kind: 'leader', uid: 'a', previous: 'b' });
    r = m.shakeups(r.next, top('b', 'a'), 180 * MIN);
    r = m.shakeups(r.next, top('b', 'a'), 240 * MIN);
    expect(r.posts).toEqual([]);
  });
});
