import { describe, it, expect } from 'vitest';
import { ACHIEVEMENT_IDS } from '../constants/achievements';
import { ACHIEVEMENT_COUNT } from '../rules/pinSlots';
import { getMaxAchievementSlots, getMaxShopSlots, toggleDisplayedPin } from './pinSlots';

describe('pin slots', () => {
  it('the shared achievement count matches the real list', () => {
    expect(ACHIEVEMENT_COUNT).toBe(ACHIEVEMENT_IDS.length);
  });

  it('starts at one slot each', () => {
    expect(getMaxAchievementSlots(null)).toBe(1);
    expect(getMaxShopSlots({})).toBe(1);
  });

  it('adds bought slots and the all-achievements bonus', () => {
    expect(getMaxAchievementSlots({ extraAchievementSlot: true })).toBe(2);
    expect(getMaxShopSlots({ extraShopSlot: true })).toBe(2);
    expect(getMaxAchievementSlots({ achievements: ACHIEVEMENT_IDS, extraAchievementSlot: true })).toBe(3);
    expect(getMaxAchievementSlots({ achievements: ACHIEVEMENT_IDS.slice(1) })).toBe(1);
  });

  it('will not add a pin past the cap, but always removes', () => {
    expect(toggleDisplayedPin(['a'], 'b', 1)).toEqual(['a']);
    expect(toggleDisplayedPin(['a'], 'b', 2)).toEqual(['a', 'b']);
    expect(toggleDisplayedPin(['a', 'b'], 'a', 1)).toEqual(['b']);
  });
});
