import { useCallback } from 'react';
import { playSound } from '../../../utils/sounds';
import { claimMissionRewardFunction, rerollMissionsFunction } from '../../../api/callables';
import { fireDailyRewardConfetti, fireWeeklyRewardConfetti } from '../../../utils/confetti';
import { ACHIEVEMENTS, achievementToast } from '../../../constants/achievements';
import { getWeekId } from '../../../utils/missionProgress';
import { getTodayDateString } from '../../../utils/date';
import { formatCurrency } from '../../../utils/formatters';
import { callableErrorCode } from '../../../utils/errors';
import { reportUnexpected } from '../../../monitoring';
import { errorMessage } from '../../../utils/errors';
import type { ActionHookDeps } from '../../../shared/hooks/types';

/**
 * What a failed claim tells the player. The server's reason is shown as is
 * (a Discord link needed, every mission already claimed), except two:
 * "Mission not assigned" means this page is showing an out-of-date list,
 * usually an old copy of the site that a refresh fixes.
 */
const claimErrorText = (err: unknown) => {
  const msg = errorMessage(err);
  if (callableErrorCode(err) !== 'failed-precondition') return msg || 'Failed to claim reward';
  if (msg.includes('not assigned')) return 'Your mission list is out of date. Refresh the page and try again.';
  if (msg.includes('not completed')) return 'Mission not completed yet. Progress can take a moment to update.';
  return msg || 'Failed to claim reward';
};

export function useMissionManagement({ user, userData, showNotification, setUserData, setLoadingKey }: ActionHookDeps) {
  const handleClaimMissionReward = useCallback(
    async (missionId: string, reward: number) => {
      if (!user || !userData) return;
      setLoadingKey('claimMission', true);
      try {
        const result = await claimMissionRewardFunction({ missionId, type: 'daily', reward });
        const today = getTodayDateString();
        setUserData((prev) =>
          prev
            ? {
                ...prev,
                cash: (prev.cash || 0) + reward,
                dailyMissions: {
                  ...prev.dailyMissions,
                  [today]: {
                    ...(prev.dailyMissions?.[today] || {}),
                    claimed: { ...(prev.dailyMissions?.[today]?.claimed || {}), [missionId]: true },
                  },
                },
              }
            : prev,
        );
        fireDailyRewardConfetti();
        const newTotal = result.data.newTotal;
        const achievements = userData.achievements || [];
        let earnedAchievement = null;
        if (newTotal >= 100 && !achievements.includes('MISSION_100')) earnedAchievement = ACHIEVEMENTS.MISSION_100;
        else if (newTotal >= 50 && !achievements.includes('MISSION_50')) earnedAchievement = ACHIEVEMENTS.MISSION_50;
        else if (newTotal >= 10 && !achievements.includes('MISSION_10')) earnedAchievement = ACHIEVEMENTS.MISSION_10;
        if (earnedAchievement) {
          showNotification('achievement', ...achievementToast(earnedAchievement));
        } else {
          playSound('coin');
          showNotification('success', `Claimed ${formatCurrency(reward)} mission reward!`);
        }
      } catch (err) {
        reportUnexpected(err, { where: 'handleClaimMissionReward', missionId, reward });
        showNotification('error', claimErrorText(err));
      } finally {
        setLoadingKey('claimMission', false);
      }
    },
    [user, userData, showNotification, setUserData, setLoadingKey],
  );

  const handleRerollMissions = useCallback(async () => {
    if (!user || !userData) return;
    setLoadingKey('rerollMissions', true);
    try {
      const result = await rerollMissionsFunction();
      const { rerollSeed } = result.data;
      const weekId = getWeekId();
      setUserData((prev) =>
        prev
          ? {
              ...prev,
              cash: (prev.cash || 0) - 50,
              weeklyMissions: {
                ...prev.weeklyMissions,
                [weekId]: { ...(prev.weeklyMissions?.[weekId] || {}), rerolled: true, rerollSeed },
              },
            }
          : prev,
      );
      showNotification('success', 'Missions rerolled!');
    } catch (err) {
      reportUnexpected(err, { where: 'handleRerollMissions' });
      showNotification('error', errorMessage(err) || 'Failed to reroll missions');
    } finally {
      setLoadingKey('rerollMissions', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  const handleClaimWeeklyMissionReward = useCallback(
    async (missionId: string, reward: number) => {
      if (!user || !userData) return;
      setLoadingKey('claimWeeklyMission', true);
      try {
        const result = await claimMissionRewardFunction({ missionId, type: 'weekly', reward });
        const weekId = getWeekId();
        setUserData((prev) =>
          prev
            ? {
                ...prev,
                cash: (prev.cash || 0) + reward,
                weeklyMissions: {
                  ...prev.weeklyMissions,
                  [weekId]: {
                    ...(prev.weeklyMissions?.[weekId] || {}),
                    claimed: { ...(prev.weeklyMissions?.[weekId]?.claimed || {}), [missionId]: true },
                  },
                },
              }
            : prev,
        );
        fireWeeklyRewardConfetti();
        const newTotal = result.data.newTotal;
        const achievements = userData.achievements || [];
        let earnedAchievement = null;
        if (newTotal >= 100 && !achievements.includes('MISSION_100')) earnedAchievement = ACHIEVEMENTS.MISSION_100;
        else if (newTotal >= 50 && !achievements.includes('MISSION_50')) earnedAchievement = ACHIEVEMENTS.MISSION_50;
        else if (newTotal >= 10 && !achievements.includes('MISSION_10')) earnedAchievement = ACHIEVEMENTS.MISSION_10;
        if (earnedAchievement) {
          showNotification('achievement', ...achievementToast(earnedAchievement));
        } else {
          playSound('coin');
          showNotification('success', `Claimed ${formatCurrency(reward)} weekly mission reward!`);
        }
      } catch (err) {
        reportUnexpected(err, { where: 'handleClaimWeeklyMissionReward', missionId, reward });
        showNotification('error', claimErrorText(err));
      } finally {
        setLoadingKey('claimWeeklyMission', false);
      }
    },
    [user, userData, showNotification, setUserData, setLoadingKey],
  );

  return { handleClaimMissionReward, handleRerollMissions, handleClaimWeeklyMissionReward };
}
