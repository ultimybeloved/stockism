import { useCallback } from 'react';
import { executeTradeFunction, achievementAlertFunction, syncPortfolioFunction } from '../firebase';
import { ACHIEVEMENTS } from '../constants/achievements';
import { isWeeklyHalt } from '../utils/marketHours';
import { fireTradeConfetti } from '../utils/confetti';
import { formatCurrency } from '../utils/formatters';

async function checkAndAwardAchievements() {
  try {
    const result = await syncPortfolioFunction();
    return result.data?.newAchievements || [];
  } catch (error) {
    console.error('[ACHIEVEMENT CHECK ERROR]', error);
    return [];
  }
}

export function useTradeManagement({ user, userData, prices, marketData, showNotification, setLoadingKey, setTradeAnimation }) {
  const handleTrade = useCallback(async (ticker, action, amount) => {
    console.log(`[TRADE START] ticker=${ticker}, action=${action}, amount=${amount}`);
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }
    if (isWeeklyHalt() || marketData?.marketHalted) {
      showNotification('error', marketData?.marketHalted
        ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
        : 'Market closed for chapter review. Trading resumes at 21:00 UTC.');
      return;
    }
    if ((userData.cash || 0) < 0 && (action === 'buy' || action === 'short')) {
      showNotification('error', 'You cannot open new positions while in debt. Request a bailout to start fresh.');
      return;
    }

    setLoadingKey('trade', true);
    let result;
    try {
      result = await executeTradeFunction({ ticker, action, amount });
      console.log('[TRADE EXECUTED]', result.data);
    } catch (firstError) {
      const firstMsg = firstError.message || 'Trade execution failed';
      const isContention = firstMsg.includes('busy') || firstMsg.includes('try again') || firstMsg.includes('contention');
      if (isContention) {
        try {
          await new Promise(r => setTimeout(r, 500));
          result = await executeTradeFunction({ ticker, action, amount });
          console.log('[TRADE EXECUTED ON RETRY]', result.data);
        } catch (retryError) {
          console.error('[TRADE RETRY FAILED]', retryError);
          showNotification('warning', 'Market was busy — please try again.');
          setLoadingKey('trade', false);
          return;
        }
      } else {
        console.error('[TRADE EXECUTION ERROR]', firstError);
        const isInfraError = firstMsg.includes('INTERNAL') || firstMsg.includes('DEADLINE_EXCEEDED') ||
                             firstMsg.includes('UNAVAILABLE') || firstMsg.includes('PERMISSION_DENIED');
        showNotification('error', isInfraError ? 'Cannot execute trade at this time. Please try again.' : firstMsg);
        setLoadingKey('trade', false);
        return;
      }
    }

    try {
      const {
        executionPrice,
        priceImpact,
        totalCost,
        remainingDailyImpact,
        isLastTrade,
        shortWarning
      } = result.data;

      const earnedAchievements = await checkAndAwardAchievements();
      const impactPercent = (prices[ticker] > 0 ? (priceImpact / prices[ticker] * 100) : 0).toFixed(2);

      if (action === 'buy') {
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch(() => {}); } catch {}
        } else {
          let message = `Bought ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${impactPercent > 0 ? '+' : ''}${impactPercent}% impact)`;
          if (isLastTrade) message += ` • This was your last trade on ${ticker} today`;
          else if (remainingDailyImpact <= 0) message += ` • 1 trade remaining on ${ticker} today`;
          else if (remainingDailyImpact < 0.03) message += ` • Approaching daily limit (${(remainingDailyImpact * 100).toFixed(1)}% remaining)`;
          showNotification('success', message);
        }

      } else if (action === 'sell') {
        const costBasis = userData.costBasis?.[ticker] || 0;
        const profitPercent = costBasis > 0 ? ((executionPrice - costBasis) / costBasis) * 100 : 0;
        const profitText = profitPercent >= 0 ? `+${profitPercent.toFixed(1)}%` : `${profitPercent.toFixed(1)}%`;
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch(() => {}); } catch {}
        } else {
          showNotification('success', `Sold ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${profitText}, ${impactPercent}% impact)`);
        }

      } else if (action === 'short') {
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch(() => {}); } catch {}
        } else {
          let message = `Shorted ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${impactPercent}% impact)`;
          if (isLastTrade) message += ` • This was your last trade on ${ticker} today`;
          else if (remainingDailyImpact <= 0) message += ` • 1 trade remaining on ${ticker} today`;
          else if (remainingDailyImpact < 0.03) message += ` • Approaching daily limit (${(remainingDailyImpact * 100).toFixed(1)}% remaining)`;
          showNotification('success', message);
          if (shortWarning) setTimeout(() => showNotification('warning', shortWarning), 1500);
        }

      } else if (action === 'cover') {
        const shortPosition = userData.shorts?.[ticker] || {};
        const costBasis = Number(shortPosition.costBasis || shortPosition.entryPrice) || 0;
        const profit = (costBasis - executionPrice) * amount;
        const safeProfitMsg = isNaN(profit) ? '$0.00' : (profit >= 0 ? `+${formatCurrency(profit)}` : `-${formatCurrency(Math.abs(profit))}`);
        const isColdBlooded = profit > 0;
        if (isColdBlooded && earnedAchievements.includes('COLD_BLOODED')) {
          const achievement = ACHIEVEMENTS['COLD_BLOODED'];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: 'COLD_BLOODED', achievementName: achievement.name, achievementDescription: achievement.description }).catch(() => {}); } catch {}
        } else if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          try { achievementAlertFunction({ achievementId: earnedAchievements[0], achievementName: achievement.name, achievementDescription: achievement.description }).catch(() => {}); } catch {}
        } else {
          showNotification(profit >= 0 ? 'success' : 'error', `Covered ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${safeProfitMsg}, ${impactPercent}% impact)`);
        }
      }

      const totalValue = Math.abs(totalCost || executionPrice * amount);
      setTradeAnimation({ ticker, action, big: totalValue >= 1000, timestamp: Date.now() });
      setTimeout(() => setTradeAnimation(null), 1200);
      fireTradeConfetti(totalValue, action);

    } finally {
      setLoadingKey('trade', false);
    }
  }, [user, userData, prices, marketData, showNotification, setLoadingKey, setTradeAnimation]);

  return { handleTrade };
}
