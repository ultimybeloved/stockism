// The weekly growth missions, backend check and the frontend progress mirror.
// Free money (check-ins, dividends, drops, rewards) must not count as growth.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { getWeeklyMissionProgress } from '../../../src/utils/missionProgress';
import { WEEKLY_MISSIONS } from '../../../src/crews';

const require = createRequire(import.meta.url);
const { WEEKLY_MISSION_CHECKS } = require('./missionChecks') as typeof import('./missionChecks');

const builder = WEEKLY_MISSION_CHECKS.PORTFOLIO_BUILDER;
const moonshot = WEEKLY_MISSION_CHECKS.PORTFOLIO_MOONSHOT;
type WeeklyProgress = Parameters<typeof builder>[0];
const frontend = (wp: WeeklyProgress, userData: { portfolioValue: number; grantedValue: number }) =>
  getWeeklyMissionProgress(WEEKLY_MISSIONS.PORTFOLIO_BUILDER, {
    holdings: {},
    weeklyProgress: wp,
    prices: {},
    crewMembers: [],
    portfolioValue: userData.portfolioValue,
    grantedValue: userData.grantedValue,
  });

describe('weekly growth missions', () => {
  it('a week of free money alone completes neither', () => {
    // $3,000 account, +$2,600 of check-ins and drops, no trading.
    const wp = { startPortfolioValue: 3000, startGrantedValue: 500 };
    const user = { portfolioValue: 5600, grantedValue: 3100 };
    expect(builder(wp, user)).toBe(false);
    expect(moonshot(wp, user)).toBe(false);
    expect(frontend(wp, user).complete).toBe(false);
  });

  it('real trading growth still counts, on top of free money', () => {
    // +$600 earned (20%) plus $2,600 granted.
    const wp = { startPortfolioValue: 3000, startGrantedValue: 500 };
    const user = { portfolioValue: 6200, grantedValue: 3100 };
    expect(builder(wp, user)).toBe(true);
    expect(moonshot(wp, user)).toBe(false);
    expect(frontend(wp, user)).toMatchObject({ complete: true, progress: 20 });
  });

  it('a week recorded before the start mark existed deducts nothing', () => {
    const wp = { startPortfolioValue: 3000 };
    const user = { portfolioValue: 3600, grantedValue: 9999 };
    expect(builder(wp, user)).toBe(true);
    expect(frontend(wp, user).complete).toBe(true);
  });

  it('no start value never completes', () => {
    expect(builder({}, { portfolioValue: 1e9 })).toBe(false);
  });
});
