import { getDailyMissions, getWeeklyMissions, getCrewMultiplier, type Mission } from '../../../crews';
import { getTodayDateString } from '../../../utils/date';
import {
  getWeekId,
  dailyMissionProgress,
  weeklyMissionProgress,
  playerMinTrade,
  type DailyProgress,
  type WeeklyProgress,
  type MissionContext,
  type MissionProgress,
} from '../../../utils/missionProgress';
import { weeklyMissionsOpen } from '../../../rules/missions';
import { useSession, useMarket } from '../../../context/AppContext';

export type BoardMission = Mission & MissionProgress & { claimed: boolean };

const sumRewards = (list: BoardMission[], pick: (m: BoardMission) => boolean) =>
  list.filter(pick).reduce((sum, m) => sum + m.reward, 0);

/** Today's and this week's missions with progress, as the server will judge them. */
export function useMissionBoard() {
  const { userData } = useSession();
  const { prices, crewStats, marketData } = useMarket();

  const now = Date.now();
  const today = getTodayDateString();
  const weekId = getWeekId(now);
  const crew = userData?.crew || null;
  const daily = (userData?.dailyMissions?.[today] || {}) as DailyProgress;
  const weekly = (userData?.weeklyMissions?.[weekId] || {}) as WeeklyProgress;
  const rerollSeed = weekly.rerollSeed || 0;

  // Underdog bonus: rewards shown (and paid by the server) are the base
  // amounts times this week's crew multiplier from market/crewStats.
  const multiplier = crew ? getCrewMultiplier(crewStats, crew) : 1;

  const ctx: MissionContext = {
    player: userData || {},
    prices,
    weekOpenPrices: marketData?.weekOpenPrices || null,
    dayClosePrices: marketData?.dayClosePrices || null,
    now,
  };

  const dailyMissions: BoardMission[] = getDailyMissions(today, crew, rerollSeed).map((m) => ({
    ...m,
    reward: Math.round(m.reward * multiplier),
    ...dailyMissionProgress(m, daily, ctx),
    claimed: !!daily.claimed?.[m.id],
  }));

  const weeklyMissions: BoardMission[] = getWeeklyMissions(crew, weekId, rerollSeed).map((m) => ({
    ...m,
    reward: Math.round(m.reward * multiplier),
    ...weeklyMissionProgress(m, weekly, ctx),
    claimed: !!weekly.claimed?.[m.id],
  }));

  const claimable = (m: BoardMission) => m.complete && !m.claimed;
  const earned = (m: BoardMission) => m.claimed;
  const anyClaimed = dailyMissions.some(earned) || weeklyMissions.some(earned);

  return {
    crew,
    weekId,
    multiplier,
    minTrade: playerMinTrade(ctx.player),
    dailyMissions,
    weeklyMissions,
    dailyTotals: {
      total: sumRewards(dailyMissions, () => true),
      earned: sumRewards(dailyMissions, earned),
      claimable: sumRewards(dailyMissions, claimable),
    },
    weeklyClaimable: sumRewards(weeklyMissions, claimable),
    canReroll: weeklyMissionsOpen(weekId) && !weekly.rerolled && !anyClaimed && (userData?.cash || 0) >= 50,
    hasRerolled: !!weekly.rerolled,
  };
}
