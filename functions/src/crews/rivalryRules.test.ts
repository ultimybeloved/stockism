// Crew Rivalry pairing and scoring.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { pairCrews, opponentsOf, matchWinners, rivalryScore } =
  require('./rivalryRules') as typeof import('./rivalryRules');

describe('pairCrews', () => {
  it('pairs crews of similar size', () => {
    const m = pairCrews(['A', 'B', 'C', 'D'], { A: 20, B: 3, C: 18, D: 4 });
    expect(m).toEqual([
      ['A', 'C'],
      ['D', 'B'],
    ]);
  });

  it('never repeats last week when another pairing exists', () => {
    const m = pairCrews(['A', 'B', 'C', 'D'], { A: 20, B: 3, C: 18, D: 4 }, { A: ['C'], C: ['A'] });
    expect(m[0]).toEqual(['A', 'D']);
    expect(opponentsOf(m).A).toEqual(['D']);
  });

  it('puts the odd crew into a 3-way', () => {
    const m = pairCrews(['A', 'B', 'C'], { A: 5, B: 4, C: 3 });
    expect(m).toEqual([['A', 'B', 'C']]);
  });

  it('needs two crews for a match', () => {
    expect(pairCrews(['A'], { A: 5 })).toEqual([]);
  });
});

describe('matchWinners', () => {
  it('goes by the share of active members who qualified', () => {
    expect(matchWinners(['A', 'B'], { A: { active: 20, qualified: 5 }, B: { active: 2, qualified: 1 } })).toEqual([
      'B',
    ]);
  });

  it('a tie is a win for both', () => {
    expect(matchWinners(['A', 'B'], { A: { active: 4, qualified: 2 }, B: { active: 2, qualified: 1 } })).toEqual([
      'A',
      'B',
    ]);
  });

  it('nobody wins at zero', () => {
    expect(matchWinners(['A', 'B'], { A: { active: 4, qualified: 0 } })).toEqual([]);
    expect(rivalryScore(undefined)).toBe(0);
  });
});
