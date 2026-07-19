'use strict';
// Per-action computation for executeTrade. Each compute* function applies one
// action's rules and price math, mutates the caller's newHoldings/newShorts
// working copies in place, and returns the resulting price/cash numbers.
// Rule violations throw HttpsError so the surrounding transaction aborts.
// Internal module — required by trading.js, not exported through index.js.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const {
  MIN_PRICE, MAX_PRICE_CHANGE_PERCENT, MAX_DAILY_IMPACT,
  SHORT_MARGIN_RATIO, SHORT_CONCENTRATION_CAP, MARGIN_SELL_LOCKUP_MS,
  MAX_SHORTS_BEFORE_COOLDOWN, SHORT_COOLDOWN_WINDOW_MS, TRADE_HOLD_PERIOD_MS,
} = require('../constants');
const { calculateMarginalImpact, lockedShares } = require('../helpers');

function computeBuy({
  ticker, amount, now, currentPrice, prices, effectiveSpread, ageImpactFactor,
  cumulativeVolume, cumulativeDailyImpact, ipCumulativeDailyImpact,
  cash, holdings, userData, marginEnabled, marginUsed, tierMultiplier, newHoldings,
}) {
  // Calculate marginal price impact (cumulative volume-based)
  const priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;
  const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  const hitMaxImpact = priceImpact >= maxImpact;

  // Check daily 10% impact cap
  const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
  const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
  if (effectiveDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
    throw new functions.https.HttpsError('failed-precondition',
      `Daily trading limit reached for ${ticker}. No more buys today.`);
  }

  const newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
  const executionPrice = newPrice * (1 + effectiveSpread / 2); // Ask price
  const totalCost = executionPrice * amount;

  // Validate cash (with margin if enabled)
  if (cash < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot open new positions while in debt.');
  }

  // Borrowing power scales with invested value, not just idle cash. Holdings
  // count at the LOWER of cost basis or current price, so a pumped stock can't
  // inflate the limit (paper gains don't count) — mirrors calculations.js.
  const costBasis = userData.costBasis || {};
  let collateralValue = 0;
  for (const [t, s] of Object.entries(holdings)) {
    if (s > 0) collateralValue += Math.min(costBasis[t] || 0, prices[t] || 0) * s;
  }
  const borrowBase = Math.max(0, cash + collateralValue - marginUsed);
  const maxBorrowable = Math.max(0, borrowBase * tierMultiplier);
  const availableMargin = Math.max(0, maxBorrowable - marginUsed);

  if (!marginEnabled && cash < totalCost) {
    throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
  }

  if (marginEnabled && cash + availableMargin < totalCost) {
    throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds (including margin).');
  }

  // Execute buy
  const cashNeeded = Math.max(0, totalCost - cash);
  const marginToUse = marginEnabled ? Math.min(cashNeeded, availableMargin) : 0;

  const newCash = Math.max(0, cash - totalCost + marginToUse);
  const newMarginUsed = marginUsed + marginToUse;
  newHoldings[ticker] = (holdings[ticker] || 0) + amount;

  // Lock the margin-funded shares from re-selling for a hold period, so
  // borrowed money can't spike a stock and bail before the price reverts.
  // Accumulates with any still-active lock; mirrors the IPO lockup.
  let marginLockUpdate = null;
  if (marginToUse > 0 && executionPrice > 0) {
    const marginShares = Math.round((marginToUse / executionPrice) * 100) / 100;
    const existing = userData.marginLockup?.[ticker];
    const stillActive = existing && now < (existing.until || 0);
    marginLockUpdate = {
      shares: Math.round(((stillActive ? existing.shares : 0) + marginShares) * 100) / 100,
      until: Math.max(existing?.until || 0, now + MARGIN_SELL_LOCKUP_MS),
    };
  }

  return { priceImpact, newPrice, executionPrice, totalCost, newCash, newMarginUsed, marginLockUpdate, hitMaxImpact };
}

