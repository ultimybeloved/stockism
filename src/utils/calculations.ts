// ============================================
// TRADING CALCULATIONS
// ============================================

import {
  BASE_LIQUIDITY,
  BID_ASK_SPREAD,
  ETF_BID_ASK_SPREAD,
  MIN_PRICE,
  MARGIN_MAINTENANCE_RATIO,
  MARGIN_WARNING_THRESHOLD,
  MARGIN_DANGER_THRESHOLD,
  MARGIN_CALL_THRESHOLD,
  MARGIN_LIQUIDATION_THRESHOLD,
  SHORT_MARGIN_CALL_THRESHOLD,
  SHORT_MARGIN_WARNING_THRESHOLD,
  SHORT_MARGIN_REQUIREMENT,
  LEGACY_SHORT_MARGIN_RATIO,
  MARGIN_MIN_CHECKINS,
  MARGIN_MIN_TRADES,
  MARGIN_MIN_PEAK_PORTFOLIO,
} from '../constants/economy';
import { CHARACTER_MAP } from '../characters';
import type { PriceHistory, PriceMap, ShareMap, ShortMap, ShortPosition, Ticker, UserData } from '../types';
import {
  calculateMarginalImpact,
  traderMarginalImpact,
  accountAgeImpactFactor,
  liquidityFor,
  maxTradeSharesFor,
} from '../rules/impact';
import { exitEquityAt, getTotalInvested as sharedTotalInvested } from '../rules/equity';

/**
 * Get current price from priceHistory (source of truth) or fall back to prices/basePrice
 * @param {string} ticker
 * @param {Object} priceHistory - ticker → [{price, ts}] map
 * @param {Object} prices - ticker → price map
 * @returns {number}
 */
export const getCurrentPrice = (
  ticker: Ticker,
  priceHistory: PriceHistory | null | undefined,
  prices: PriceMap | null | undefined,
): number => {
  const history = priceHistory?.[ticker];
  if (history && history.length > 0) {
    return history[history.length - 1]!.price;
  }
  return prices?.[ticker] || CHARACTER_MAP[ticker]?.basePrice || 0;
};

/**
 * Calculate bid and ask prices with spread
 * @param {number} midPrice - The current mid price
 * @returns {{ bid: number, ask: number }} Bid and ask prices
 */
