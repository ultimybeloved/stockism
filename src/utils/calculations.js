// ============================================
// TRADING CALCULATIONS
// ============================================

import {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  BID_ASK_SPREAD,
  ETF_BID_ASK_SPREAD,
  MIN_PRICE,
  MAX_PRICE_CHANGE_PERCENT,
  MARGIN_MAINTENANCE_RATIO,
  MARGIN_WARNING_THRESHOLD,
  MARGIN_CALL_THRESHOLD,
  MARGIN_LIQUIDATION_THRESHOLD
} from '../constants/economy';
import { CHARACTER_MAP } from '../characters';

/**
 * Get current price from priceHistory (source of truth) or fall back to prices/basePrice
 * @param {string} ticker
 * @param {Object} priceHistory - ticker → [{price, ts}] map
 * @param {Object} prices - ticker → price map
 * @returns {number}
 */
export const getCurrentPrice = (ticker, priceHistory, prices) => {
  const history = priceHistory?.[ticker];
  if (history && history.length > 0) {
    return history[history.length - 1].price;
  }
  return prices?.[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
};

/**
 * Calculate price impact based on trade size and character volatility
 * Uses sqrt to make large trades proportionally less impactful
 * @param {number} amount - Number of shares traded
 * @param {number} currentPrice - Current price of the asset
 * @param {number} volatility - Character's volatility multiplier (default 1)
 * @returns {number} Price impact as a decimal (e.g., 0.05 = 5%)
 */
export const calculatePriceImpact = (amount, currentPrice, volatility = 1, cumulativeVolume = 0) => {
  // Marginal impact: makes splitting trades give same total impact as bulk buying
  // impact = BASE_IMPACT * (sqrt((cumBefore + new) / BASE_LIQUIDITY) - sqrt(cumBefore / BASE_LIQUIDITY))
  const liquidityFactor = Math.max(1, currentPrice / 50); // Stocks over $50 have more liquidity
  const rawImpact = (BASE_IMPACT * volatility *
    (Math.sqrt((cumulativeVolume + amount) / BASE_LIQUIDITY) - Math.sqrt(cumulativeVolume / BASE_LIQUIDITY))
  ) / liquidityFactor;

  // Cap at max price change
  return Math.min(rawImpact, MAX_PRICE_CHANGE_PERCENT);
};

/**
 * Calculate bid and ask prices with spread
 * @param {number} midPrice - The current mid price
 * @returns {{ bid: number, ask: number }} Bid and ask prices
 */
export const getBidAskPrices = (midPrice, isETF = false) => {
  const spread = isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;
  const halfSpread = midPrice * (spread / 2);
  return {
    bid: Math.max(MIN_PRICE, midPrice - halfSpread),
    ask: midPrice + halfSpread,
    spread: halfSpread * 2
  };
};

/**
 * Calculate price impact as an absolute dollar amount using the marginal (cumulative) model.
 * Used for UI previews in the trade modal.
 * @param {number} currentPrice - Mid price of the asset
 * @param {number} shares - Number of shares being traded
 * @param {number} liquidity - Liquidity factor (default BASE_LIQUIDITY)
 * @param {number} cumulativeVolume - Shares already traded in the rolling window
 * @returns {number} Dollar impact (e.g., 0.50 = 50¢ price move)
 */
export const calculatePriceImpactDollars = (currentPrice, shares, liquidity = BASE_LIQUIDITY, cumulativeVolume = 0) => {
  return currentPrice * BASE_IMPACT * (
    Math.sqrt((cumulativeVolume + shares) / liquidity) - Math.sqrt(cumulativeVolume / liquidity)
  );
};

/**
 * Calculate new price after a trade
 * @param {number} currentPrice - Current price
 * @param {number} amount - Shares traded
 * @param {boolean} isBuy - True if buying, false if selling
 * @param {number} volatility - Character's volatility multiplier
 * @returns {number} New mid price after impact
 */
export const calculateNewPrice = (currentPrice, amount, isBuy, volatility = 1) => {
  const impact = calculatePriceImpact(amount, currentPrice, volatility);
  const direction = isBuy ? 1 : -1;
  const newPrice = currentPrice * (1 + (impact * direction));
  return Math.max(MIN_PRICE, Math.round(newPrice * 100) / 100);
};

/**
 * Calculate portfolio value including holdings and shorts
 * @param {Object} userData - User data object
 * @param {Object} prices - Current prices by ticker
 * @returns {number} Total portfolio value
 */
export const calculatePortfolioValue = (userData, prices) => {
  if (!userData || !prices) return 0;

  const cash = userData.cash || 0;
  const holdings = userData.holdings || {};
  const shorts = userData.shorts || {};

  // Calculate holdings value
  const holdingsValue = Object.entries(holdings).reduce((sum, [ticker, shares]) => {
    return sum + (prices[ticker] || 0) * shares;
  }, 0);

  // Calculate shorts value (collateral + unrealized P&L)
  const shortsValue = Object.entries(shorts).reduce((sum, [ticker, position]) => {
    if (!position || typeof position !== 'object') return sum;
    const shares = Number(position.shares) || 0;
    if (shares <= 0) return sum;
    const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
    const currentPrice = Number(prices[ticker]) || Number(entryPrice) || 0;
    const collateral = Number(position.margin) || 0;
    let value;
    if (position.system === 'v2') {
      // v2: margin + unrealized P&L (no proceeds in cash)
      value = collateral + (entryPrice - currentPrice) * shares;
    } else {
      // Legacy: margin collateral - cost to buy back shares
      value = collateral - (currentPrice * shares);
    }
    return sum + (isNaN(value) ? 0 : value);
  }, 0);

  return cash + holdingsValue + shortsValue;
};

/**
 * Calculate margin status for a user
 * @param {Object} userData - User data object
 * @param {Object} prices - Current prices by ticker
 * @returns {Object} Margin status including available margin, equity ratio, etc.
 */
export const getMarginTierMultiplier = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 0.75;
  if (peak >= 15000) return 0.50;
  if (peak >= 7500) return 0.35;
  return 0.25;
};

