import { useCallback } from 'react';
import * as Sentry from '@sentry/react';
import { executeTradeFunction, achievementAlertFunction, syncPortfolioFunction } from '../firebase';
import { fireTradeConfetti } from '../utils/confetti';
import { ACHIEVEMENTS } from '../constants/achievements';
import { CHARACTER_MAP } from '../characters';
import { isWeeklyHalt } from '../utils/marketHours';
import { formatCurrency } from '../utils/formatters';
import { estimateTradeTotal } from '../utils/calculations';
import { NEW_ACCOUNT_IMPACT_PERIOD_DAYS, NEW_ACCOUNT_MIN_IMPACT_FACTOR } from '../constants';

// Reduced price impact for new accounts (anti-manipulation).
const getAccountAgeImpactFactor = (userData) => {
  if (!userData?.createdAt) return 1;
  const createdMs = typeof userData.createdAt?.toMillis === 'function'
    ? userData.createdAt.toMillis()
    : typeof userData.createdAt === 'number' ? userData.createdAt : Date.parse(userData.createdAt);
  if (!createdMs || isNaN(createdMs)) return 1;
  const ageDays = (Date.now() - createdMs) / (1000 * 60 * 60 * 24);
  if (ageDays >= NEW_ACCOUNT_IMPACT_PERIOD_DAYS) return 1;
  return NEW_ACCOUNT_MIN_IMPACT_FACTOR + (1 - NEW_ACCOUNT_MIN_IMPACT_FACTOR) * (ageDays / NEW_ACCOUNT_IMPACT_PERIOD_DAYS);
};

// Server-side achievement check via syncPortfolio (these fields are blocked
// from client writes by security rules).
const checkAndAwardAchievements = async () => {
  try {
    const result = await syncPortfolioFunction();
    return result.data?.newAchievements || [];
  } catch (error) {
    console.error('[ACHIEVEMENT CHECK ERROR]', error);
    return [];
  }
};

const sendAchievementAlert = (id, achievement) => {
  try {
    achievementAlertFunction({ achievementId: id, achievementName: achievement.name, achievementDescription: achievement.description }).catch((e) => Sentry.captureException(e));
  } catch (e) {
    Sentry.captureException(e);
  }
};

// Trade execution (with contention retry + result toasts) and the
// pre-execution confirmation request with estimated totals.
export function useTradeManagement({
  user, userData, prices, marketData, activeIPOs, launchedTickers,
  showNotification, setLoadingKey, setTradeConfirmation, setTradeAnimation,
}) {
  // Executes after confirmation.
  const handleTrade = useCallback(async (ticker, action, amount) => {
    console.log(`[TRADE START] ticker=${ticker}, action=${action}, amount=${amount}`);
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }
    if (isWeeklyHalt() || marketData?.marketHalted) {
      showNotification('error', marketData?.marketHalted
        ? `Market closed: ${marketData.haltReason || 'Emergency halt in progress'}`
        : 'Market closed for chapter review. Queue a pre-market order from 20:30 UTC, trading resumes at 21:00 UTC.');
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
          showNotification('warning', 'Market was busy. Please try again.');
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
      const { executionPrice, priceImpact, totalCost, remainingDailyImpact, isLastTrade, shortWarning } = result.data;

      const earnedAchievements = await checkAndAwardAchievements();
      const impactPercent = (prices[ticker] > 0 ? (priceImpact / prices[ticker] * 100) : 0).toFixed(2);

      if (action === 'buy') {
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked! Bought ${amount} ${ticker}`);
          sendAchievementAlert(earnedAchievements[0], achievement);
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
          sendAchievementAlert(earnedAchievements[0], achievement);
        } else {
          showNotification('success', `Sold ${amount} ${ticker} @ ${formatCurrency(executionPrice)} (${profitText}, ${impactPercent}% impact)`);
        }
      } else if (action === 'short') {
        if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          sendAchievementAlert(earnedAchievements[0], achievement);
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
          sendAchievementAlert('COLD_BLOODED', ACHIEVEMENTS['COLD_BLOODED']);
          showNotification('achievement', `🏆 ${ACHIEVEMENTS['COLD_BLOODED'].emoji} ${ACHIEVEMENTS['COLD_BLOODED'].name} unlocked!`);
        } else if (earnedAchievements.length > 0) {
          const achievement = ACHIEVEMENTS[earnedAchievements[0]];
          showNotification('achievement', `🏆 ${achievement.emoji} ${achievement.name} unlocked!`);
          sendAchievementAlert(earnedAchievements[0], achievement);
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
  }, [user, userData, prices, marketData, setLoadingKey, showNotification, setTradeAnimation]);

  // Opens the confirmation dialog with an estimated total.
  const requestTrade = useCallback((ticker, action, amount) => {
    if (!user || !userData) {
      showNotification('info', 'Sign in to start trading!');
      return;
    }

    // Characters in an IPO phase aren't tradeable normally
    const now = Date.now();
    const activeIPO = activeIPOs.find(ipo => ipo.ticker === ticker && !ipo.priceJumped && now < ipo.ipoEndsAt);
    if (activeIPO) {
      const inHypePhase = now < activeIPO.ipoStartsAt;
      showNotification('error', inHypePhase
        ? `$${ticker} is in IPO hype phase - trading opens soon!`
        : `$${ticker} is in IPO - buy through the IPO section above!`);
      return;
    }

    const asset = CHARACTER_MAP[ticker];
    if (asset?.ipoRequired && !launchedTickers.includes(ticker)) {
      showNotification('error', `$${ticker} requires an IPO before trading`);
      return;
    }

    const price = prices[ticker] || asset?.basePrice || 0;

    // Estimated total (with new-account impact reduction)
    const total = estimateTradeTotal({
      action,
      price,
      amount,
      isETF: asset?.isETF || false,
      ageFactor: getAccountAgeImpactFactor(userData),
      shortPosition: userData.shorts?.[ticker],
    });

    setTradeConfirmation({ ticker, action, amount, price, total, name: asset?.name });
  }, [user, userData, prices, activeIPOs, launchedTickers, showNotification, setTradeConfirmation]);

  return { handleTrade, requestTrade };
}
