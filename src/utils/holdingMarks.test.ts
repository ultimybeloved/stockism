// Holding marks and profile backgrounds (2026-10-25): who can wear what, the
// position numbers the marks draw, and what a profile background publishes.
import { describe, it, expect } from 'vitest';
import { litFacets, markCardProps, positionOf, receiptText, resolveHoldingMark } from './holdingMarks';
import { chartShape, cleanCosmeticStyle } from '../rules/cosmetics';
import { ownedTrophies, ownsTrophy } from '../rules/trophies';
import { DIVIDEND_HOLD_MS } from '../characters';
import type { UserData } from '../types';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 25, 12);
const user = (u: Partial<UserData>) => u as UserData;

describe('which holding mark a player wears', () => {
  it('nothing equipped is Standard', () => {
    expect(resolveHoldingMark(user({})).cosmetic.id).toBe('mark_standard');
  });

  it('free marks need no purchase; paid ones must be owned', () => {
    expect(resolveHoldingMark(user({ activeCosmetics: { holdingMark: 'mark_rail' } })).cosmetic.id).toBe('mark_rail');
    expect(resolveHoldingMark(user({ activeCosmetics: { holdingMark: 'mark_bullion' } })).cosmetic.id).toBe(
      'mark_standard',
    );
    const owner = user({ activeCosmetics: { holdingMark: 'mark_bullion' }, ownedCosmetics: ['mark_bullion'] });
    expect(resolveHoldingMark(owner).cosmetic.id).toBe('mark_bullion');
  });

  it('color marks take the picked color, others keep their own', () => {
    const style = { markColor: '#ff00aa' };
    expect(
      resolveHoldingMark(user({ activeCosmetics: { holdingMark: 'mark_glow' }, cosmeticStyle: style })).color,
    ).toBe('#ff00aa');
    const diamond = user({
      activeCosmetics: { holdingMark: 'mark_diamond' },
      ownedCosmetics: ['mark_diamond'],
      cosmeticStyle: style,
    });
    expect(resolveHoldingMark(diamond).color).not.toBe('#ff00aa');
    const junk = user({ activeCosmetics: { holdingMark: 'mark_rail' }, cosmeticStyle: { markColor: 'red' } });
    expect(resolveHoldingMark(junk).color).toBe('#3B82F6');
  });
});

describe('the position a mark draws', () => {
  it('a long: average cost, gain and how long the oldest shares are held', () => {
    const u = user({
      holdings: { GWON: 12 },
      costBasis: { GWON: 100 },
      holdingCohorts: { GWON: { pending: [{ shares: 12, availableAt: NOW - 9 * DAY + DIVIDEND_HOLD_MS }] } },
    });
    const pos = positionOf(u, 'GWON', 110, null, NOW)!;
    expect(pos).toMatchObject({ kind: 'long', shares: 12, cost: 100 });
    expect(pos.gainPct).toBeCloseTo(10);
    expect(pos.heldDays).toBeCloseTo(9);
    expect(litFacets(pos.heldDays)).toBe(2);
    expect(receiptText(pos, String)).toBe('12 sh   avg $100.00   +10.0%');
  });

  it('a short gains when the price falls', () => {
    const u = user({ shorts: { GWON: { shares: 8, costBasis: 100, openedAt: NOW - 2 * DAY } as never } });
    const pos = positionOf(u, 'GWON', 90, null, NOW)!;
    expect(pos.kind).toBe('short');
    expect(pos.gainPct).toBeCloseTo(10);
    expect(receiptText(pos, String)).toBe('8 sh short   entry $100.00   +10.0%');
  });

  it('nothing held is no mark', () => {
    expect(positionOf(user({}), 'GWON', 100, null, NOW)).toBeNull();
  });

  it('facets light at 1, 7 and 30 days', () => {
    expect([0.5, 1, 6.9, 7, 29, 30].map(litFacets)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('Standard keeps the orange ring on a short; Profit Aura turns red on a loss', () => {
    const standard = { cosmetic: resolveHoldingMark(user({})).cosmetic, color: '#123456' };
    const short = { kind: 'short' as const, shares: 1, cost: 1, gainPct: 1, heldDays: 0 };
    expect(markCardProps(standard, short).style).toMatchObject({ '--tw-ring-color': '#f97316' });
    const aura = resolveHoldingMark(
      user({ activeCosmetics: { holdingMark: 'mark_aura' }, ownedCosmetics: ['mark_aura'] }),
    );
    expect(markCardProps(aura, { ...short, kind: 'long', gainPct: -8 }).style).toMatchObject({ '--mk': '#f87171' });
  });
});

describe('profile backgrounds publish only what they draw', () => {
  it('Your Chart sends the shape, never the values', () => {
    expect(chartShape([5000, 7500, 10000])).toEqual([0, 0.5, 1]);
    expect(chartShape([]).length).toBe(2);
    expect(chartShape(Array.from({ length: 500 }, (_, i) => i)).length).toBeLessThanOrEqual(61);
  });

  it('style colors must be real hex colors', () => {
    expect(cleanCosmeticStyle({ markColor: '#ABCDEF', tickerColors: '#000000,#ffffff' })).toEqual({
      markColor: '#abcdef',
      tickerColors: '#000000,#ffffff',
    });
    expect(cleanCosmeticStyle({ markColor: 'url(x)', tickerColors: '#000000' })).toEqual({});
  });

  it('marks and backgrounds stay out of the trophy case', () => {
    const src = { ownedCosmetics: ['mark_bullion', 'bg_banknote', 'frame_gold'] } as never;
    expect(ownedTrophies(src).cos).toEqual(['cos:frame_gold']);
    expect(ownsTrophy(src, 'cos:mark_bullion')).toBe(false);
  });
});
