'use strict';
// Screening for the limit-order sweep. INTERNAL MODULE — not exported through
// functions/index.js, same pattern as tradeGuards.
//
// Two rounds of checks, and the split between them is deliberate:
//   - the screen* functions run BEFORE the transaction, on the cheap snapshot
//     read, and decide whether an order is even worth attempting
//   - the assert*/resolve* functions run INSIDE the transaction on fresh data
//     and throw, because anything they catch changed between the two reads
//
// A thrown message is matched against CANCEL_ON in limitOrderMatching to decide
// cancel-vs-defer, so the wording of these throws is load-bearing.

const { CHARACTER_MAP } = require('../characters');
const { lockedShares, pruneAndSumTradeHistory, floorExitShares } = require('../helpers');
const {
  MAX_TRADES_PER_TICKER_24H, MIN_TRADE_SHARES, MIN_EXIT_SHARES, TRADE_SHARE_DECIMALS,
} = require('../constants');

const ENTRY_SHARE_STEP = 10 ** TRADE_SHARE_DECIMALS;

// ============================================
// BEFORE THE TRANSACTION
// ============================================

/**
 * Order-level screening that needs no user or price data.
 * Returns { status, reason, log } to write, or null to keep going.
 */
const screenOrder = (order, { now, launchedTickers }) => {
  if (order.type === 'SHORT' || order.type === 'COVER') {
    return { status: 'CANCELED', reason: 'SHORT/COVER limit orders not supported' };
  }
  // Orders on unlaunched IPO tickers would bypass the IPO's per-user and
  // supply limits entirely.
  if (CHARACTER_MAP[order.ticker]?.ipoRequired && !launchedTickers.includes(order.ticker)) {
    return { status: 'CANCELED', reason: 'Stock is still in IPO phase' };
  }
  if (order.expiresAt && now > order.expiresAt) {
    return { status: 'EXPIRED' };
  }
  return null;
};

/**
 * User-level screening. These states can all be entered AFTER an order was
 * placed, and until 2026 an order already on the book kept filling through
 * them — a ban left the queued lane open.
 * Returns { status, reason, log } to write, or null to keep going.
 */
const screenUser = (userData) => {
  if (userData.isBanned) {
    return { status: 'CANCELED', reason: 'Account is banned', log: 'account banned' };
  }
  if (userData.isBankrupt || (userData.cash || 0) < 0) {
    return { status: 'CANCELED', reason: 'User bankrupt or in debt', log: 'user bankrupt/in debt' };
  }
  if (userData.requiresDiscordLink && !userData.discordId) {
    return { status: 'CANCELED', reason: 'Discord verification required', log: 'Discord verification required' };
  }
  return null;
};

/** Circuit breaker: a ticker halt suspends fills until resumeAt. */
const isTickerHalted = (haltedTickersMap, ticker) => {
  const halt = haltedTickersMap[ticker];
  return !!(halt && halt.resumeAt && Date.now() < halt.resumeAt);
};

/**
 * Has the trigger price been crossed? This checks the MID price; execution
 * later re-checks the ask/bid the user actually gets, which is a stricter test.
 */
const triggerMet = (order, price) => {
  if (order.type === 'BUY') return price <= order.limitPrice;
  if (order.type === 'SELL') return price >= order.limitPrice;
  if (order.type === 'STOP_LOSS') return price <= order.limitPrice;
  return false;
};

// ============================================
// INSIDE THE TRANSACTION
// ============================================

/**
 * Re-read of the order itself. The client cancels by writing the doc directly,
 * so a blind FILLED write here would overwrite that cancel (or double-fill on
 * overlapping runs) and execute a trade the user no longer wants.
 * Returns the shares still to fill.
 */
