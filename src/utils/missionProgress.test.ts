import { describe, it, expect } from 'vitest';
import { crewValuePercent, getDailyMissionProgress } from './missionProgress';
import type { Mission } from '../crews';

const crewMajority = { id: 'CREW_MAJORITY', checkType: 'CREW_MAJORITY', requirement: 50 } as unknown as Mission;

describe('crewValuePercent', () => {
  it('weighs positions by value, not share count', () => {
    // 100 cheap crew shares ($1) vs 1 pricey outsider ($500): most shares, little value.
    const pct = crewValuePercent({ CREW: 100, OUT: 1 }, { CREW: 1, OUT: 500 }, ['CREW']);
    expect(pct).toBeCloseTo((100 / 600) * 100);
  });

  it('is 0 with nothing held', () => {
    expect(crewValuePercent({}, {}, ['CREW'])).toBe(0);
  });
});

describe('Crew Majority', () => {
  it('no longer completes on a pile of cheap crew shares', () => {
    const r = getDailyMissionProgress(crewMajority, {
      holdings: { CREW: 100, OUT: 1 },
      prices: { CREW: 1, OUT: 500 },
      dailyProgress: {},
      crewMembers: ['CREW'],
    });
    expect(r.complete).toBe(false);
  });

  it('completes when most of the stock value is in the crew', () => {
    const r = getDailyMissionProgress(crewMajority, {
      holdings: { CREW: 10, OUT: 1 },
      prices: { CREW: 100, OUT: 500 },
      dailyProgress: {},
      crewMembers: ['CREW'],
    });
    expect(r.complete).toBe(true);
  });
});
