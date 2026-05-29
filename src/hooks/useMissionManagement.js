import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { claimMissionRewardFunction, rerollMissionsFunction } from '../firebase';
import { fireDailyRewardConfetti, fireWeeklyRewardConfetti } from '../utils/confetti';
import { ACHIEVEMENTS } from '../constants/achievements';
import { getWeekId } from '../crews';
import { getTodayDateString } from '../utils/date';
import { formatCurrency } from '../utils/formatters';

export function useMissionManagement({ setUserData, setLoadingKey }) {
  const { user, userData, showNotification } = useAppContext();

  const handleClaimMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;
    setLoadingKey('claimMission', true);
    try {
      const result = await claimMissionRewardFunction({ missionId, type: 'daily', reward });
      const today = getTodayDateString();
      setUserData(prev => prev ? ({
        ...prev,
        cash: (prev.cash || 0) + reward,
        dailyMissions: {
          ...prev.dailyMissions,
          [today]: {
            ...(prev.dailyMissions?.[today] || {}),
            claimed: { ...(prev.dailyMissions?.[today]?.claimed || {}), [missionId]: true }
          }
        }
      }) : prev);
      fireDailyRewardConfetti();
      const newTotal = result.data.newTotal;
      const achievements = userData.achievements || [];
      let earnedAchievement = null;
      if (newTotal >= 100 && !achievements.includes('MISSION_100')) earnedAchievement = ACHIEVEMENTS.MISSION_100;
      else if (newTotal >= 50 && !achievements.includes('MISSION_50')) earnedAchievement = ACHIEVEMENTS.MISSION_50;
      else if (newTotal >= 10 && !achievements.includes('MISSION_10')) earnedAchievement = ACHIEVEMENTS.MISSION_10;
      if (earnedAchievement) {
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim reward:', err);
      if (err?.code === 'failed-precondition') {
        showNotification('error', 'Mission not completed yet - progress may need to update');
      } else {
        showNotification('error', err.message || 'Failed to claim reward');
      }
    } finally {
      setLoadingKey('claimMission', false);
    }
  }, [user, userData, setUserData, setLoadingKey, showNotification]);

  const handleRerollMissions = useCallback(async () => {
    if (!user || !userData) return;
    setLoadingKey('rerollMissions', true);
    try {
      const result = await rerollMissionsFunction();
      const { rerollSeed } = result.data;
      const weekId = getWeekId();
      setUserData(prev => prev ? {
        ...prev,
        cash: (prev.cash || 0) - 50,
        weeklyMissions: {
          ...prev.weeklyMissions,
          [weekId]: { ...(prev.weeklyMissions?.[weekId] || {}), rerolled: true, rerollSeed }
        }
      } : prev);
      showNotification('success', 'Missions rerolled!');
    } catch (err) {
      console.error('Failed to reroll missions:', err);
      showNotification('error', err.message || 'Failed to reroll missions');
    } finally {
      setLoadingKey('rerollMissions', false);
    }
  }, [user, userData, setUserData, setLoadingKey, showNotification]);

  const handleClaimWeeklyMissionReward = useCallback(async (missionId, reward) => {
    if (!user || !userData) return;
    setLoadingKey('claimWeeklyMission', true);
    try {
      const result = await claimMissionRewardFunction({ missionId, type: 'weekly', reward });
      const weekId = getWeekId();
      setUserData(prev => prev ? {
        ...prev,
        cash: (prev.cash || 0) + reward,
        weeklyMissions: { ...prev.weeklyMissions, [weekId]: { ...(prev.weeklyMissions?.[weekId] || {}), claimed: { ...(prev.weeklyMissions?.[weekId]?.claimed || {}), [missionId]: true } } }
      } : prev);
      fireWeeklyRewardConfetti();
      const newTotal = result.data.newTotal;
      const achievements = userData.achievements || [];
      let earnedAchievement = null;
      if (newTotal >= 100 && !achievements.includes('MISSION_100')) earnedAchievement = ACHIEVEMENTS.MISSION_100;
      else if (newTotal >= 50 && !achievements.includes('MISSION_50')) earnedAchievement = ACHIEVEMENTS.MISSION_50;
      else if (newTotal >= 10 && !achievements.includes('MISSION_10')) earnedAchievement = ACHIEVEMENTS.MISSION_10;
      if (earnedAchievement) {
        showNotification('achievement', `🏆 ${earnedAchievement.emoji} ${earnedAchievement.name} unlocked!`);
      } else {
        showNotification('success', `Claimed ${formatCurrency(reward)} weekly mission reward!`);
      }
    } catch (err) {
      console.error('Failed to claim weekly reward:', err);
      if (err?.code === 'failed-precondition') {
        showNotification('error', 'Mission not completed yet - progress may need to update');
      } else {
        showNotification('error', err.message || 'Failed to claim reward');
      }
    } finally {
      setLoadingKey('claimWeeklyMission', false);
    }
  }, [user, userData, setUserData, setLoadingKey, showNotification]);

  return { handleClaimMissionReward, handleRerollMissions, handleClaimWeeklyMissionReward };
}