export const getBidAskPrices = (midPrice: number, isETF: boolean | undefined = false) => {
  const spread = isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;
  const halfSpread = midPrice * (spread / 2);
  return {
    bid: Math.max(MIN_PRICE, midPrice - halfSpread),
    ask: midPrice + halfSpread,
    spread: halfSpread * 2,
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
// Impact maths: the shared rule module, run by the server for every fill.
export { liquidityFor, maxTradeSharesFor };

export const calculatePriceImpactDollars = (
  currentPrice: number,
  shares: number,
  liquidity: number = BASE_LIQUIDITY,
  cumulativeVolume = 0,
): number => calculateMarginalImpact(currentPrice, shares, cumulativeVolume, liquidity);

/**
 * What the TRADER is charged, as opposed to how far the market moves.
 *
 * The two differ only on an oversized order. The market move is capped at
 * MAX_PRICE_CHANGE_PERCENT so one trade can't crater a stock; the trader pays
 * the real marginal cost of the size they moved, bounded at
 * OVERSIZED_IMPACT_MULTIPLE x that cap. Below the cap both return the same
 * number. Mirrors traderMarginalImpact in functions/src/shared/helpers.js — if you change
 * one, change both, and re-run `npm test` plus `npm run test:trading`.
 */
export const calculateTraderImpactDollars = (
  currentPrice: number,
  shares: number,
  liquidity: number = BASE_LIQUIDITY,
  cumulativeVolume = 0,
): number => traderMarginalImpact(currentPrice, shares, cumulativeVolume, liquidity);

/**
 * Price at which a short gets auto force-covered (its equity ratio hits
 * SHORT_MARGIN_CALL_THRESHOLD). This is the price the ticker has to RISE to.
 * Mirrors checkShortMarginCalls in functions/src/margin/margin.js.
 * @param {number} margin - collateral posted on the short
 * @param {number} entryPrice - average short entry / cost basis
 * @param {number} shares - shares shorted
 * @returns {number|null} force-cover price, or null for an empty position
 */
/**
 * Estimated cash total for a prospective trade (confirmation preview).
 * Mirrors the backend execution math: impact-adjusted bid/ask, full short
 * collateral, and v2 cover margin return. ageFactor scales impact down for
 * new accounts.
 *
 * `cumulativeVolume` is this player's rolling 24h volume on this ticker for
 * this action, and it is not optional in practice. Impact is marginal — the
 * server prices every order against what the player has already moved today —
 * so leaving it at 0 quoted a second trade at first-trade prices. The trade
 * form and this preview disagreed by exactly that much, one screen apart.
 */
export const estimateTradeTotal = ({
  action,
  price,
  amount,
  isETF,
  ageFactor = 1,
  shortPosition,
  exitDiscount = 0,
  cumulativeVolume = 0,
  liquidity = BASE_LIQUIDITY,
}: {
  action: string;
  price: number;
  amount: number;
  isETF?: boolean;
  ageFactor?: number;
  shortPosition?: ShortPosition | null;
  exitDiscount?: number;
  cumulativeVolume?: number;
  liquidity?: number;
}): number => {
  // The preview quotes what the player will actually be charged, so it uses the
  // TRADER impact. calculatePriceImpactDollars stays the market-move number.
  const priceImpact = calculateTraderImpactDollars(price, amount, liquidity, cumulativeVolume) * ageFactor;
  if (action === 'buy') {
    const { ask } = getBidAskPrices(price + priceImpact, isETF);
    return ask * amount;
  }
  if (action === 'sell') {
    // Exit loyalty prices the seller against a reduced impact — mirrors
    // computeSell in functions/src/trading/tradeActions.js.
    const sellerImpact = priceImpact * (1 - exitDiscount);
    const { bid } = getBidAskPrices(Math.max(MIN_PRICE, price - sellerImpact), isETF);
    return bid * amount;
  }
  if (action === 'short') {
    // Collateral is charged on the CURRENT mid price, not the price the short
    // pushes it to — computeShort uses `currentPrice * amount *
    // SHORT_MARGIN_RATIO`. Quoting it off the impacted bid understated the
    // deposit by the impact plus half the spread on every short.
    return price * amount * SHORT_MARGIN_REQUIREMENT; // collateral deposited
  }
  if (action === 'cover') {
    const { ask } = getBidAskPrices(price + priceImpact, isETF);
    if (shortPosition?.system === 'v2') {
      const costBasis = shortPosition.costBasis || 0;
      const totalMargin = shortPosition.margin || 0;
      const marginBack = shortPosition.shares > 0 ? (totalMargin / shortPosition.shares) * amount : 0;
      return marginBack + (costBasis - ask) * amount;
    }
    return ask * amount;
  }
  return price * amount;
};

export const getShortLiquidationPrice = (margin: number, entryPrice: number, shares: number): number | null => {
  if (!shares || shares <= 0) return null;
  return (margin + entryPrice * shares) / (shares * (1 + SHORT_MARGIN_CALL_THRESHOLD));
};

/**
 * Collateral backing a short. Falls back to the rate the position was opened at
 * when `margin` is missing, matching depositedMargin() in functions/services/
 * margin.js — the server force-covers on this number, so a different guess here
 * shows the player a risk bar the server disagrees with.
 * @param {Object} position - short position ({ shares, margin, costBasis/entryPrice, system })
 * @returns {number}
 */
export const getShortMargin = (position: ShortPosition | null | undefined): number => {
  const stored = Number(position?.margin) || 0;
  if (stored > 0) return stored;
  const shares = Number(position?.shares) || 0;
  const entryPrice = Number(position?.costBasis || position?.entryPrice) || 0;
  const ratio = (position?.system || 'v2') === 'v2' ? SHORT_MARGIN_REQUIREMENT : LEGACY_SHORT_MARGIN_RATIO;
  return entryPrice * shares * ratio;
};

/**
 * Risk snapshot for an open short at the current price. Mirrors the equity-ratio
 * check in checkShortMarginCalls (functions/src/margin/margin.js).
 * @param {Object} position - short position ({ shares, margin, costBasis/entryPrice })
 * @param {number} currentPrice
 * @returns {{equityRatio:number, equity:number, margin:number, liquidationPrice:number|null, isAtRisk:boolean, isCritical:boolean}|null}
 */
export const getShortRisk = (position: ShortPosition | null | undefined, currentPrice: number) => {
  if (!position || !(Number(position.shares) > 0)) return null;
  const shares = Number(position.shares) || 0;
  const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
  const margin = getShortMargin(position);
  const equity = margin + (entryPrice - currentPrice) * shares;
  const positionValue = currentPrice * shares;
  const equityRatio = positionValue > 0 ? equity / positionValue : 1;
  return {
    equityRatio,
    equity,
    margin,
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
export const calculatePortfolioValue = (
  userData: UserData | null | undefined,
  prices: PriceMap | null | undefined,
): number => {
  if (!userData || !prices) return 0;

  const cash = userData.cash || 0;
  const holdings: ShareMap = userData.holdings || {};
  const shorts: ShortMap = userData.shorts || {};

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
    let value: number;
    if (position.system === 'v2') {
      // v2: margin + unrealized P&L (no proceeds in cash)
      value = collateral + (entryPrice - currentPrice) * shares;
    } else {
      // Legacy: margin collateral - cost to buy back shares
      value = collateral - currentPrice * shares;
    }
    return sum + (isNaN(value) ? 0 : value);
  }, 0);

  return cash + holdingsValue + shortsValue;
};

/**
 * What an account would actually walk away with: every holding sold and every
 * short covered, one order each, at the price that order pushes the stock to.
 * Less any margin loan. Mirror of exitEquityAt in functions/src/shared/helpers.js, which
 * seasons are scored on, so a paper gain from pumping a thin stock can't count.
 * @param {Object} userData - User data object
 * @param {Object} prices - Current prices by ticker
 * @returns {number} Exit value
 */
export const calculateExitValue = (
  userData: UserData | null | undefined,
  prices: PriceMap | null | undefined,
): number => (!userData || !prices ? 0 : exitEquityAt(userData, prices));

/**
 * Calculate margin status for a user
 * @param {Object} userData - User data object
 * @param {Object} prices - Current prices by ticker
 * @returns {Object} Margin status including available margin, equity ratio, etc.
 */
export const getMarginTierMultiplier = (peakPortfolioValue: number | null | undefined): number => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 0.75;
  if (peak >= 15000) return 0.5;
  if (peak >= 7500) return 0.35;
  return 0.25;
};

export const getMarginTierName = (peakPortfolioValue: number | null | undefined): string => {
  const peak = peakPortfolioValue || 0;
  if (peak >= 30000) return 'Platinum (0.75x)';
  if (peak >= 15000) return 'Gold (0.50x)';
  if (peak >= 7500) return 'Silver (0.35x)';
  return 'Bronze (0.25x)';
};

export type MarginStatusLevel = 'disabled' | 'safe' | 'warning' | 'danger' | 'margin_call' | 'liquidation';

export interface MarginStatus {
  enabled: boolean;
  marginUsed: number;
  availableMargin: number;
  maxBorrowable: number;
  borrowBase?: number;
  tierMultiplier: number;
  tierName: string;
  portfolioValue: number;
  grossValue?: number;
  holdingsValue?: number;
  totalMaintenanceRequired: number;
  equityRatio: number;
  status: MarginStatusLevel;
  marginCallAt?: UserData['marginCallAt'];
}

export const calculateMarginStatus = (
  userData: UserData | null | undefined,
  prices: PriceMap | null | undefined,
  priceHistory: PriceHistory = {},
): MarginStatus => {
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
      status: 'disabled',
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

  let status: MarginStatusLevel = 'safe';
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
    marginCallAt: userData.marginCallAt || null,
  };
};

