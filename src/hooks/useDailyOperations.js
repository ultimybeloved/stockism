import { useCallback } from 'react';
import { useAppContext } from '../context/AppContext';
import { dailyCheckinFunction, bailoutFunction } from '../firebase';
import { fireDailyRewardConfetti } from '../utils/confetti';
import { CREW_MAP } from '../crews';
import { formatCurrency } from '../utils/formatters';
import { getTodayDateString, toUTCDateString } from '../utils/date';

export function useDailyOperations({ setUserData, setLoadingKey }) {
  const { user, userData, showNotification } = useAppContext();

  const handleDailyCheckin = useCallback(async () => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to claim your daily bonus!');
      return;
    }
    const today = getTodayDateString();
    const lastCheckinStr = toUTCDateString(userData.lastCheckin);
    if (lastCheckinStr === today) {
      showNotification('error', 'Already checked in today!');
      return;
    }
    setLoadingKey('checkin', true);
    try {
      const result = await dailyCheckinFunction({});
      const { reward, newStreak, ladderTopUpAmount, totalCheckins } = result.data;
      setUserData(prev => prev ? { ...prev, lastCheckin: new Date().toISOString(), cash: (prev.cash || 0) + reward, checkinStreak: newStreak, totalCheckins } : prev);
      fireDailyRewardConfetti();
      let notificationMsg = `Daily check-in: +${formatCurrency(reward)}!`;
      if (ladderTopUpAmount > 0) notificationMsg += ` | Ladder Game topped up to $100`;
      showNotification('success', notificationMsg);
    } catch (error) {
      console.error('[CHECKIN ERROR]', error);
      if (error.code === 'failed-precondition' && error.message.includes('Already checked in')) {
        showNotification('error', 'Already checked in today!');
      } else {
        showNotification('error', 'Failed to check in. Please try again.');
      }
    } finally {
      setLoadingKey('checkin', false);
    }
  }, [user, userData, setUserData, setLoadingKey, showNotification]);

  const handleBailout = useCallback(async () => {
    if (!user || !userData) return;
    const cash = userData.cash || 0;
    if (cash >= 0) {
      showNotification('error', 'You are not in debt.');
      return;
    }
    setLoadingKey('bailout', true);
    try {
      const currentCrew = userData.crew;
      const result = await bailoutFunction({});
      setUserData(prev => {
        if (!prev) return prev;
        const exiled = [...(prev.exiledCrews || [])];
        if (currentCrew && !exiled.includes(currentCrew)) exiled.push(currentCrew);
        return { ...prev, cash: 500, crew: null, holdings: {}, shorts: {}, marginUsed: 0, marginEnabled: false, exiledCrews: exiled };
      });
      if (result.data.hadCrew) {
        const crewName = CREW_MAP[currentCrew]?.name || 'your crew';
        showNotification('warning', `Bailout accepted. You've been exiled from ${crewName} and all previous crews. Starting fresh with $500.`);
      } else {
        showNotification('success', 'Bailout accepted. Starting fresh with $500.');
      }
    } catch (err) {
      console.error('Bailout failed:', err);
      showNotification('error', 'Bailout failed. Please try again.');
    } finally {
      setLoadingKey('bailout', false);
    }
  }, [user, userData, setUserData, setLoadingKey, showNotification]);

  return { handleDailyCheckin, handleBailout };
}
