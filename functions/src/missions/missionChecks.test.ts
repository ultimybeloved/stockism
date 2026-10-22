// The server's claim check runs the shared rules (rules/missionProgress); this
// pins the wrapper the claim and /missions use to them.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { isDailyMissionDone, isWeeklyMissionDone, missionContext, missionAchievementFor } =
  require('./missionChecks') as typeof import('./missionChecks');

describe('mission claim checks', () => {
  const user = { portfolioValue: 10000, holdings: { A: 4 } };
  // A Friday in the first Thursday week: weekly missions are closed before it.
  const ctx = missionContext(user, { prices: { A: 10 } }, Date.UTC(2026, 9, 23, 12));

  it('reads the shared rules', () => {
    const kept = { buys: { A: { shares: 4, value: 120, low: 10 } } };
    expect(isDailyMissionDone('UNDERDOG_INVESTOR', kept, ctx)).toBe(true);
    expect(isDailyMissionDone('UNDERDOG_INVESTOR', { buys: { A: { shares: 4, value: 20, low: 10 } } }, ctx)).toBe(
      false,
    );
  });

  it('refuses missions that do not exist', () => {
    expect(isDailyMissionDone('MAKE_TRADES', {}, ctx)).toBe(false);
    expect(isWeeklyMissionDone('MARKET_WHALE', {}, ctx)).toBe(false);
  });

  it('Opening Bell is checked like any weekly, and Calls are gone', () => {
    const auction = { auctionBuys: { A: { shares: 4, value: 120 } } };
    expect(isWeeklyMissionDone('OPENING_BELL', auction, ctx)).toBe(true);
    expect(isWeeklyMissionDone('OPENING_BELL', {}, ctx)).toBe(false);
    expect(isWeeklyMissionDone('WEEKLY_CALL', {}, ctx)).toBe(false);
  });

  it('passes the daily close through for Buy the Dip', () => {
    const c = missionContext(user, { prices: { A: 10 }, dayClosePrices: { A: 12 } }, Date.UTC(2026, 9, 23, 12));
    expect(isDailyMissionDone('BUY_THE_DIP', { buys: { A: { shares: 4, value: 120, low: 10 } } }, c)).toBe(true);
  });

  it('mission milestones', () => {
    expect(missionAchievementFor(10, [])).toBe('MISSION_10');
    expect(missionAchievementFor(11, ['MISSION_10'])).toBeNull();
    expect(missionAchievementFor(100, ['MISSION_10', 'MISSION_50'])).toBe('MISSION_100');
  });
});