/**
 * Check if user qualifies for margin trading.
 *
 * This drives the requirements checklist in MarginModal. toggleMargin in
 * functions/src/margin/margin.js enforces the identical thresholds server-side,
 * so this is display logic, not the gate. Change one, change both.
 *
 * @param {Object} userData - User data object
 * @param {boolean} isAdmin - Whether user is admin (always eligible)
 * @returns {Object} Eligibility status and requirements
 */
export interface MarginRequirement {
  met: boolean;
  label: string;
  current: number | string;
  required: number;
}

export const checkMarginEligibility = (
  userData: UserData | null | undefined,
  isAdmin = false,
): { eligible: boolean; requirements: MarginRequirement[] } => {
  if (!userData) return { eligible: false, requirements: [] };

  const labels = [
    `${MARGIN_MIN_CHECKINS}+ daily check-ins`,
    `${MARGIN_MIN_TRADES}+ total trades`,
    `$${MARGIN_MIN_PEAK_PORTFOLIO.toLocaleString()}+ peak portfolio`,
  ];
  const thresholds = [MARGIN_MIN_CHECKINS, MARGIN_MIN_TRADES, MARGIN_MIN_PEAK_PORTFOLIO];

  if (isAdmin) {
    return {
      eligible: true,
      requirements: labels.map((label, i) => ({
        met: true,
        label,
        current: '∞',
        required: thresholds[i]!,
      })),
    };
  }

  const totalCheckins = userData.totalCheckins || 0;
  const totalTrades = userData.totalTrades || 0;
  const peakPortfolio = userData.peakPortfolioValue || 0;

  const currents = [totalCheckins, totalTrades, peakPortfolio];
  const requirements = labels.map((label, i) => ({
    met: currents[i]! >= thresholds[i]!,
    label,
    current: currents[i]!,
    required: thresholds[i]!,
  }));

  return {
    eligible: requirements.every((r) => r.met),
    requirements,
  };
};

