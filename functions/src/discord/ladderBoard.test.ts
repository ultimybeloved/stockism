import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { idleBoard, landsOn, playFrames, renderBoard } = require('./ladderBoard') as typeof import('./ladderBoard');

describe('idleBoard', () => {
  it('is the small board, 4 wide, with no rungs', () => {
    const g = idleBoard();
    expect(g).toHaveLength(7);
    expect(g.every((row) => row.length === 4)).toBe(true);
    expect(g.flat()).not.toContain('rung');
  });

  it('rings the picked X', () => {
    expect(idleBoard('right')[0]).toEqual(['x', 'blank', 'blank', 'x_sel']);
  });
});

describe('landsOn', () => {
  it('matches the site: 2 rungs stay, 3 rungs cross', () => {
    expect(landsOn('left', 2)).toBe('odd');
    expect(landsOn('right', 2)).toBe('even');
    expect(landsOn('left', 3)).toBe('even');
    expect(landsOn('right', 3)).toBe('odd');
  });
});

describe('playFrames', () => {
  it('2 rungs: X, two crossings, then the label', () => {
    const f = playFrames('right', 2);
    expect(f).toHaveLength(4);
    expect(f[0]![0]![3]).toBe('x_r');
    const last = f[f.length - 1]!;
    expect(last[6]).toEqual(['odd_a', 'odd_b', 'even_lit_a', 'even_lit_b']);
    expect(last[2]).toEqual(['jl_out_r', 'rung_r', 'rung_r', 'jr_in_r']);
    expect(last[4]).toEqual(['jl_in_r', 'rung_r', 'rung_r', 'jr_out_r']);
  });

  it('3 rungs: the board grows and lands on the other side', () => {
    const f = playFrames('left', 3);
    expect(f).toHaveLength(5);
    expect(f.every((g) => g.length === 9)).toBe(true);
    expect(f[4]![8]).toEqual(['odd_a', 'odd_b', 'even_lit_a', 'even_lit_b']);
    expect(f[4]![7]![3]).toBe('pole_r');
  });

  it('only ever uses blue for ODD and red for EVEN', () => {
    // Plates are named _a/_b for their halves, so leave them out.
    const path = (g: string[]) => g.filter((t) => !/^(odd|even)/.test(t));
    expect(path(playFrames('left', 2).flat(2)).some((t) => t.endsWith('_r'))).toBe(false);
    expect(path(playFrames('left', 3).flat(2)).some((t) => t.endsWith('_b'))).toBe(false);
  });

  it('renders every tile to an uploaded emoji', () => {
    for (const g of [...playFrames('left', 3), ...playFrames('right', 2), idleBoard('left')])
      expect(renderBoard(g)).not.toContain('undefined');
  });
});
