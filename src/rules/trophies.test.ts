import { describe, it, expect } from 'vitest';
import { cleanTrophyCase, headReign, ownedTrophies, ownsTrophy, parseTrophy, TROPHY_SLOTS } from './trophies';

const src = {
  achievements: ['SHARK', 'CROWNED'],
  ownedTitles: ['p1_diamond'],
  ownedCosmetics: ['glow_gold', 'frame_p1_gold'],
  ownedShopPins: ['black_card'],
  crewHeadBest: { weeks: 3, crew: 'ALLIED' },
};

describe('parseTrophy', () => {
  it('reads each kind and rejects junk', () => {
    expect(parseTrophy('ach:SHARK')).toEqual({ kind: 'ach', ref: 'SHARK' });
    expect(parseTrophy('head')).toEqual({ kind: 'head', ref: '' });
    for (const bad of ['', 'ach:', ':x', 'gem:x', 'head:x', 5, null, 'x'.repeat(101)]) {
      expect(parseTrophy(bad)).toBeNull();
    }
  });
});

describe('ownsTrophy', () => {
  it('needs the item in the matching owned list', () => {
    expect(ownsTrophy(src, 'ach:SHARK')).toBe(true);
    expect(ownsTrophy(src, 'ach:ORACLE')).toBe(false);
    expect(ownsTrophy(src, 'title:p1_diamond')).toBe(true);
    expect(ownsTrophy(src, 'cos:frame_p1_gold')).toBe(true);
    expect(ownsTrophy(src, 'cos:black_card')).toBe(false);
    expect(ownsTrophy(src, 'pin:black_card')).toBe(true);
    expect(ownsTrophy(src, 'head')).toBe(true);
    expect(ownsTrophy({}, 'head')).toBe(false);
  });
});

describe('headReign', () => {
  it('keeps the record, and falls back to one week for a crowned player', () => {
    expect(headReign(src)).toEqual({ weeks: 3, crew: 'ALLIED' });
    expect(headReign({ achievements: ['CROWNED'] })).toEqual({ weeks: 1, crew: null });
    expect(headReign({ crewHeadBest: { weeks: 0, crew: 'ALLIED' } })).toBeNull();
  });
});

describe('cleanTrophyCase', () => {
  it('drops unowned and repeated items and caps the case', () => {
    expect(cleanTrophyCase(src, ['ach:SHARK', 'ach:SHARK', 'ach:ORACLE', 'head'])).toEqual(['ach:SHARK', 'head']);
    const many = ownedTrophies(src);
    const all = [...many.head, ...many.title, ...many.cos, ...many.pin, ...many.ach];
    expect(all.length).toBeGreaterThan(TROPHY_SLOTS);
    expect(cleanTrophyCase(src, all)).toHaveLength(TROPHY_SLOTS);
    expect(cleanTrophyCase(src, 'ach:SHARK')).toEqual([]);
  });
});