/**
 * Total a user has "invested" in stocks: cost basis of holdings + open short margin.
 * Used to cap prediction bets and ladder-game deposits. Mirrors functions/src/shared/helpers.js.
 */
export const getTotalInvested = (
  holdings: ShareMap | null | undefined = {},
  costBasis: Record<Ticker, number> | null | undefined = {},
  shorts: ShortMap | null | undefined = {},
): number => sharedTotalInvested({ holdings: holdings || {}, costBasis: costBasis || {}, shorts: shorts || {} });

// LMSR event-market pricing: the shared rule module, also run by the server.
export { lmsrCost, lmsrPrices, lmsrBuyCost, lmsrSellRefund, lmsrSeedQ, maxAffordableShares } from '../rules/lmsr';

// A "nice" round increment for +/- steppers: ~5% of `limit`, snapped to 1/2/5 × a
// power of ten (1, 2, 5, 10, 20, 50, ...). Always at least `min`. Lets the +/-
// buttons scale to the player's actual limit instead of fixed amounts.
export const niceStep = (limit: unknown, min = 1): number => {
  const target = Math.max(min, (Number(limit) || 0) / 20);
  const mag = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / mag;
  const snapped = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return Math.max(min, snapped * mag);
};

/**
 * Reduced price impact for new accounts (anti-manipulation). Mirrors
 * getAccountAgeImpactFactor in functions/src/shared/helpers.js — change both together.
 * @param {Object} userData
 * @returns {number} multiplier in [NEW_ACCOUNT_MIN_IMPACT_FACTOR, 1]
 */
export const getAccountAgeImpactFactor = (userData: UserData | null | undefined): number => {
  const createdAt = userData?.createdAt;
  if (!createdAt) return 1;
  const createdMs =
    typeof createdAt === 'object' && 'toMillis' in createdAt && typeof createdAt.toMillis === 'function'
      ? createdAt.toMillis()
      : typeof createdAt === 'number'
        ? createdAt
        : Date.parse(createdAt as string);
  if (!createdMs || isNaN(createdMs)) return 1;
  return accountAgeImpactFactor((Date.now() - createdMs) / (1000 * 60 * 60 * 24));
};
