// ============================================
// TRADING SERVICE
// Buy/Sell/Short logic and calculations
// ============================================

import {
  doc,
  getDoc,
  updateDoc,
  increment,
  arrayUnion
} from 'firebase/firestore';
import { db } from '../firebase';
import {
  BASE_IMPACT,
  MIN_PRICE,
  MAX_PRICE_CHANGE_PERCENT,
  BID_ASK_SPREAD,
  SHORT_MARGIN_REQUIREMENT
} from '../constants/economy';
import { calculateMarginStatus } from '../utils/calculations';
import { CHARACTER_MAP } from '../characters';

/**
 * Calculate price impact based on trade size and character volatility
 * Uses sqrt to make large trades proportionally less impactful
 */
export const calculatePriceImpact = (amount, currentPrice, volatility = 1) => {
  // Softer liquidity scaling - less punishment for high-priced stocks
  const liquidityFactor = Math.max(1, Math.sqrt(currentPrice / 50));

  // Don't use volatility as direct multiplier - it's for natural drift, not trade impact
  // Instead, use it as a small modifier (1 + volatility boost)
  const volatilityBoost = 1 + (volatility * 2); // 0.03 vol = 1.06x, 0.06 vol = 1.12x

  const rawImpact = (Math.sqrt(amount) * BASE_IMPACT * volatilityBoost) / liquidityFactor;
  return Math.min(rawImpact, MAX_PRICE_CHANGE_PERCENT);
};

/**
 * Calculate bid and ask prices with spread
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
 */
export const calculateNewPrice = (currentPrice, amount, isBuy, volatility = 1) => {
  const impact = calculatePriceImpact(amount, currentPrice, volatility);
  const direction = isBuy ? 1 : -1;
  const newPrice = currentPrice * (1 + (impact * direction));
  return Math.max(MIN_PRICE, Math.round(newPrice * 100) / 100);
};

/**
 * Apply trailing stock factor effects
 * When a stock moves, related stocks move proportionally
 * @param {string} ticker - The ticker that just moved
 * @param {number} oldPrice - Price before the trade
 * @param {number} newPrice - Price after the trade
 * @param {Object} prices - Current market prices
 * @returns {Object} Update object for related tickers
 */
export const applyTrailingEffects = (ticker, oldPrice, newPrice, prices) => {
  const updates = {};
  const now = Date.now();

  // Look up the character
  const character = CHARACTER_MAP[ticker];
  if (!character || !character.trailingFactors) {
    return updates;
  }

  // Calculate the price change percentage
  const priceChangePercent = ((newPrice - oldPrice) / oldPrice);

  // Apply trailing effects to related stocks
  character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
    const relatedPrice = prices[relatedTicker];
    if (!relatedPrice) return;

    // Calculate trailing price change (proportional to main stock's change)
    const trailingChange = priceChangePercent * coefficient;
    const newRelatedPrice = relatedPrice * (1 + trailingChange);
    const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

    // Add to update object
    updates[`prices.${relatedTicker}`] = settledRelatedPrice;
    updates[`priceHistory.${relatedTicker}`] = arrayUnion({
      timestamp: now,
      price: settledRelatedPrice
    });
  });

  return updates;
};

/**
 * Execute a buy trade
 * @param {Object} params - Trade parameters
 * @returns {Object} Trade result with success, message, and details
 */
