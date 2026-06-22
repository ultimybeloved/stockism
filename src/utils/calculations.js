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
  MARGIN_DANGER_THRESHOLD,
  MARGIN_CALL_THRESHOLD,
  MARGIN_LIQUIDATION_THRESHOLD,
  SHORT_MARGIN_CALL_THRESHOLD,
  SHORT_MARGIN_WARNING_THRESHOLD
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
  const rawImpact = currentPrice * BASE_IMPACT * (
    Math.sqrt((cumulativeVolume + shares) / liquidity) - Math.sqrt(cumulativeVolume / liquidity)
  );
  // Match the backend (calculateMarginalImpact): a single trade moves the price by at
  // most MAX_PRICE_CHANGE_PERCENT, so the preview can't overstate large trades.
  return Math.min(rawImpact, currentPrice * MAX_PRICE_CHANGE_PERCENT);
};

/**
 * Price at which a short gets auto force-covered (its equity ratio hits
 * SHORT_MARGIN_CALL_THRESHOLD). This is the price the ticker has to RISE to.
 * Mirrors checkShortMarginCalls in functions/services/margin.js.
 * @param {number} margin - collateral posted on the short
 * @param {number} entryPrice - average short entry / cost basis
 * @param {number} shares - shares shorted
 * @returns {number|null} force-cover price, or null for an empty position
 */
export const getShortLiquidationPrice = (margin, entryPrice, shares) => {
  if (!shares || shares <= 0) return null;
  return (margin + entryPrice * shares) / (shares * (1 + SHORT_MARGIN_CALL_THRESHOLD));
};

/**
 * Risk snapshot for an open short at the current price. Mirrors the equity-ratio
 * check in checkShortMarginCalls (functions/services/margin.js).
 * @param {Object} position - short position ({ shares, margin, costBasis/entryPrice })
 * @param {number} currentPrice
 * @returns {{equityRatio:number, liquidationPrice:number|null, isAtRisk:boolean, isCritical:boolean}|null}
 */
