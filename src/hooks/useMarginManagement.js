import { useCallback } from 'react';
import { toggleMarginFunction, repayMarginFunction } from '../firebase';
import { checkMarginEligibility } from '../utils/calculations';
import { ADMIN_UIDS } from '../constants';
import { formatCurrency } from '../utils/formatters';

export function useMarginManagement({ user, userData, showNotification, setUserData, setLoadingKey, setShowLending }) {
  const handleEnableMargin = useCallback(async () => {
    if (!user || !userData) return;
    const isAdmin = ADMIN_UIDS.includes(user.uid);
    const eligibility = checkMarginEligibility(userData, isAdmin);
    if (!eligibility.eligible) {
      showNotification('error', 'Not eligible for margin trading!');
      return;
    }
    setLoadingKey('enableMargin', true);
    try {
      await toggleMarginFunction({ enable: true });
      setUserData(prev => prev ? { ...prev, marginEnabled: true } : prev);
      showNotification('success', '📊 Margin trading enabled! You now have extra buying power.');
    } catch (err) {
      showNotification('error', err?.message || 'Failed to enable margin');
    } finally {
      setLoadingKey('enableMargin', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  const handleDisableMargin = useCallback(async () => {
    if (!user || !userData) return;
    if ((userData.marginUsed || 0) >= 0.01) {
      showNotification('error', 'Repay all margin debt before disabling!');
      return;
    }
    setLoadingKey('disableMargin', true);
    try {
      await toggleMarginFunction({ enable: false });
      setUserData(prev => prev ? { ...prev, marginEnabled: false } : prev);
      showNotification('success', 'Margin trading disabled.');
      setShowLending(false);
    } catch (err) {
      showNotification('error', err?.message || 'Failed to disable margin');
    } finally {
      setLoadingKey('disableMargin', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey, setShowLending]);

  const handleRepayMargin = useCallback(async (amount) => {
    if (!user || !userData) return;
    const marginUsed = userData.marginUsed || 0;
    if (marginUsed <= 0) {
      showNotification('error', 'No margin debt to repay!');
      return;
    }
    if (amount > userData.cash) {
      showNotification('error', 'Insufficient funds!');
      return;
    }
    setLoadingKey('repayMargin', true);
    try {
      const result = await repayMarginFunction({ amount });
      const { repaid, remaining } = result.data;
      setUserData(prev => prev ? { ...prev, cash: (prev.cash || 0) - repaid, marginUsed: remaining } : prev);
      if (remaining === 0) {
        showNotification('success', `Margin fully repaid! Paid ${formatCurrency(repaid)}`);
      } else {
        showNotification('success', `Repaid ${formatCurrency(repaid)}. Remaining debt: ${formatCurrency(remaining)}`);
      }
    } catch (err) {
      showNotification('error', err?.message || 'Failed to repay margin');
    } finally {
      setLoadingKey('repayMargin', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  return { handleEnableMargin, handleDisableMargin, handleRepayMargin };
}
