import { useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { buyIPOSharesFunction, db } from '../firebase';
import { CHARACTER_MAP } from '../characters';
import { IPO_TOTAL_SHARES, IPO_MAX_PER_USER } from '../constants';
import { isWeeklyHalt } from '../utils/marketHours';
import { formatCurrency } from '../utils/formatters';

export function useIPOManagement({ user, userData, marketData, showNotification, setUserData, setLoadingKey }) {
  const handleBuyIPO = useCallback(async (ticker, quantity) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to participate in IPO!');
      return;
    }
    if (isWeeklyHalt() || marketData?.marketHalted) {
      showNotification('error', marketData?.marketHalted
        ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
        : 'Market closed for chapter review. Trading resumes at 21:00 UTC.');
      return;
    }
    const ipoRef = doc(db, 'market', 'ipos');
    const ipoSnap = await getDoc(ipoRef);
    if (!ipoSnap.exists()) { showNotification('error', 'IPO not found'); return; }
    const ipoData = ipoSnap.data();
    const ipo = ipoData.list?.find(i => i.ticker === ticker);
    if (!ipo) { showNotification('error', 'IPO not found'); return; }
    const now = Date.now();
    if (now < ipo.ipoStartsAt) { showNotification('error', 'IPO has not started yet!'); return; }
    if (now >= ipo.ipoEndsAt) { showNotification('error', 'IPO has ended!'); return; }
    const sharesRemaining = ipo.sharesRemaining ?? (ipo.totalShares || IPO_TOTAL_SHARES);
    if (sharesRemaining <= 0) { showNotification('error', 'IPO sold out!'); return; }
    const ipoMaxPerUser = ipo.maxPerUser || IPO_MAX_PER_USER;
    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > ipoMaxPerUser) { showNotification('error', `Max ${ipoMaxPerUser} shares per person!`); return; }
    if (quantity > sharesRemaining) { showNotification('error', `Only ${sharesRemaining} shares left!`); return; }
    const totalCost = ipo.basePrice * quantity;
    if (userData.cash < totalCost) { showNotification('error', 'Insufficient funds!'); return; }
    setLoadingKey('buyIPO', true);
    try {
      await buyIPOSharesFunction({ ticker, quantity });
      setUserData(prev => {
        if (!prev) return prev;
        const existing = prev.holdings?.[ticker] || { quantity: 0, avgCost: 0 };
        const newQty = existing.quantity + quantity;
        const newAvg = ((existing.avgCost * existing.quantity) + totalCost) / newQty;
        return { ...prev, cash: (prev.cash || 0) - totalCost, holdings: { ...prev.holdings, [ticker]: { quantity: newQty, avgCost: newAvg } } };
      });
      const character = CHARACTER_MAP[ticker];
      showNotification('success', `🚀 IPO: Bought ${quantity} ${character?.name || ticker} shares @ ${formatCurrency(ipo.basePrice)}!`);
    } catch (err) {
      console.error('IPO purchase failed:', err);
      showNotification('error', err?.message || 'IPO purchase failed!');
    } finally {
      setLoadingKey('buyIPO', false);
    }
  }, [user, userData, marketData, showNotification, setUserData, setLoadingKey]);

  return { handleBuyIPO };
}
