// Server-side mission completion verification.
//
// Internal module — NOT listed in services.ts. Required by missions.ts (to gate
// reward claims) and discordCommands.ts (to show progress in /missions). The
// rules themselves are the shared rules/missionProgress, the same code the
// missions screen draws its progress bars from.

import { DAILY_MISSIONS, WEEKLY_MISSIONS, CALL_MISSION } from '../shared/crews';
import {
  dailyMissionProgress,
  weeklyMissionProgress,
  type DailyProgress,
  type WeeklyProgress,
  type MissionContext,
} from '../shared/rules/missionProgress';
import type { UserData } from '../shared/types';

export type { DailyProgress, WeeklyProgress };

/** The context a check runs in, from the user doc and the market/current doc. */
export const missionContext = (
  userData: UserData,
  market: { prices?: Record<string, number>; weekOpenPrices?: Record<string, number> } | null | undefined,
  now = Date.now(),
): MissionContext => ({
  player: userData,
  prices: market?.prices || {},
  weekOpenPrices: market?.weekOpenPrices || null,
  now,
});

export const isDailyMissionDone = (missionId: string, dp: DailyProgress, ctx: MissionContext) => {
  const mission = DAILY_MISSIONS[missionId];
  return !!mission && dailyMissionProgress(mission, dp, ctx).complete;
};

/** The mission-count achievement a new lifetime total earns, if any. */
export const missionAchievementFor = (newTotal: number, achievements: string[] = []) => {
  if (newTotal >= 100 && !achievements.includes('MISSION_100')) return 'MISSION_100';
  if (newTotal >= 50 && !achievements.includes('MISSION_50')) return 'MISSION_50';
  if (newTotal >= 10 && !achievements.includes('MISSION_10')) return 'MISSION_10';
  return null;
};

// The Call is paid by the halt that scores it (weeklyCalls.ts), never claimed.
export const isWeeklyMissionDone = (missionId: string, wp: WeeklyProgress, ctx: MissionContext) => {
  const mission = missionId === CALL_MISSION.id ? CALL_MISSION : WEEKLY_MISSIONS[missionId];
  return !!mission && weeklyMissionProgress(mission, wp, ctx).complete;
};
