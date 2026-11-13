import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

type Mod = typeof import('./displayFields');
let sanitizeDisplayFields: Mod['sanitizeDisplayFields'];

beforeAll(() => {
  ({ sanitizeDisplayFields } = require('./displayFields') as Mod);
});

describe('sanitizeDisplayFields pin slots', () => {
  const base = {
    achievements: ['FIRST_BLOOD', 'SHARK', 'DIVERSIFIED'],
    ownedShopPins: ['p1', 'p2', 'p3'],
    displayedAchievementPins: ['FIRST_BLOOD', 'SHARK', 'DIVERSIFIED'],
    displayedShopPins: ['p1', 'p2', 'p3'],
  };

  it('shows one of each without a bought slot', () => {
    const out = sanitizeDisplayFields(base);
    expect(out.displayedAchievementPins).toEqual(['FIRST_BLOOD']);
    expect(out.displayedShopPins).toEqual(['p1']);
  });

  it('shows two of each with the bought slots', () => {
    const out = sanitizeDisplayFields({ ...base, extraAchievementSlot: true, extraShopSlot: true });
    expect(out.displayedAchievementPins).toEqual(['FIRST_BLOOD', 'SHARK']);
    expect(out.displayedShopPins).toEqual(['p1', 'p2']);
  });

  it('drops pins that are not owned before counting, and repeats', () => {
    const out = sanitizeDisplayFields({
      ...base,
      extraShopSlot: true,
      displayedAchievementPins: ['FAKE', 'SHARK'],
      displayedShopPins: ['p1', 'p1', 'nope', 'p2'],
    });
    expect(out.displayedAchievementPins).toEqual(['SHARK']);
    expect(out.displayedShopPins).toEqual(['p1', 'p2']);
  });

  it('survives junk', () => {
    const out = sanitizeDisplayFields({ displayedShopPins: 'x', displayedAchievementPins: { a: 1 } });
    expect(out.displayedAchievementPins).toEqual([]);
    expect(out.displayedShopPins).toEqual([]);
  });
});