const assertOrderStillActive = (freshOrderSnap, totalShares) => {
  if (!freshOrderSnap.exists) throw new Error('Order no longer exists');
  const freshOrder = freshOrderSnap.data();
  if (!['PENDING', 'PARTIALLY_FILLED'].includes(freshOrder.status)) {
    throw new Error('Order no longer active');
  }
  const freshFilled = freshOrder.filledShares || 0;
  const fillShares = totalShares - freshFilled;
  if (fillShares <= 0) throw new Error('Order no longer active');
  return { freshFilled, fillShares };
};

/** The same user states screenUser covers, re-checked against fresh data. */
const assertUserEligible = (userData) => {
  if (userData.isBanned) throw new Error('Account is banned');
  if (userData.isBankrupt || (userData.cash || 0) < 0) throw new Error('User is bankrupt or in debt');
  if (userData.requiresDiscordLink && !userData.discordId) throw new Error('Discord verification required');
};

/** The trigger, re-checked against the fresh price. */
const assertLimitStillMet = (order, freshPrice) => {
  if (!triggerMet(order, freshPrice)) {
    throw new Error('Price no longer meets limit condition');
  }
};

/** 10 fills per action per ticker per 24h, same ceiling executeTrade enforces. */
const assertTradeLimit = (tradeCount, action, ticker) => {
  if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
    throw new Error(`Trade limit reached: ${MAX_TRADES_PER_TICKER_24H} ${action}s on ${ticker} in 24h`);
  }
};

/**
 * How many shares can actually be filled, given cash (BUY) or unlocked shares
 * (SELL). Clamps to a partial fill when the order allows one, throws otherwise.
 *
 * Locks are re-checked here rather than only at creation: shares locked AFTER
 * the order was placed (e.g. a margin buy on the same ticker) must not be
 * sellable through a fill or a partial clamp.
 */
const resolveFillShares = ({ effectiveType, order, userData, freshPrice, fillShares }) => {
  if (effectiveType === 'BUY') {
    const totalCost = freshPrice * fillShares;
    if (userData.cash >= totalCost) return fillShares;
    if (!order.allowPartialFills) throw new Error('Insufficient cash');
    // Whole-cent share counts, same grid every other buy path uses. This used
    // to floor to WHOLE shares, so $15 of cash against a $10 stock filled 1
    // share and left $5 of buying power on the table.
    const affordableShares = freshPrice > 0
      ? Math.floor((userData.cash / freshPrice) * ENTRY_SHARE_STEP) / ENTRY_SHARE_STEP
      : 0;
    if (affordableShares < MIN_TRADE_SHARES) throw new Error('Insufficient cash');
    console.log(`Partial fill: can only afford ${affordableShares} shares`);
    return affordableShares;
  }

  if (effectiveType === 'SELL') {
    const userShares = userData.holdings?.[order.ticker] || 0;
    const lockedNow = lockedShares(userData, order.ticker).total;
    // Six decimals, not four: a dust position has to stay sellable in full.
    const sellableShares = Math.max(0, floorExitShares(userShares - lockedNow));
    if (sellableShares >= fillShares) return fillShares;
    if (order.allowPartialFills && sellableShares >= MIN_EXIT_SHARES) {
      console.log(`Partial fill: only ${sellableShares} sellable shares (${lockedNow} locked)`);
      return sellableShares;
    }
    if (userShares >= fillShares) {
      // Enough shares, but some are locked — defer, don't cancel; locks expire
      // well within the order's 30-day lifetime.
      throw new Error('Shares locked (IPO or margin hold)');
    }
    throw new Error('Insufficient shares');
  }

  return fillShares;
};

/** 24h cumulative volume and fill count for one action on one ticker. */
const readActionHistory = (tickerTradeHistory, ticker, action, now) =>
  pruneAndSumTradeHistory(tickerTradeHistory[ticker]?.[action] || [], now);

module.exports = {
  screenOrder,
  screenUser,
  isTickerHalted,
  triggerMet,
  assertOrderStillActive,
  assertUserEligible,
  assertLimitStillMet,
  assertTradeLimit,
  resolveFillShares,
  readActionHistory,
};
