import { useCallback } from 'react';
import { dailyCheckinFunction, bailoutFunction } from '../firebase';
import { fireDailyRewardConfetti } from '../utils/confetti';
import { CREW_MAP, CREW_REJOIN_LOCKOUT_DAYS } from '../crews';
import { formatCurrency } from '../utils/formatters';
import { getTodayDateString, toUTCDateString } from '../utils/date';
import { BAILOUT_CASH } from '../constants';

export function useDailyOperations({ user, userData, showNotification, setUserData, setLoadingKey }) {
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
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  const handleBailout = useCallback(async () => {
    if (!user || !userData) return;
    if (!userData.isBankrupt) {
      showNotification('error', 'You can recover by selling or closing a position.');
      return;
    }
    setLoadingKey('bailout', true);
    try {
      const currentCrew = userData.crew;
      const result = await bailoutFunction({});
      setUserData(prev => {
        if (!prev) return prev;
        const lockouts = { ...(prev.crewLockouts || {}) };
        if (currentCrew) lockouts[currentCrew] = Date.now() + CREW_REJOIN_LOCKOUT_DAYS * 24 * 60 * 60 * 1000;
        return { ...prev, cash: BAILOUT_CASH, crew: null, holdings: {}, shorts: {}, marginUsed: 0, marginEnabled: false, crewLockouts: lockouts };
      });
      if (result.data.hadCrew) {
        const crewName = CREW_MAP[currentCrew]?.name || 'your crew';
        showNotification('warning', `Bailout accepted. You can't rejoin ${crewName} for ${CREW_REJOIN_LOCKOUT_DAYS} days. Starting fresh with ${formatCurrency(BAILOUT_CASH)}.`);
      } else {
        showNotification('success', `Bailout accepted. Starting fresh with ${formatCurrency(BAILOUT_CASH)}.`);
      }
    } catch (err) {
      console.error('Bailout failed:', err);
      showNotification('error', 'Bailout failed. Please try again.');
    } finally {
      setLoadingKey('bailout', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  return { handleDailyCheckin, handleBailout };
}
