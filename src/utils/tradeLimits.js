// Pure trade-form math: rolling 24h per-ticker limits, dynamic bid/ask under
// impact, buying power, and max-shares for each action. Mirrors the backend.

import {
  BASE_LIQUIDITY,
  MIN_PRICE,
  SHORT_MARGIN_REQUIREMENT,
  MAX_TRADES_PER_TICKER_24H
} from '../constants';
import {
  calculatePortfolioValue,
  calculatePriceImpactDollars,
  getBidAskPrices,
  calculateMarginStatus
} from './calculations';

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export const pruneAndSumTradeHistory = (entries, now) => {
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  const recent = (entries || []).filter(e => e.ts > cutoff);
  const totalShares = recent.reduce((sum, e) => sum + (e.shares || 0), 0);
  const totalImpact = recent.reduce((sum, e) => sum + (e.impact || 0), 0);
  // count = real trades only. Synthetic ETF trailing entries (shares: 0) feed the
  // impact cap but must NOT count toward the 10-trades-per-ticker cap.
  const realCount = recent.reduce((n, e) => n + ((e.shares || 0) > 0 ? 1 : 0), 0);
  return { recent, totalShares, totalImpact, count: realCount };
};

// Cumulative volume for this ticker+action from rolling 24h history
export const getCumulativeVolume = (userData, ticker, act) => {
  const history = userData?.tickerTradeHistory?.[ticker]?.[act] || [];
  return pruneAndSumTradeHistory(history, Date.now()).totalShares;
};

// Trade count for this ticker+action from rolling 24h history
export const getTradeCount = (userData, ticker, act) => {
  const history = userData?.tickerTradeHistory?.[ticker]?.[act] || [];
  return pruneAndSumTradeHistory(history, Date.now()).count;
};

// Dynamic bid/ask after the marginal impact of this order
export const getDynamicPrices = (character, price, amt, act, userData) => {
  const liquidity = character.liquidity || BASE_LIQUIDITY;
  const cumVol = getCumulativeVolume(userData, character.ticker, act);
  const impact = calculatePriceImpactDollars(price, amt, liquidity, cumVol);

  if (act === 'buy' || act === 'cover') {
    return getBidAskPrices(price + impact, character.isETF);
  }
  return getBidAskPrices(Math.max(MIN_PRICE, price - impact), character.isETF);
};

// Cash plus any available margin
export const getBuyingPower = (userCash, userData, prices, priceHistory) => {
  let buyingPower = userCash;
  if (userData && prices) {
    const marginStatus = calculateMarginStatus(userData, prices, priceHistory);
    if (marginStatus.enabled && marginStatus.availableMargin > 0) {
      // Use the full available margin, matching what the backend allows. (This
      // was Math.min(cash, availableMargin) — a no-op under the old cash-based
      // model, but it throttled buying power once margin scaled with portfolio.)
      buyingPower += marginStatus.availableMargin;
    }
  }
  return buyingPower;
};

// Max shares available for this action, honoring trade-count caps, locks,
// buying power (buy), and short collateral limits.
export const getMaxShares = ({ action, character, price, holdings, shortPosition, userCash, userData, prices, priceHistory }) => {
  const ticker = character.ticker;
  if (action === 'buy') {
    // Check trade count limit first
    if (getTradeCount(userData, ticker, 'buy') >= MAX_TRADES_PER_TICKER_24H) return 0;

    const buyingPower = getBuyingPower(userCash, userData, prices, priceHistory);
    if (buyingPower <= 0) return 0;
    // Binary search; the /0.5 just over-estimates the upper bound, which is safe.
    let low = 1, high = Math.floor(buyingPower / (price * 0.5)), maxAffordable = 0;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const { ask } = getDynamicPrices(character, price, mid, 'buy', userData);
      if (ask * mid <= buyingPower) {
        maxAffordable = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    // Fine-tune fractional: check if 0.1 increments beyond integer max fit
    let fractionalBonus = 0;
    for (let f = 1; f <= 9; f++) {
      const candidate = maxAffordable + f * 0.1;
      const { ask } = getDynamicPrices(character, price, candidate, 'buy', userData);
      if (ask * candidate <= buyingPower) fractionalBonus = f * 0.1;
      else break;
    }

    return Math.max(0, Math.round((maxAffordable + fractionalBonus) * 100) / 100);
  }
  if (action === 'sell') {
    if (getTradeCount(userData, ticker, 'sell') >= MAX_TRADES_PER_TICKER_24H) return 0;
    // Locked shares (IPO / margin holds) aren't sellable; mirror the server.
    const lockNow = Date.now();
    const lockedOf = (lock) => (lock && lockNow < (lock.until || 0)) ? (lock.shares || 0) : 0;
    const lockedSell = lockedOf(userData?.ipoLockup?.[ticker]) + lockedOf(userData?.marginLockup?.[ticker]);
    return Math.max(0, (holdings || 0) - lockedSell);
  }
  if (action === 'short') {
    if (getTradeCount(userData, ticker, 'short') >= MAX_TRADES_PER_TICKER_24H) return 0;

    // Max short is capped by portfolio equity (prevents leverage spiral)
    const portfolioEquity = userData && prices ? calculatePortfolioValue(userData, prices) : userCash;
    if (portfolioEquity <= 0) return 0;

    // Total short margin (existing + new) can't exceed portfolio equity
    const shorts = userData?.shorts || {};
    const existingShortMargin = Object.values(shorts).reduce((sum, pos) =>
      sum + (pos && pos.shares > 0 ? (pos.margin || 0) : 0), 0);
    const availableForShorts = Math.max(0, portfolioEquity - existingShortMargin);
    if (availableForShorts <= 0) return 0;

    const marginPerShare = price * SHORT_MARGIN_REQUIREMENT;
    const maxByEquity = marginPerShare > 0 ? Math.floor((availableForShorts / marginPerShare) * 100) / 100 : 0;
    // v2: must also have enough cash for the margin deposit
    const maxByCash = marginPerShare > 0 ? Math.floor((userCash / marginPerShare) * 100) / 100 : 0;
    return Math.max(0, Math.min(Math.min(maxByEquity, maxByCash), 10000));
  }
  if (action === 'cover') {
    if (getTradeCount(userData, ticker, 'cover') >= MAX_TRADES_PER_TICKER_24H) return 0;
    return shortPosition?.shares || 0;
  }
  return 1;
};

export const formatShares = (n) => {
  if (n === 0) return '0';
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
};