export const getMarginTierName = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 'Platinum (0.75x)';
  if (peak >= 15000) return 'Gold (0.50x)';
  if (peak >= 7500) return 'Silver (0.35x)';
  return 'Bronze (0.25x)';
};

export const calculateMarginStatus = (userData, prices, priceHistory = {}) => {
  if (!userData || !userData.marginEnabled) {
    return {
      enabled: false,
      marginUsed: 0,
      availableMargin: 0,
      maxBorrowable: 0,
      tierMultiplier: 0,
      tierName: 'N/A',
      portfolioValue: 0,
      totalMaintenanceRequired: 0,
      equityRatio: 1,
      status: 'disabled'
    };
  }

  const cash = userData.cash || 0;
  const holdings = userData.holdings || {};
  const marginUsed = userData.marginUsed || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  const tierMultiplier = getMarginTierMultiplier(peakPortfolio);
  const tierName = getMarginTierName(peakPortfolio);

  let holdingsValue = 0;
  let totalMaintenanceRequired = 0;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const price = getCurrentPrice(ticker, priceHistory, prices);
      const positionValue = price * shares;
      holdingsValue += positionValue;
      totalMaintenanceRequired += positionValue * MARGIN_MAINTENANCE_RATIO;
    }
  });

  // Cash can't go below zero in equity calculation (prevents false liquidations)
  const grossValue = Math.max(0, cash) + holdingsValue;
  const portfolioValue = grossValue - marginUsed;
  const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 1;

  const maxBorrowable = Math.max(0, cash * tierMultiplier);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);

  let status = 'safe';
  if (marginUsed > 0) {
    if (equityRatio <= MARGIN_LIQUIDATION_THRESHOLD) {
      status = 'liquidation';
    } else if (equityRatio <= MARGIN_CALL_THRESHOLD) {
      status = 'margin_call';
    } else if (equityRatio <= MARGIN_WARNING_THRESHOLD) {
      status = 'warning';
    }
  }

  return {
    enabled: true,
    marginUsed,
    availableMargin: Math.round(availableMargin * 100) / 100,
    maxBorrowable: Math.round(maxBorrowable * 100) / 100,
    tierMultiplier,
    tierName,
    portfolioValue: Math.round(portfolioValue * 100) / 100,
    grossValue: Math.round(grossValue * 100) / 100,
    holdingsValue: Math.round(holdingsValue * 100) / 100,
    totalMaintenanceRequired: Math.round(totalMaintenanceRequired * 100) / 100,
    equityRatio: Math.round(equityRatio * 1000) / 1000,
    status,
    marginCallAt: userData.marginCallAt || null
  };
};

/**
 * Check if user qualifies for margin trading
 * @param {Object} userData - User data object
 * @param {boolean} isAdmin - Whether user is admin (always eligible)
 * @returns {Object} Eligibility status and requirements
 */
export const checkMarginEligibility = (userData, isAdmin = false) => {
  if (!userData) return { eligible: false, requirements: [] };

  if (isAdmin) {
    return {
      eligible: true,
      requirements: [
        { met: true, label: '10+ daily check-ins', current: '∞', required: 10 },
        { met: true, label: '35+ total trades', current: '∞', required: 35 },
        { met: true, label: '$7,500+ peak portfolio', current: '∞', required: 7500 }
      ]
    };
  }

  const totalCheckins = userData.totalCheckins || 0;
  const totalTrades = userData.totalTrades || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  const requirements = [
    { met: totalCheckins >= 10, label: '10+ daily check-ins', current: totalCheckins, required: 10 },
    { met: totalTrades >= 35, label: '35+ total trades', current: totalTrades, required: 35 },
    { met: peakPortfolio >= 7500, label: '$7,500+ peak portfolio', current: peakPortfolio, required: 7500 }
  ];

  return {
    eligible: requirements.every(r => r.met),
    requirements
  };
};
