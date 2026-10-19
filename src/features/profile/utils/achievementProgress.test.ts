import { describe, it, expect } from 'vitest';
import { achievementProgress } from './achievementProgress';
import { ACHIEVEMENT_MAP } from '../../../constants/achievements';
import { ACHIEVEMENT_CATEGORIES } from './achievementCategories';

describe('achievement progress', () => {
  it('reads the counter and caps it at the target', () => {
    expect(achievementProgress('TRADER_100', { totalTrades: 63 })).toEqual({ current: 63, target: 100 });
    expect(achievementProgress('TRADER_20', { totalTrades: 63 })).toEqual({ current: 20, target: 20 });
    expect(achievementProgress('MISSION_10', {})).toEqual({ current: 0, target: 10 });
  });

  it('marks money goals and counts only held stocks', () => {
    expect(achievementProgress('BROKE_5K', { portfolioValue: 3200 })).toEqual({
      current: 3200,
      target: 5000,
      money: true,
    });
    expect(achievementProgress('DIVERSIFIED', { holdings: { A: 2, B: 0, C: 1 } })?.current).toBe(2);
  });

  it('skips non-count achievements and signed-out players', () => {
    expect(achievementProgress('DISCOUNT_DEACON', { totalTrades: 5 })).toBeNull();
    expect(achievementProgress('TRADER_20', null)).toBeNull();
  });

  it('only names real achievements', () => {
    for (const id of ['TRADER_20', 'BROKE_1M', 'PROPHET', 'DEDICATED_100', 'MISSION_100', 'NPC_LOVER', 'DIVERSIFIED'])
      expect(ACHIEVEMENT_MAP[id]).toBeDefined();
  });
});

describe('achievement categories', () => {
  it('lists every achievement exactly once', () => {
    const listed = Object.values(ACHIEVEMENT_CATEGORIES).flat();
    expect(new Set(listed).size).toBe(listed.length);
    expect([...listed].sort()).toEqual(Object.keys(ACHIEVEMENT_MAP).sort());
  });
});
