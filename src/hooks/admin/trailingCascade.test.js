import { describe, it, expect } from 'vitest';
import { buildTrailingCascade } from './trailingCascade';
import { CHARACTER_MAP } from '../../characters';

// $JIN, $SHNG and $GAP are mutually linked, which is what made the old
// depth-first walk order-dependent. Coefficients are read from the roster rather
// than hardcoded so re-weighting them does not break these tests.
const linkTo = (from, to) =>
  CHARACTER_MAP[from].trailingFactors.find((t) => t.ticker === to).coefficient;

describe('buildTrailingCascade', () => {
  const prices = { JIN: 100, GAP: 100, SHNG: 100, VIN: 100, KTAE: 100, JAKE: 100 };
  const moveOf = (moves, ticker) => moves.find((m) => m.ticker === ticker);

  it('moves both direct links by their own coefficient, not by list order', () => {
    // The 2026-08-20 bug: $SHNG was reached through $GAP (0.4 x 0.4) and then
    // skipped when $JIN's own 0.4 link to it came up, so it moved 0.48% instead
    // of 1.20% purely because $GAP is typed first in src/characters.js.
    const moves = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 103, prices });

    const gap = moveOf(moves, 'GAP');
    const shng = moveOf(moves, 'SHNG');
    expect(gap.to).toBeCloseTo(100 * (1 + 0.03 * linkTo('JIN', 'GAP')), 2);
    expect(shng.to).toBeCloseTo(100 * (1 + 0.03 * linkTo('JIN', 'SHNG')), 2);
  });

  it('gives equally linked stocks the same move', () => {
    // JIN -> GAP and JIN -> SHNG carry the same weight, so the two must land in
    // the same place. This holds whatever the coefficient is.
    expect(linkTo('JIN', 'GAP')).toBe(linkTo('JIN', 'SHNG'));
    const moves = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 103, prices });
    expect(moveOf(moves, 'GAP').to).toBe(moveOf(moves, 'SHNG').to);
  });

  it('never moves the adjusted stock itself', () => {
    const moves = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 103, prices });
    expect(moveOf(moves, 'JIN')).toBeUndefined();
  });

  it('moves each stock at most once', () => {
    const moves = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 103, prices });
    const tickers = moves.map((m) => m.ticker);
    expect(new Set(tickers).size).toBe(tickers.length);
  });

  it('reaches stocks that are only linked indirectly', () => {
    // JIN does not link to KTAE. GAP does, and JIN links to GAP.
    const moves = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 103, prices });
    expect(moveOf(moves, 'KTAE')).toBeDefined();
  });

  it('carries the direction of the move', () => {
    const down = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 97, prices });
    expect(moveOf(down, 'GAP').to).toBeLessThan(100);
  });

  it('skips stocks with no live price', () => {
    const moves = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 103, prices: { JIN: 100, GAP: 100 } });
    expect(moveOf(moves, 'GAP')).toBeDefined();
    expect(moveOf(moves, 'SHNG')).toBeUndefined();
  });

  it('reports from/to so the caller can record the move', () => {
    const moves = buildTrailingCascade({ ticker: 'JIN', oldPrice: 100, newPrice: 103, prices });
    for (const m of moves) {
      expect(m.from).toBeGreaterThan(0);
      expect(m.to).toBeGreaterThan(0);
      expect(m.from).not.toBe(m.to);
    }
  });

  it('does nothing for a stock with no links', () => {
    expect(buildTrailingCascade({ ticker: 'VIN', oldPrice: 100, newPrice: 110, prices })).toEqual([]);
  });
});
