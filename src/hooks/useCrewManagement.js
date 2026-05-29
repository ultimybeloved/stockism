import { useCallback } from 'react';
import { switchCrewFunction, leaveCrewFunction } from '../firebase';
import { CREW_MAP } from '../crews';
import { formatCurrency } from '../utils/formatters';

export function useCrewManagement({ user, userData, showNotification, setUserData, setLoadingKey }) {
  const handleCrewSelect = useCallback(async (crewId, isSwitch) => {
    if (!user || !userData) return;
    try {
      if (isSwitch && userData.crew) {
        const result = await switchCrewFunction({ crewId, isSwitch: true });
        const { totalTaken } = result.data;
        setUserData(prev => prev ? { ...prev, crew: crewId, cash: (prev.cash || 0) - totalTaken, crewSwitchCooldown: Date.now() } : prev);
        const crew = CREW_MAP[crewId];
        showNotification('success', `Switched to ${crew.name}! Lost ${formatCurrency(totalTaken)} (15% penalty)`);
      } else {
        await switchCrewFunction({ crewId, isSwitch: false });
        setUserData(prev => prev ? { ...prev, crew: crewId } : prev);
        const crew = CREW_MAP[crewId];
        showNotification('success', `Welcome to ${crew.name}! ${crew.emblem}`);
      }
    } catch (err) {
      console.error('Failed to select crew:', err);
      showNotification('error', err?.message || err?.details || 'Failed to join crew');
    }
  }, [user, userData, showNotification, setUserData]);

  const handleCrewLeave = useCallback(async () => {
    if (!user || !userData || !userData.crew) return;
    if ((userData.cash || 0) < 0) {
      showNotification('error', 'You cannot leave your crew while in debt.');
      return;
    }
    setLoadingKey('leaveCrew', true);
    try {
      const oldCrew = CREW_MAP[userData.crew];
      const result = await leaveCrewFunction({});
      const totalTaken = result.data.totalTaken;
      setUserData(prev => prev ? { ...prev, crew: null, cash: (prev.cash || 0) - totalTaken, crewSwitchCooldown: Date.now() } : prev);
      showNotification('warning', `Left ${oldCrew?.name || 'crew'}. Lost ${formatCurrency(totalTaken)} (15% penalty). You cannot join a new crew for 24 hours.`);
    } catch (err) {
      console.error('Failed to leave crew:', err);
      showNotification('error', 'Failed to leave crew');
    } finally {
      setLoadingKey('leaveCrew', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  return { handleCrewSelect, handleCrewLeave };
}