function computeSell({
  ticker, amount, now, currentPrice, effectiveSpread, ageImpactFactor,
  cumulativeVolume, cumulativeDailyImpact, ipCumulativeDailyImpact,
  cash, holdings, userData, marginUsed, newHoldings,
}) {
  // Validate holdings
  const currentHoldings = holdings[ticker] || 0;
  if (currentHoldings < amount) {
    throw new functions.https.HttpsError('failed-precondition', 'Insufficient shares to sell.');
  }

  // Lockups: IPO shares and margin-funded shares can't be sold until their
  // hold clears, so the launch pop and borrowed-money pumps can't be flipped.
  const locks = lockedShares(userData, ticker, now);
  if (locks.total > 0 && amount > Math.max(0, currentHoldings - locks.total)) {
    const sellable = Math.max(0, currentHoldings - locks.total);
    const parts = [];
    if (locks.ipo > 0) parts.push(`${locks.ipo} IPO-locked`);
    if (locks.margin > 0) {
      const hrs = Math.max(1, Math.ceil((userData.marginLockup[ticker].until - now) / 3600000));
      parts.push(`${locks.margin} margin-locked (~${hrs}h left)`);
    }
    throw new functions.https.HttpsError('failed-precondition',
      `Some $${ticker} shares are locked (${parts.join(', ')}). You can sell ${sellable} now.`);
  }

  // Enforce 45-second hold period
  const lastBuyTime = userData.lastBuyTime?.[ticker];
  if (lastBuyTime) {
    const lastBuyMs = lastBuyTime.toMillis ? lastBuyTime.toMillis() : lastBuyTime;
    const timeSinceBuy = now - lastBuyMs;

    if (timeSinceBuy < TRADE_HOLD_PERIOD_MS) {
      const remainingMs = TRADE_HOLD_PERIOD_MS - timeSinceBuy;
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Hold period: ${Math.ceil(remainingMs / 1000)}s remaining`
      );
    }
  }

  // Calculate marginal price impact (cumulative sell volume-based)
  let priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;

  // Daily 10% impact cap: sells always execute (players must be able to
  // exit), but once the cap is hit the trade stops moving the price.
  const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
  const remainingDailyImpact = Math.max(0, MAX_DAILY_IMPACT - effectiveDailyImpact);
  priceImpact = Math.min(priceImpact, currentPrice * remainingDailyImpact);

  const newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
  const executionPrice = Math.max(MIN_PRICE, newPrice * (1 - effectiveSpread / 2)); // Bid price
  const totalCost = executionPrice * amount;

  // Execute sell
  const newCash = cash + totalCost;
  newHoldings[ticker] = Math.round((currentHoldings - amount) * 10000) / 10000;
  if (newHoldings[ticker] <= 0) {
    delete newHoldings[ticker];
  }

  return { priceImpact, newPrice, executionPrice, totalCost, newCash, newMarginUsed: marginUsed, marginLockUpdate: null, hitMaxImpact: false };
}

function computeShort({
  ticker, amount, now, currentPrice, prices, effectiveSpread, ageImpactFactor,
  cumulativeVolume, cumulativeDailyImpact, ipCumulativeDailyImpact,
  cash, holdings, shorts, userData, marginUsed, newShorts,
}) {
  // Validate margin requirement
  if (cash < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot open new positions while in debt.');
  }

  const marginRequired = currentPrice * amount * SHORT_MARGIN_RATIO; // 100% collateral

  // v2: Must have enough cash for the margin deposit
  if (cash < marginRequired) {
    throw new functions.https.HttpsError('failed-precondition', 'Insufficient cash for short margin deposit.');
  }

  // Calculate portfolio equity (net worth) to cap total short leverage
  let portfolioEquity = cash;
  Object.entries(holdings).forEach(([t, s]) => {
    if (s > 0) portfolioEquity += (prices[t] || 0) * s;
  });
  Object.entries(shorts).forEach(([t, pos]) => {
    if (pos && pos.shares > 0) {
      if ((pos.system || 'v2') === 'v2') {
        portfolioEquity += (pos.margin || 0) + ((pos.costBasis || 0) - (prices[t] || 0)) * pos.shares;
      } else {
        portfolioEquity += (pos.margin || 0) - ((prices[t] || 0) * pos.shares);
      }
    }
  });

  const existingShortMargin = Object.values(shorts).reduce((sum, pos) =>
    sum + (pos && pos.shares > 0 ? (pos.margin || 0) : 0), 0);

  if (portfolioEquity <= 0 || existingShortMargin + marginRequired > portfolioEquity) {
    throw new functions.https.HttpsError('failed-precondition', 'Short limit reached. Total short positions cannot exceed your portfolio value.');
  }

  // Per-ticker concentration cap: one stock's total short value (existing
  // position + this trade) can't exceed half of portfolio equity
  const existingTickerShortValue = (shorts[ticker]?.shares > 0)
    ? shorts[ticker].shares * currentPrice
    : 0;
  if (existingTickerShortValue + currentPrice * amount > portfolioEquity * SHORT_CONCENTRATION_CAP) {
    throw new functions.https.HttpsError('failed-precondition',
      `Concentration limit: your total short on $${ticker} cannot exceed ${SHORT_CONCENTRATION_CAP * 100}% of your portfolio value.`);
  }

  // Check short cooldown (8-hour cooldown after 3rd short per ticker)
  const shortHistory = userData.shortHistory?.[ticker] || [];
  const recentShorts = shortHistory.filter(ts => now - ts < SHORT_COOLDOWN_WINDOW_MS);

  if (recentShorts.length >= MAX_SHORTS_BEFORE_COOLDOWN) {
    const oldestRecent = Math.min(...recentShorts);
    const unlocksAt = oldestRecent + SHORT_COOLDOWN_WINDOW_MS;
    const remainingMs = unlocksAt - now;
    const hours = Math.floor(remainingMs / 3600000);
    const minutes = Math.ceil((remainingMs % 3600000) / 60000);
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Short limit reached. You can short ${ticker} again in ${hours}h ${minutes}m.`
    );
  }

  // Calculate marginal price impact (cumulative volume-based)
  const priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;

  // Check daily 10% impact cap
  const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
  const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
  if (effectiveDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
    throw new functions.https.HttpsError('failed-precondition',
      `Daily trading limit reached for ${ticker}. No more shorts today.`);
  }

  const newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
  const executionPrice = Math.max(MIN_PRICE, newPrice * (1 - effectiveSpread / 2)); // Bid price
  const totalCost = executionPrice * amount;

  // Execute short — v2: deduct margin only, no sale proceeds
  const newCash = cash - marginRequired;

  const existingShort = shorts[ticker];
  if (existingShort && existingShort.shares > 0) {
    const totalShares = existingShort.shares + amount;
    const totalValue = existingShort.costBasis * existingShort.shares + executionPrice * amount;
    const existingMargin = existingShort.margin || (existingShort.costBasis * existingShort.shares * 0.5);
    newShorts[ticker] = {
      shares: totalShares,
      costBasis: totalShares > 0 ? totalValue / totalShares : executionPrice,
      margin: existingMargin + marginRequired,
      openedAt: existingShort.openedAt || admin.firestore.Timestamp.now(),
      system: 'v2'
    };
  } else {
    newShorts[ticker] = {
      shares: amount,
      costBasis: executionPrice,
      margin: marginRequired,
      openedAt: admin.firestore.Timestamp.now(),
      system: 'v2'
    };
  }

  return { priceImpact, newPrice, executionPrice, totalCost, newCash, newMarginUsed: marginUsed, marginLockUpdate: null, hitMaxImpact: false };
}

