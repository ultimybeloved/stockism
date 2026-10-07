import { useCallback } from 'react';
import type { HttpsCallableResult } from 'firebase/functions';
import { executeTradeFunction } from '../firebase';
import { fireTradeConfetti } from '../utils/confetti';
import { ACHIEVEMENTS, ACHIEVEMENT_MAP } from '../constants/achievements';
import { isWeeklyHalt } from '../utils/marketHours';
import { formatCurrency } from '../utils/formatters';
import { errorMessage, isCapacityError, isContentionError, isInfraError } from '../utils/errors';
import { reportError, reportUnexpected } from '../monitoring';
import { marketTimes } from '../utils/localTime';
import { checkAndAwardAchievements, sendAchievementAlert } from './tradeAchievements';
import { useTradeRequest } from './useTradeRequest';
import type { ExecuteTradeResponse } from '../api/types';
import type { TradeAction } from '../types';
import type { TradeHookDeps } from './types';

// Trade execution (with contention retry + result toasts) and the
// pre-execution confirmation request with estimated totals.
export function useTradeManagement({
  user,
  userData,
  prices,
  marketData,
  activeIPOs,
  launchedTickers,
  showNotification,
  setLoadingKey,
  setTradeConfirmation,
  setTradeAnimation,
}: TradeHookDeps) {
  // Executes after confirmation.
  const handleTrade = useCallback(
    async (ticker: string, action: TradeAction, amount: number) => {
      console.log(`[TRADE START] ticker=${ticker}, action=${action}, amount=${amount}`);
      if (!user || !userData) {
        showNotification('info', 'Sign in to start trading!');
        return;
      }
      if (isWeeklyHalt() || marketData?.marketHalted) {
        showNotification(
          'error',
          marketData?.marketHalted
            ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
            : `Market closed for chapter review. Queue a pre-market order from ${marketTimes().preMarketTime}, trading resumes ${marketTimes().reopen}.`,
        );
        return;
      }
      if ((userData.cash || 0) < 0 && (action === 'buy' || action === 'short')) {
        showNotification('error', 'You cannot open new positions while in debt. Request a bailout to start fresh.');
        return;
      }

      setLoadingKey('trade', true);
      let result: HttpsCallableResult<ExecuteTradeResponse>;
      try {
        result = await executeTradeFunction({ ticker, action, amount });
        console.log('[TRADE EXECUTED]', result.data);
      } catch (firstError) {
        const firstMsg = errorMessage(firstError) || 'Trade execution failed';
        // Capacity is checked before contention: hitting the instance cap also
        // reads as "try again", but retrying goes straight back into the same
        // wall and adds load at exactly the wrong moment.
        if (isCapacityError(firstError)) {
          // Always reported: hitting the instance cap is a capacity signal about
          // the whole game, not a problem with this one trade.
          reportError(firstError, { where: 'handleTrade.capacity', ticker, action, amount });
          showNotification('warning', 'Too many players are trading right now. Wait a moment and try again.');
          setLoadingKey('trade', false);
          return;
        }
        if (isContentionError(firstError)) {
          try {
            await new Promise((r) => setTimeout(r, 500));
            result = await executeTradeFunction({ ticker, action, amount });
            console.log('[TRADE EXECUTED ON RETRY]', result.data);
          } catch (retryError) {
            // Contention that survives a retry is the signal that the market doc
            // is genuinely saturated, so this one is always reported.
            reportError(retryError, { where: 'handleTrade.retryFailed', ticker, action, amount });
            showNotification('warning', 'Market was busy. Please try again.');
            setLoadingKey('trade', false);
            return;
          }
        } else {
          reportUnexpected(firstError, { where: 'handleTrade', ticker, action, amount });
          showNotification(
            'error',
            isInfraError(firstError) ? 'Cannot execute trade at this time. Please try again.' : firstMsg,
          );
          setLoadingKey('trade', false);
          return;
        }
      }

      try {
        const { executionPrice, priceImpact, totalCost, remainingDailyImpact, isLastTrade, shortWarning } = result.data;

        const earnedAchievements = await checkAndAwardAchievements();
        const tickerPrice = prices[ticker] ?? 0;
        const impactPercent = (tickerPrice > 0 ? (priceImpact / tickerPrice) * 100 : 0).toFixed(2);

        if (action === 'buy') {
          if (earnedAchievements.length > 0) {
            const achievement = ACHIEVEMENT_MAP[earnedAchievements[0]!]!;
            showNotification(
              'achievement',
              `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}`,
            );
            sendAchievementAlert(earnedAchievements[0]!, achievement);
          } else {
            let message = `Bought ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${Number(impactPercent) > 0 ? '+' : ''}${impactPercent}% impact)`;
            if (isLastTrade) message += ` • This was your last trade on ${ticker} today`;
            else if (remainingDailyImpact <= 0) message += ` • 1 trade remaining on ${ticker} today`;
            else if (remainingDailyImpact < 0.03)
              message += ` • Approaching daily limit (${(remainingDailyImpact * 100).toFixed(1)}% remaining)`;
            showNotification('success', message);
          }
        } else if (action === 'sell') {
          const costBasis = userData.costBasis?.[ticker] || 0;
          const profitPercent = costBasis > 0 ? ((executionPrice - costBasis) / costBasis) * 100 : 0;
          const profitText = profitPercent >= 0 ? `+${profitPercent.toFixed(1)}%` : `${profitPercent.toFixed(1)}%`;
          if (earnedAchievements.length > 0) {
            const achievement = ACHIEVEMENT_MAP[earnedAchievements[0]!]!;
            showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
            sendAchievementAlert(earnedAchievements[0]!, achievement);
          } else {
            showNotification(
              'success',
              `Sold ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${profitText}, ${impactPercent}% impact)`,
            );
          }
        } else if (action === 'short') {
          if (earnedAchievements.length > 0) {
            const achievement = ACHIEVEMENT_MAP[earnedAchievements[0]!]!;
            showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
            sendAchievementAlert(earnedAchievements[0]!, achievement);
          } else {
            let message = `Shorted ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${impactPercent}% impact)`;
            if (isLastTrade) message += ` • This was your last trade on ${ticker} today`;
            else if (remainingDailyImpact <= 0) message += ` • 1 trade remaining on ${ticker} today`;
            else if (remainingDailyImpact < 0.03)
              message += ` • Approaching daily limit (${(remainingDailyImpact * 100).toFixed(1)}% remaining)`;
            showNotification('success', message);
            if (shortWarning) setTimeout(() => showNotification('warning', shortWarning), 1500);
          }
        } else if (action === 'cover') {
          const shortPosition: { costBasis?: number; entryPrice?: number } = userData.shorts?.[ticker] || {};
          const costBasis = Number(shortPosition.costBasis || shortPosition.entryPrice) || 0;
          const profit = (costBasis - executionPrice) * amount;
          const safeProfitMsg = isNaN(profit)
            ? '$0.00'
            : profit >= 0
              ? `+${formatCurrency(profit)}`
              : `-${formatCurrency(Math.abs(profit))}`;
          const isColdBlooded = profit > 0;
          if (isColdBlooded && earnedAchievements.includes('COLD_BLOODED')) {
            sendAchievementAlert('COLD_BLOODED', ACHIEVEMENTS['COLD_BLOODED']);
            showNotification(
              'achievement',
              `🏆 ${ACHIEVEMENTS['COLD_BLOODED'].emoji} ${ACHIEVEMENTS['COLD_BLOODED'].name} unlocked!`,
            );
          } else if (earnedAchievements.length > 0) {
            const achievement = ACHIEVEMENT_MAP[earnedAchievements[0]!]!;
            showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
            sendAchievementAlert(earnedAchievements[0]!, achievement);
          } else {
            showNotification(
              profit >= 0 ? 'success' : 'error',
              `Covered ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${safeProfitMsg}, ${impactPercent}% impact)`,
            );
          }
        }

        const totalValue = Math.abs(totalCost || executionPrice * amount);
        setTradeAnimation({ ticker, action, big: totalValue >= 1000, timestamp: Date.now() });
        setTimeout(() => setTradeAnimation(null), 1200);
        fireTradeConfetti(totalValue, action);
      } finally {
        setLoadingKey('trade', false);
      }
    },
    [user, userData, prices, marketData, setLoadingKey, showNotification, setTradeAnimation],
  );

  const requestTrade = useTradeRequest({
    user,
    userData,
    prices,
    activeIPOs,
    launchedTickers,
    showNotification,
    setTradeConfirmation,
  });

  return { handleTrade, requestTrade };
}