export const getShortRisk = (position, currentPrice) => {
  if (!position || !(Number(position.shares) > 0)) return null;
  const shares = Number(position.shares) || 0;
  const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
  const margin = Number(position.margin) || 0;
  const equity = margin + (entryPrice - currentPrice) * shares;
  const positionValue = currentPrice * shares;
  const equityRatio = positionValue > 0 ? equity / positionValue : 1;
  return {
    equityRatio,
    liquidationPrice: getShortLiquidationPrice(margin, entryPrice, shares),
    isAtRisk: equityRatio < SHORT_MARGIN_WARNING_THRESHOLD,
    isCritical: equityRatio < SHORT_MARGIN_CALL_THRESHOLD,
  };
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
  const costBasis = userData.costBasis || {};
  const peakPortfolio = userData.peakPortfolioValue || 0;

  const tierMultiplier = getMarginTierMultiplier(peakPortfolio);
  const tierName = getMarginTierName(peakPortfolio);

  let holdingsValue = 0;
  let totalMaintenanceRequired = 0;
  // Collateral for borrowing power: value holdings at the LOWER of cost basis or
  // current price. A player can't inflate their limit by pumping a stock they hold
  // (paper gains don't count), and can't borrow against a crashed cost basis either.
  let collateralValue = 0;

  Object.entries(holdings).forEach(([ticker, shares]) => {
    if (shares > 0) {
      const price = getCurrentPrice(ticker, priceHistory, prices);
      const positionValue = price * shares;
      holdingsValue += positionValue;
      totalMaintenanceRequired += positionValue * MARGIN_MAINTENANCE_RATIO;
      collateralValue += Math.min(costBasis[ticker] || 0, price) * shares;
    }
  });

  const grossValue = cash + holdingsValue;
  const portfolioValue = grossValue - marginUsed;
  const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 0;

  // Borrowing power scales with invested value (cash + cost-based collateral − debt),
  // not just idle cash, so a fully-invested portfolio can still use margin.
  const borrowBase = Math.max(0, cash + collateralValue - marginUsed);
  const maxBorrowable = Math.max(0, borrowBase * tierMultiplier);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);

  let status = 'safe';
  if (marginUsed > 0) {
    if (equityRatio <= MARGIN_LIQUIDATION_THRESHOLD) {
      status = 'liquidation';
    } else if (equityRatio <= MARGIN_CALL_THRESHOLD || userData.marginCallAt) {
      status = 'margin_call';
    } else if (equityRatio <= MARGIN_DANGER_THRESHOLD) {
      status = 'danger';
    } else if (equityRatio <= MARGIN_WARNING_THRESHOLD) {
      status = 'warning';
    }
  }

  return {
    enabled: true,
    marginUsed,
    availableMargin: Math.round(availableMargin * 100) / 100,
    maxBorrowable: Math.round(maxBorrowable * 100) / 100,
    borrowBase: Math.round(borrowBase * 100) / 100,
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

/**
 * Total a user has "invested" in stocks: cost basis of holdings + open short margin.
 * Used to cap prediction bets and ladder-game deposits. Mirrors functions/helpers.js.
 */
export const getTotalInvested = (holdings = {}, costBasis = {}, shorts = {}) => {
  const holdingsValue = Object.entries(holdings || {}).reduce(
    (sum, [ticker, shares]) => sum + ((costBasis?.[ticker] || 0) * (shares || 0)), 0
  );
  const shortMargin = Object.values(shorts || {}).reduce(
    (sum, s) => sum + (s && s.shares > 0 ? (s.margin || 0) : 0), 0
  );
  return holdingsValue + shortMargin;
};

// ── LMSR event-market pricing ────────────────────────────────────────────────
// Logarithmic Market Scoring Rule for long-term event share markets.
// `q` = array of shares outstanding per outcome, `b` = liquidity parameter.
// Prices always sum to 1 and stay in (0,1). Mirror of functions/helpers.js — keep in sync.
const _lse = (xs) => {
  const m = Math.max(...xs);
  return m + Math.log(xs.reduce((s, x) => s + Math.exp(x - m), 0));
};
export const lmsrCost = (q, b) => b * _lse(q.map((x) => x / b));
export const lmsrPrices = (q, b) => {
  const xs = q.map((x) => x / b);
  const m = Math.max(...xs);
  const ex = xs.map((x) => Math.exp(x - m));
  const sum = ex.reduce((a, c) => a + c, 0);
  return ex.map((e) => e / sum);
};
export const lmsrBuyCost = (q, b, idx, shares) => {
  const after = q.slice();
  after[idx] += shares;
  return lmsrCost(after, b) - lmsrCost(q, b);
};
export const lmsrSellRefund = (q, b, idx, shares) => {
  const after = q.slice();
  after[idx] -= shares;
  return lmsrCost(q, b) - lmsrCost(after, b);
};

// A "nice" round increment for +/- steppers: ~5% of `limit`, snapped to 1/2/5 × a
// power of ten (1, 2, 5, 10, 20, 50, ...). Always at least `min`. Lets the +/-
// buttons scale to the player's actual limit instead of fixed amounts.
export const niceStep = (limit, min = 1) => {
  const target = Math.max(min, (Number(limit) || 0) / 20);
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / mag;
  const snapped = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return Math.max(min, snapped * mag);
};

// Largest whole number of shares whose LMSR buy cost stays within `budget`.
// Powers the "Max" button on long-term event markets (cost is non-linear, so we
// can't just divide). Exponential search for a bound, then binary search.
export const maxAffordableShares = (q, b, idx, budget) => {
  if (!(budget > 0)) return 0;
  let hi = 1;
  while (hi < 1e7 && lmsrBuyCost(q, b, idx, hi) <= budget) hi *= 2;
  let lo = Math.floor(hi / 2);
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (lmsrBuyCost(q, b, idx, mid) <= budget) lo = mid;
    else hi = mid - 1;
  }
  return lo;
};
