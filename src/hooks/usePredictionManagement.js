import { useCallback } from 'react';
import { placeBetFunction, buyEventSharesFunction, sellEventSharesFunction } from '../firebase';
import { formatCurrency } from '../utils/formatters';
import { getTotalInvested } from '../utils/calculations';

export function usePredictionManagement({ user, userData, predictions, showNotification, setUserData, setLoadingKey }) {
  const handleBet = useCallback(async (predictionId, option, amount) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to place bets!');
      return;
    }
    if (userData.cash < amount) {
      showNotification('error', 'Insufficient funds!');
      return;
    }
    const totalInvested = getTotalInvested(userData.holdings, userData.costBasis, userData.shorts);
    if (totalInvested <= 0) {
      showNotification('error', 'You must invest in the market before placing bets!');
      return;
    }
    const betLimit = Math.min(totalInvested, userData.cash);
    if (amount > betLimit) {
      if (totalInvested > userData.cash) {
        showNotification('error', `Insufficient funds! You have ${formatCurrency(userData.cash)}`);
      } else {
        showNotification('error', `Bet limit: ${formatCurrency(totalInvested)} (total you've invested in stocks)`);
      }
      return;
    }
    const prediction = predictions.find(p => p.id === predictionId);
    if (!prediction || prediction.resolved || prediction.endsAt < Date.now()) {
      showNotification('error', 'Betting has ended!');
      return;
    }
    const existingBet = userData.bets?.[predictionId];
    if (existingBet && existingBet.option !== option) {
      showNotification('error', `You already bet on "${existingBet.option}"!`);
      return;
    }
    setLoadingKey('placeBet', true);
    try {
      await placeBetFunction({ predictionId, option, amount });
      setUserData(prev => {
        if (!prev) return prev;
        const prevBet = prev.bets?.[predictionId];
        const newAmount = (prevBet?.amount || 0) + amount;
        return { ...prev, cash: (prev.cash || 0) - amount, bets: { ...prev.bets, [predictionId]: { option, amount: newAmount, paid: false } } };
      });
      showNotification('success', `Bet ${formatCurrency(amount)} on "${option}"!`);
    } catch (error) {
      console.error('Bet placement failed:', error);
      const msg = error?.message || 'Bet failed';
      showNotification('error', msg.includes('Insufficient') ? 'Insufficient funds!' : msg);
    } finally {
      setLoadingKey('placeBet', false);
    }
  }, [user, userData, predictions, showNotification, setUserData, setLoadingKey]);

  // Long-term event-share markets (AMM-priced). Cash and positions reconcile from
  // the user-doc subscription; we optimistically nudge cash for snappy feedback.
  const handleBuyEventShares = useCallback(async (marketId, outcome, shares) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to trade!');
      return null;
    }
    setLoadingKey('eventTrade', true);
    try {
      const res = await buyEventSharesFunction({ marketId, outcome, shares });
      const cost = res?.data?.cost || 0;
      setUserData(prev => (prev ? { ...prev, cash: (prev.cash || 0) - cost } : prev));
      showNotification('success', `Bought ${shares} "${outcome}" for ${formatCurrency(cost)}`);
      return res?.data || null;
    } catch (error) {
      console.error('Event buy failed:', error);
      const msg = error?.message || 'Trade failed';
      showNotification('error', msg.includes('Insufficient') ? 'Insufficient funds!' : msg);
      return null;
    } finally {
      setLoadingKey('eventTrade', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  const handleSellEventShares = useCallback(async (marketId, outcome, shares) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to trade!');
      return null;
    }
    setLoadingKey('eventTrade', true);
    try {
      const res = await sellEventSharesFunction({ marketId, outcome, shares });
      const refund = res?.data?.refund || 0;
      setUserData(prev => (prev ? { ...prev, cash: (prev.cash || 0) + refund } : prev));
      showNotification('success', `Sold ${shares} "${outcome}" for ${formatCurrency(refund)}`);
      return res?.data || null;
    } catch (error) {
      console.error('Event sell failed:', error);
      showNotification('error', error?.message || 'Trade failed');
      return null;
    } finally {
      setLoadingKey('eventTrade', false);
    }
  }, [user, userData, showNotification, setUserData, setLoadingKey]);

  return { handleBet, handleBuyEventShares, handleSellEventShares };
}