export const executeBuy = async ({
  userId,
  userData,
  ticker,
  amount,
  currentPrice,
  prices,
  volatility = 1
}) => {
  let now = Date.now();
  const userRef = doc(db, 'users', userId);
  const marketRef = doc(db, 'market', 'current');

  // Fetch current market data to check last timestamp
  const marketSnap = await getDoc(marketRef);
  if (marketSnap.exists()) {
    const marketData = marketSnap.data();
    const currentHistory = marketData.priceHistory?.[ticker] || [];
    if (currentHistory.length > 0) {
      const lastTimestamp = currentHistory[currentHistory.length - 1].timestamp;
      if (now <= lastTimestamp) {
        now = lastTimestamp + 1;
      }
    }
  }

  // Calculate new price after impact
  const impact = calculatePriceImpact(amount, currentPrice, volatility);
  const newMidPrice = currentPrice * (1 + impact);

  // You pay the ASK price (higher due to spread)
  const { ask } = getBidAskPrices(newMidPrice);
  const buyPrice = ask;
  const totalCost = buyPrice * amount;

  // Check funds (cash + available margin)
  const cashAvailable = userData.cash || 0;
  const marginEnabled = userData.marginEnabled || false;
  const marginUsed = userData.marginUsed || 0;
  const marginStatus = calculateMarginStatus(userData, prices);
  const availableMargin = marginStatus.availableMargin || 0;

  let cashToUse = 0;
  let marginToUse = 0;

  if (cashAvailable >= totalCost) {
    cashToUse = totalCost;
    marginToUse = 0;
  } else if (marginEnabled && cashAvailable + availableMargin >= totalCost) {
    cashToUse = cashAvailable;
    marginToUse = totalCost - cashAvailable;
  } else {
    return {
      success: false,
      error: 'INSUFFICIENT_FUNDS',
      message: marginEnabled
        ? `Insufficient funds! Need $${totalCost.toFixed(2)}, have $${cashAvailable.toFixed(2)} cash + $${availableMargin.toFixed(2)} margin`
        : 'Insufficient funds!'
    };
  }

  // Market settles at new mid price
  const settledPrice = Math.round(newMidPrice * 100) / 100;

  // Calculate new cost basis (weighted average)
  const currentHoldings = userData.holdings?.[ticker] || 0;
  const currentCostBasis = userData.costBasis?.[ticker] || 0;
  const newHoldings = currentHoldings + amount;
  const newCostBasis = currentHoldings > 0
    ? ((currentCostBasis * currentHoldings) + (buyPrice * amount)) / newHoldings
    : buyPrice;

  // Track lowest price while holding for Diamond Hands achievement
  const currentLowest = userData.lowestWhileHolding?.[ticker];
  const newLowest = currentHoldings === 0
    ? buyPrice
    : Math.min(currentLowest || buyPrice, buyPrice);

  // Update market with atomic price + history
  const marketUpdates = {
    [`prices.${ticker}`]: settledPrice,
    [`volume.${ticker}`]: increment(amount),
    [`priceHistory.${ticker}`]: arrayUnion({ timestamp: now, price: settledPrice })
  };

  // Apply trailing stock factor effects
  const trailingUpdates = applyTrailingEffects(ticker, currentPrice, settledPrice, prices);
  Object.assign(marketUpdates, trailingUpdates);

  await updateDoc(marketRef, marketUpdates);

  // Update user
  const userUpdates = {
    cash: cashAvailable - cashToUse,
    marginUsed: marginUsed + marginToUse,
    [`holdings.${ticker}`]: newHoldings,
    [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
    [`lowestWhileHolding.${ticker}`]: Math.round(newLowest * 100) / 100,
    [`lastBuyTime.${ticker}`]: now,
    [`lastTickerTradeTime.${ticker}`]: now,
    lastTradeTime: now,
    totalTrades: increment(1)
  };

  await updateDoc(userRef, userUpdates);

  // Get trailing effects summary
  const trailingTickers = Object.keys(trailingUpdates)
    .filter(key => key.startsWith('prices.'))
    .map(key => key.replace('prices.', ''));

  return {
    success: true,
    buyPrice,
    settledPrice,
    totalCost,
    newHoldings,
    newCostBasis: Math.round(newCostBasis * 100) / 100,
    impact: impact * 100,
    cashUsed: cashToUse,
    marginUsed: marginToUse,
    trailingEffects: trailingTickers.length > 0 ? trailingTickers : null
  };
};

/**
 * Execute a sell trade
 * @param {Object} params - Trade parameters
 * @returns {Object} Trade result with success, message, and details
 */
export const executeSell = async ({
  userId,
  userData,
  ticker,
  amount,
  currentPrice,
  volatility = 1
}) => {
  let now = Date.now();
  const userRef = doc(db, 'users', userId);
  const marketRef = doc(db, 'market', 'current');

  // Fetch current market data to check last timestamp
  const marketSnap = await getDoc(marketRef);
  let prices = {};
  if (marketSnap.exists()) {
    const marketData = marketSnap.data();
    prices = marketData.prices || {};
    const currentHistory = marketData.priceHistory?.[ticker] || [];
    if (currentHistory.length > 0) {
      const lastTimestamp = currentHistory[currentHistory.length - 1].timestamp;
      if (now <= lastTimestamp) {
        now = lastTimestamp + 1;
      }
    }
  }

  // Check if user has enough shares
  const currentHoldings = userData.holdings?.[ticker] || 0;
  if (currentHoldings < amount) {
    return {
      success: false,
      error: 'INSUFFICIENT_SHARES',
      message: `You only have ${currentHoldings} shares of ${ticker}`
    };
  }

  // Calculate new price after impact
  const impact = calculatePriceImpact(amount, currentPrice, volatility);
  const newMidPrice = currentPrice * (1 - impact);

  // You get the BID price (lower due to spread)
  const { bid } = getBidAskPrices(newMidPrice);
  const sellPrice = Math.max(MIN_PRICE, bid);
  const totalRevenue = sellPrice * amount;

  // Market settles at new mid price
  const settledPrice = Math.round(newMidPrice * 100) / 100;

  // Calculate profit for achievements
  const costBasis = userData.costBasis?.[ticker] || 0;
  const profitPercent = costBasis > 0 ? ((sellPrice - costBasis) / costBasis) * 100 : 0;

  // Check for Diamond Hands - sold at profit after 30%+ dip
  const lowestWhileHolding = userData.lowestWhileHolding?.[ticker] || costBasis;
  const dipPercent = costBasis > 0 ? ((costBasis - lowestWhileHolding) / costBasis) * 100 : 0;
  const isDiamondHands = dipPercent >= 30 && profitPercent > 0;

  // Update holdings
  const newHoldings = currentHoldings - amount;

  // Update market with atomic price + history
  const marketUpdates = {
    [`prices.${ticker}`]: settledPrice,
    [`volume.${ticker}`]: increment(amount),
    [`priceHistory.${ticker}`]: arrayUnion({ timestamp: now, price: settledPrice })
  };

  // Apply trailing stock factor effects
  const trailingUpdates = applyTrailingEffects(ticker, currentPrice, settledPrice, prices);
  Object.assign(marketUpdates, trailingUpdates);

  await updateDoc(marketRef, marketUpdates);

  // Update user
  const userUpdates = {
    cash: (userData.cash || 0) + totalRevenue,
    [`holdings.${ticker}`]: newHoldings > 0 ? newHoldings : 0,
    [`lastTickerTradeTime.${ticker}`]: now,
    lastTradeTime: now,
    totalTrades: increment(1)
  };

  // Clean up cost basis if selling all shares
  if (newHoldings <= 0) {
    userUpdates[`costBasis.${ticker}`] = 0;
    userUpdates[`lowestWhileHolding.${ticker}`] = null;
  }

  await updateDoc(userRef, userUpdates);

  return {
    success: true,
    sellPrice,
    settledPrice,
    totalRevenue,
    newHoldings,
    profit: totalRevenue - (costBasis * amount),
    profitPercent,
    impact: impact * 100,
    isDiamondHands
  };
};

/**
 * Calculate short position margin requirements
 */
export const calculateShortMargin = (amount, price) => {
  return amount * price * SHORT_MARGIN_REQUIREMENT;
};

/**
 * Check if user can open a short position
 */
export const canOpenShort = (userData, amount, price) => {
  const cash = userData.cash || 0;
  const marginRequired = calculateShortMargin(amount, price);
  return cash >= marginRequired;
};
