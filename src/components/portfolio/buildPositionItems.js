// Pure builders for the portfolio modal's position lists (longs and shorts).
// Display math only — the backend owns the real numbers.

import { CHARACTER_MAP, getDividendTier } from '../../characters';
import { DIVIDEND_RATES } from '../../constants/economy';
import { getShortLiquidationPrice } from '../../utils/calculations';

// Price at-or-before 24h ago for "today's return"; falls back to oldest point.
const price24hAgoOf = (priceHistory, ticker, currentPrice) => {
  const history = priceHistory?.[ticker] || [];
  if (history.length === 0) return currentPrice;
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].timestamp <= dayAgo) {
      return history[i].price;
    }
  }
  return history[0].price;
};

export const buildPortfolioItems = ({ holdings, prices, priceHistory, costBasis, holdingCohorts, dividendTierOverrides }) => {
  const now = Date.now();
  return Object.entries(holdings)
    .filter(([_, shares]) => shares > 0)
    .map(([ticker, shares]) => {
      const character = CHARACTER_MAP[ticker];
      const currentPrice = prices[ticker] || character?.basePrice || 0;
      const value = currentPrice * shares;
      const avgCost = costBasis?.[ticker] || character?.basePrice || currentPrice;
      const totalCost = avgCost * shares;

      // Total return (from avg cost)
      const totalReturnDollar = value - totalCost;
      const totalReturnPercent = totalCost > 0 ? ((value - totalCost) / totalCost) * 100 : 0;

      // Today's return (from 24h ago price)
      const price24hAgo = price24hAgoOf(priceHistory, ticker, currentPrice);
      const value24hAgo = price24hAgo * shares;
      const todayReturnDollar = value - value24hAgo;
      const todayReturnPercent = value24hAgo > 0 ? ((value - value24hAgo) / value24hAgo) * 100 : 0;

      // Dividend eligibility — graduates any pending entries past their availableAt.
      const tier = getDividendTier(ticker, dividendTierOverrides);
      const tierRate = DIVIDEND_RATES[tier] || 0;
      const cohort = holdingCohorts?.[ticker];
      let eligibleShares = 0;
      let soonestReadyMs = null;
      if (cohort) {
        eligibleShares = cohort.eligible || 0;
        for (const p of (cohort.pending || [])) {
          if ((p.availableAt || 0) <= now) {
            eligibleShares += p.shares || 0;
          } else if (soonestReadyMs === null || p.availableAt < soonestReadyMs) {
            soonestReadyMs = p.availableAt;
          }
        }
      }
      const weeklyDividend = eligibleShares * currentPrice * tierRate;

      return {
        ticker,
        shares,
        character,
        currentPrice,
        value,
        avgCost,
        totalCost,
        totalReturnDollar,
        totalReturnPercent,
        todayReturnDollar,
        todayReturnPercent,
        tier,
        tierRate,
        eligibleShares,
        soonestReadyMs,
        weeklyDividend,
      };
    })
    .sort((a, b) => b.value - a.value);
};

export const buildShortItems = ({ shorts, prices }) => {
  return Object.entries(shorts || {})
    .filter(([_, position]) => position && position.shares > 0)
    .map(([ticker, position]) => {
      const character = CHARACTER_MAP[ticker];
      const currentPrice = prices[ticker] || character?.basePrice || position.costBasis || position.entryPrice || 0;
      const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
      const shares = Number(position.shares) || 0;
      const margin = Number(position.margin) || 0;

      // P/L calculation: profit when price goes down
      const profitPerShare = entryPrice - currentPrice;
      const totalPL = profitPerShare * shares;
      const totalPLPercent = entryPrice > 0 ? (profitPerShare / entryPrice) * 100 : 0;

      // Current equity in the position
      const equity = margin + totalPL;
      const safeEquity = isNaN(equity) ? margin : equity;
      const equityRatio = currentPrice > 0 && shares > 0 ? safeEquity / (currentPrice * shares) : 1;
      const positionValue = safeEquity;

      return {
        ticker,
        character,
        shares,
        entryPrice,
        currentPrice,
        margin,
        totalPL: isNaN(totalPL) ? 0 : totalPL,
        totalPLPercent: isNaN(totalPLPercent) ? 0 : totalPLPercent,
        equity: safeEquity,
        equityRatio: isNaN(equityRatio) ? 1 : equityRatio,
        positionValue,
        value: positionValue, // alias so sortHoldings('value') works on shorts too
        liquidationPrice: getShortLiquidationPrice(margin, entryPrice, shares),
        openedAt: position.openedAt
      };
    })
    .sort((a, b) => b.positionValue - a.positionValue);
};
