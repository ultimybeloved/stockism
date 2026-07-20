import { useCallback } from 'react';
import { switchCrewFunction, leaveCrewFunction } from '../firebase';
import { CREW_MAP, CREW_REJOIN_LOCKOUT_DAYS, CREW_SWITCH_PENALTY } from '../crews';
import { formatCurrency } from '../utils/formatters';

export function useCrewManagement({ user, userData, showNotification, setUserData, setLoadingKey }) {
  // Returns true on success so the modal can wait for the round-trip before
  // closing (and stay open on failure). Without this the modal closed the instant
  // you confirmed, with no sign anything happened until a toast popped a beat later.
  const handleCrewSelect = useCallback(async (crewId, isSwitch) => {
    if (!user || !userData) return false;
    setLoadingKey('selectCrew', true);
    try {
      if (isSwitch && userData.crew) {
        const oldCrewId = userData.crew;
        const result = await switchCrewFunction({ crewId, isSwitch: true });
        const { totalTaken } = result.data;
        setUserData(prev => prev ? {
          ...prev, crew: crewId, cash: (prev.cash || 0) - totalTaken, crewSwitchCooldown: Date.now(),
          crewLockouts: { ...(prev.crewLockouts || {}), [oldCrewId]: Date.now() + CREW_REJOIN_LOCKOUT_DAYS * 24 * 60 * 60 * 1000 }
        } : prev);
        const crew = CREW_MAP[crewId];
        showNotification('success', `Switched to ${crew.name}! Lost ${formatCurrency(totalTaken)} (${Math.round(CREW_SWITCH_PENALTY * 100)}% penalty)`);
      } else {
        await switchCrewFunction({ crewId, isSwitch: false });
        setUserData(prev => prev ? { ...prev, crew: crewId } : prev);
        const crew = CREW_MAP[crewId];
        showNotification('success', `Welcome to ${crew.name}! ${crew.emblem}`);
      }
      return true;
    } catch (err) {
      console.error('Failed to select crew:', err);
      showNotification('error', err?.message || err?.details || 'Failed to join crew');
      return false;
    } finally {
      setLoadingKey('selectCrew', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  const handleCrewLeave = useCallback(async () => {
    if (!user || !userData || !userData.crew) return;
    if ((userData.cash || 0) < 0) {
      showNotification('error', 'You cannot leave your crew while in debt.');
      return;
    }
    setLoadingKey('leaveCrew', true);
    try {
      const oldCrew = CREW_MAP[userData.crew];
      const oldCrewId = userData.crew;
      const result = await leaveCrewFunction({});
      const totalTaken = result.data.totalTaken;
      setUserData(prev => prev ? {
        ...prev, crew: null, cash: (prev.cash || 0) - totalTaken, crewSwitchCooldown: Date.now(),
        crewLockouts: { ...(prev.crewLockouts || {}), [oldCrewId]: Date.now() + CREW_REJOIN_LOCKOUT_DAYS * 24 * 60 * 60 * 1000 }
      } : prev);
      showNotification('warning', `Left ${oldCrew?.name || 'crew'}. Lost ${formatCurrency(totalTaken)} (${Math.round(CREW_SWITCH_PENALTY * 100)}% penalty). You cannot join a new crew for 24 hours, or rejoin ${oldCrew?.name || 'this crew'} for ${CREW_REJOIN_LOCKOUT_DAYS} days.`);
    } catch (err) {
      console.error('Failed to leave crew:', err);
      showNotification('error', 'Failed to leave crew');
    } finally {
      setLoadingKey('leaveCrew', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  return { handleCrewSelect, handleCrewLeave };
}
