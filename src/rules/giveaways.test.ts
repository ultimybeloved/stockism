import { describe, it, expect } from 'vitest';
import { drawWinners, prizeLabel, tierProblem, totalWinners, type GiveawayTier } from './giveaways';

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
});