function computeCover({
  ticker, amount, now, currentPrice, effectiveSpread, ageImpactFactor,
  cumulativeVolume, cumulativeDailyImpact, ipCumulativeDailyImpact,
  cash, shorts, marginUsed, newShorts,
}) {
  // Validate short position exists
  const shortPosition = shorts[ticker];
  if (!shortPosition || !shortPosition.shares || shortPosition.shares < amount) {
    throw new functions.https.HttpsError('failed-precondition', 'No short position to cover.');
  }

  // Enforce 45-second hold period
  const openedAt = shortPosition.openedAt;
  if (openedAt) {
    const openedMs = openedAt.toMillis ? openedAt.toMillis() : openedAt;
    const timeSinceOpen = now - openedMs;

    if (timeSinceOpen < TRADE_HOLD_PERIOD_MS) {
      const remainingMs = TRADE_HOLD_PERIOD_MS - timeSinceOpen;
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Hold period: ${Math.ceil(remainingMs / 1000)}s remaining`
      );
    }
  }

  // Calculate marginal price impact (cumulative cover volume-based)
  let priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;

  // Daily 10% impact cap: covers always execute (players must be able to
  // exit), but once the cap is hit the trade stops moving the price.
  const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
  const remainingDailyImpact = Math.max(0, MAX_DAILY_IMPACT - effectiveDailyImpact);
  priceImpact = Math.min(priceImpact, currentPrice * remainingDailyImpact);

  const newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
  const executionPrice = newPrice * (1 + effectiveSpread / 2); // Ask price
  const totalCost = executionPrice * amount;

  // Calculate margin to return (based on entry price, not current price)
  const costBasis = shortPosition.costBasis || shortPosition.entryPrice || executionPrice;
  const totalPositionMargin = shortPosition.margin || (costBasis * shortPosition.shares * 0.5);
  const marginToReturn = shortPosition.shares > 0 ? (totalPositionMargin / shortPosition.shares) * amount : 0;

  // Execute cover
  let newCash;
  if ((shortPosition.system || 'v2') === 'v2') {
    // v2: get margin back + profit/loss (no proceeds were given at open)
    const shortProfit = (costBasis - executionPrice) * amount;
    newCash = cash + marginToReturn + shortProfit;
  } else {
    // Legacy: pay cover cost, get margin back (proceeds already in cash)
    newCash = cash - totalCost + marginToReturn;
  }
  if (isNaN(newCash)) {
    throw new functions.https.HttpsError('internal', 'Trade calculation error: invalid cash result');
  }
  newShorts[ticker] = {
    shares: shortPosition.shares - amount,
    costBasis: costBasis,
    margin: totalPositionMargin - marginToReturn,
    openedAt: shortPosition.openedAt || admin.firestore.Timestamp.now(),
    system: shortPosition.system || 'v2'
  };
  if (newShorts[ticker].shares <= 0) {
    delete newShorts[ticker];
  }

  return { priceImpact, newPrice, executionPrice, totalCost, newCash, newMarginUsed: marginUsed, marginLockUpdate: null, hitMaxImpact: false };
}

module.exports = { computeBuy, computeSell, computeShort, computeCover };
