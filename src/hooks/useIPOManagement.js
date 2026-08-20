import { useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { buyIPOSharesFunction, db } from '../firebase';
import { CHARACTER_MAP } from '../characters';
import { IPO_TOTAL_SHARES, IPO_MAX_PER_USER } from '../constants';
import { isWeeklyHalt } from '../utils/marketHours';
import { formatCurrency } from '../utils/formatters';
import { reportUnexpected } from '../monitoring';

export function useIPOManagement({ user, userData, marketData, showNotification, setUserData, setLoadingKey }) {
  // Resolves true only when shares actually changed hands. Every other exit
  // resolves false, including the validation bail-outs, so the buy button can
  // tell "bought" from "rejected" rather than flashing success at a promise
  // that always resolved.
  const handleBuyIPO = useCallback(async (ticker, quantity) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to participate in IPO!');
      return false;
    }
    if (isWeeklyHalt() || marketData?.marketHalted) {
      showNotification('error', marketData?.marketHalted
        ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
        : 'Market closed for chapter review. Trading resumes at 21:00 UTC.');
      return false;
    }
    const ipoRef = doc(db, 'market', 'ipos');
    const ipoSnap = await getDoc(ipoRef);
    if (!ipoSnap.exists()) { showNotification('error', 'IPO not found'); return false; }
    const ipoData = ipoSnap.data();
    const ipo = ipoData.list?.find(i => i.ticker === ticker);
    if (!ipo) { showNotification('error', 'IPO not found'); return false; }
    const now = Date.now();
    if (now < ipo.ipoStartsAt) { showNotification('error', 'IPO has not started yet!'); return false; }
    if (now >= ipo.ipoEndsAt) { showNotification('error', 'IPO has ended!'); return false; }
    const sharesRemaining = ipo.sharesRemaining ?? (ipo.totalShares || IPO_TOTAL_SHARES);
    if (sharesRemaining <= 0) { showNotification('error', 'IPO sold out!'); return false; }
    const ipoMaxPerUser = ipo.maxPerUser || IPO_MAX_PER_USER;
    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > ipoMaxPerUser) { showNotification('error', `Max ${ipoMaxPerUser} shares per person!`); return false; }
    if (quantity > sharesRemaining) { showNotification('error', `Only ${sharesRemaining} shares left!`); return false; }
    const totalCost = ipo.basePrice * quantity;
    if (userData.cash < totalCost) { showNotification('error', 'Insufficient funds!'); return false; }
    setLoadingKey('buyIPO', true);
    try {
      await buyIPOSharesFunction({ ticker, quantity });
      setUserData(prev => {
        if (!prev) return prev;
        const currentShares = typeof prev.holdings?.[ticker] === 'number' ? prev.holdings[ticker] : 0;
        return { ...prev, cash: (prev.cash || 0) - totalCost, holdings: { ...prev.holdings, [ticker]: currentShares + quantity } };
      });
      const character = CHARACTER_MAP[ticker];
      showNotification('success', `🚀 IPO: Bought ${quantity} ${character?.name || ticker} shares @ ${formatCurrency(ipo.basePrice)}!`);
      return true;
    } catch (err) {
      reportUnexpected(err, { where: 'handleBuyIPO', ticker, quantity });
      showNotification('error', err?.message || 'IPO purchase failed!');
      return false;
    } finally {
      setLoadingKey('buyIPO', false);
    }
  }, [user, userData, marketData, showNotification, setUserData, setLoadingKey]);

  return { handleBuyIPO };
}
