// ============================================
// TRADING CALCULATIONS
// ============================================

import {
  BASE_IMPACT,
  BASE_LIQUIDITY,
  BID_ASK_SPREAD,
  MIN_PRICE,
  MAX_PRICE_CHANGE_PERCENT,
  MARGIN_CASH_MINIMUM,
  MARGIN_TIERS,
  MARGIN_MAINTENANCE_RATIO,
  MARGIN_WARNING_THRESHOLD,
  MARGIN_CALL_THRESHOLD,
  MARGIN_LIQUIDATION_THRESHOLD
} from '../constants/economy';

/**
 * Calculate price impact based on trade size and character volatility
 * Uses sqrt to make large trades proportionally less impactful
 * @param {number} amount - Number of shares traded
 * @param {number} currentPrice - Current price of the asset
 * @param {number} volatility - Character's volatility multiplier (default 1)
 * @returns {number} Price impact as a decimal (e.g., 0.05 = 5%)
 */
export const calculatePriceImpact = (amount, currentPrice, volatility = 1) => {
  // Impact increases with sqrt of shares (diminishing returns for mega trades)
  // Higher priced stocks are less impacted (more liquid)
  const liquidityFactor = Math.max(1, currentPrice / 50); // Stocks over $50 have more liquidity
  const rawImpact = (Math.sqrt(amount) * BASE_IMPACT * volatility) / liquidityFactor;

  // Cap at max price change
  return Math.min(rawImpact, MAX_PRICE_CHANGE_PERCENT);
};

/**
 * Calculate bid and ask prices with spread
 * @param {number} midPrice - The current mid price
 * @returns {{ bid: number, ask: number }} Bid and ask prices
 */
export const getBidAskPrices = (midPrice) => {
  const halfSpread = midPrice * (BID_ASK_SPREAD / 2);
  return {
    bid: Math.max(MIN_PRICE, midPrice - halfSpread),
    ask: midPrice + halfSpread
  };
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
    if (!position || position.shares <= 0) return sum;
    const currentPrice = prices[ticker] || position.entryPrice;
    const collateral = position.margin || 0;
    const pnl = (position.entryPrice - currentPrice) * position.shares;
    return sum + collateral + pnl;
  }, 0);

  return cash + holdingsValue + shortsValue;
};

/**
 * Calculate margin status for a user
 * @param {Object} userData - User data object
 * @param {Object} prices - Current prices by ticker
 * @returns {Object} Margin status including available margin, equity ratio, etc.
 */
/**
 * Helper to get margin tier multiplier based on peak portfolio achievement
 * @param {number} peakPortfolioValue - User's peak portfolio value
 * @returns {number} Tier multiplier (0.25, 0.35, 0.50, or 0.75)
 */
const getMarginTierMultiplier = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 0.75;
  if (peak >= 15000) return 0.50;
  if (peak >= 7500) return 0.35;
  return 0.25;
};

/**
 * Helper to get margin tier name for display
 * @param {number} peakPortfolioValue - User's peak portfolio value
 * @returns {string} Tier name
 */
const getMarginTierName = (peakPortfolioValue) => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 'Platinum (0.75x)';
  if (peak >= 15000) return 'Gold (0.50x)';
  if (peak >= 7500) return 'Silver (0.35x)';
  return 'Bronze (0.25x)';
};

export const calculateMarginStatus = (userData, prices) => {
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

  // Get tier multiplier based on peak portfolio achievement
  const tierMultiplier = getMarginTierMultiplier(peakPortfolio);
  const tierName = getMarginTierName(peakPortfolio);

  // Calculate total holdings value and maintenance requirement
  let holdingsValue = 0;
  let totalMaintenanceRequired = 0;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const price = prices[ticker] || 0;
      const positionValue = price * shares;
      holdingsValue += positionValue;
      totalMaintenanceRequired += positionValue * MARGIN_MAINTENANCE_RATIO;
    }
  });

  // Portfolio value = cash + holdings - margin debt
  const grossValue = cash + holdingsValue;
  const portfolioValue = grossValue - marginUsed;

  // Equity ratio = portfolio value / gross value (how much you actually own)
  const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 1;

  // NEW: Cash-based borrowing with tiered multipliers
  const maxBorrowable = Math.max(0, cash * tierMultiplier);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);

  // Determine status
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

  // Admin bypass - always eligible
  if (isAdmin) {
    return {
      eligible: true,
      requirements: [
        { met: true, label: '10+ daily check-ins', current: '∞', required: 10 },
        { met: true, label: '35+ total trades', current: '∞', required: 35 },
        { met: true, label: '$2,000+ cash balance', current: '∞', required: 2000 }
      ]
    };
  }

  const totalCheckins = userData.totalCheckins || 0;
  const totalTrades = userData.totalTrades || 0;
  const cash = userData.cash || 0;

  const requirements = [
    { met: totalCheckins >= 10, label: '10+ daily check-ins', current: totalCheckins, required: 10 },
    { met: totalTrades >= 35, label: '35+ total trades', current: totalTrades, required: 35 },
    { met: cash >= MARGIN_CASH_MINIMUM, label: '$2,000+ cash balance', current: cash, required: MARGIN_CASH_MINIMUM }
  ];

  const allMet = requirements.every(r => r.met);

  return {
    eligible: allMet,
    requirements
  };
};
