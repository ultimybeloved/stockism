import { describe, it, expect } from 'vitest';
import { drawWinners, prizeLabel, tierProblem, totalWinners, winsCanStack, type GiveawayTier } from './giveaways';

const tiers: GiveawayTier[] = [
  { prize: { kind: 'credit', amount: 500000 }, winners: 1 },
  { prize: { kind: 'credit', amount: 100000 }, winners: 5 },
  { prize: { kind: 'credit', amount: 50000 }, winners: 10 },
];
const seeded = (seed: number) => () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

describe('giveaways', () => {
  it('draws the top prize first and nobody wins twice', () => {
    const pool = Array.from({ length: 40 }, (_, i) => `p${i}`);
    const won = drawWinners(pool, tiers, seeded(7));
    expect(won).toHaveLength(16);
    expect(new Set(won.map((w) => w.entrant)).size).toBe(16);
    expect(won.map((w) => w.tier)).toEqual([0, 1, 1, 1, 1, 1, ...Array(10).fill(2)]);
  });

  it('pays everyone left when there are fewer entries than prizes, top prizes first', () => {
    const won = drawWinners(['a', 'b', 'c'], tiers, seeded(3));
    expect(won.map((w) => w.tier)).toEqual([0, 1, 1]);
    expect(drawWinners([], tiers, Math.random)).toEqual([]);
  });

  it('checks prizes', () => {
    const isCosmetic = (id: string) => id === 'frame_gold';
    expect(tierProblem(tiers, isCosmetic)).toBeNull();
    expect(tierProblem([], isCosmetic)).toMatch(/at least one/);
    expect(tierProblem([{ prize: { kind: 'cash', amount: 0 }, winners: 1 }], isCosmetic)).toMatch(/amount/);
    expect(tierProblem([{ prize: { kind: 'credit', amount: 5 }, winners: 0 }], isCosmetic)).toMatch(/winners/);
    expect(tierProblem([{ prize: { kind: 'cosmetic', cosmeticId: 'nope' }, winners: 1 }], isCosmetic)).toMatch(/exist/);
    expect(tierProblem([{ prize: { kind: 'credit', amount: 5 }, winners: 101 }], isCosmetic)).toMatch(/100 winners/);
    expect(totalWinners(tiers)).toBe(16);
    expect(prizeLabel({ kind: 'credit', amount: 500000 })).toBe('$500,000 shop credit');
  });

  // The Thanksgiving 2026 shape: credit draw, a separate cash draw closed to
  // the top 10, and a random pin for everyone.
  const stacked: GiveawayTier[] = [
    { prize: { kind: 'credit', amount: 150000 }, winners: 2 },
    { prize: { kind: 'credit', amount: 100000 }, winners: 3 },
    { prize: { kind: 'credit', amount: 50000 }, winners: 5 },
    { prize: { kind: 'cash', amount: 75000 }, winners: 2, draw: 2, skipTop: 10 },
    { prize: { kind: 'cash', amount: 25000 }, winners: 3, draw: 2 },
    { prize: { kind: 'pin', collection: 'thanksgiving_2026' }, winners: 0, everyone: true },
  ];

  it('keeps each draw separate, skips the top players, and pays everyone tiers to all', () => {
    const pool = Array.from({ length: 30 }, (_, i) => i + 1); // entrant n is rank n
    for (let seed = 1; seed < 60; seed++) {
      const won = drawWinners(pool, stacked, seeded(seed), (e) => e);
      const of = (tier: number) => won.filter((w) => w.tier === tier).map((w) => w.entrant);
      const credit = [...of(0), ...of(1), ...of(2)];
      const cash = [...of(3), ...of(4)];
      expect(credit).toHaveLength(10);
      expect(new Set(credit).size).toBe(10);
      expect(cash).toHaveLength(5);
      expect(new Set(cash).size).toBe(5);
      expect(of(3).every((e) => e > 10)).toBe(true);
      expect(of(5)).toEqual(pool);
    }
  });

  it('lets the same person win in two draws', () => {
    const won = drawWinners(['solo'], stacked, seeded(1));
    expect(won.map((w) => w.tier)).toEqual([0, 3, 5]);
  });

  it('leaves a skip-top tier short rather than paying the top players', () => {
    const won = drawWinners([1, 2, 3], stacked.slice(3, 4), seeded(5), (e) => e);
    expect(won).toEqual([]);
    const unranked = drawWinners(['x'], stacked.slice(3, 4), seeded(5), () => null);
    expect(unranked).toHaveLength(1);
  });

  it('checks the new tier options', () => {
    const isPin = (id: string) => id === 'thanksgiving_2026';
    expect(tierProblem(stacked, () => false, isPin)).toBeNull();
    expect(tierProblem(stacked, () => false)).toMatch(/pin collection/);
    expect(tierProblem([{ prize: { kind: 'cash', amount: 5 }, winners: 1, draw: 4 }], () => false)).toMatch(/draw/);
    expect(tierProblem([{ prize: { kind: 'cash', amount: 5 }, winners: 1, skipTop: -1 }], () => false)).toMatch(
      /top players/,
    );
    expect(totalWinners(stacked)).toBe(15);
    expect(winsCanStack(stacked)).toBe(true);
    expect(winsCanStack(tiers)).toBe(false);
    expect(prizeLabel({ kind: 'pin', collection: 'thanksgiving_2026' }, () => 'Thanksgiving 2026')).toBe(
      'a random Thanksgiving 2026 pin',
    );
  });
});
