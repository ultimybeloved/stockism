'use strict';
// Pre-trade validation and anti-abuse gates for executeTrade. Every function
// here either passes silently or throws an HttpsError that aborts the trade.
// Internal module — required by trading.js, not exported through index.js.
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTER_MAP } = require('../characters');
const {
  isWeeklyTradingHalt, MAX_TRADES_PER_TICKER_24H,
  MAX_ACCOUNTS_PER_IP, IP_ACCOUNT_CAP_ENABLED, ADMIN_UID,
  TICKER_COOLDOWN_MS, TRADE_COOLDOWN_MS,
  MAX_TRADES_PER_TICKER_HOUR, TRADE_BURST_LIMIT, TRADE_BURST_WINDOW_MS,
} = require('../constants');

// Validate inputs - finite, bounded, max 2 decimal places — and reject trades
// during the weekly halt window.
function validateTradeInput(data) {
  const { ticker, action, amount } = data;

  if (!ticker || !action || !amount || !Number.isFinite(amount) || amount < 0.01 || amount > 10000 || Math.round(amount * 100) / 100 !== amount) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid trade parameters. Shares must be between 0.01 and 10,000 (max 2 decimal places).'
    );
  }

  if (!['buy', 'sell', 'short', 'cover'].includes(action)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid trade action. Must be: buy, sell, short, or cover.'
    );
  }

  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Market closed for chapter review. Trading resumes at 21:00 UTC.'
    );
  }

  return { ticker, action, amount };
}

// Anti-manipulation: Block shorting if user has a live SELL or STOP_LOSS limit
// order on the same ticker. PARTIALLY_FILLED orders are still live and count.
// (Type is filtered in code — a second 'in' clause isn't allowed in one query.)
async function assertNoLiveSellOrders(uid, ticker, action) {
  if (action !== 'short') return;

  const liveOrders = await db.collection('limitOrders')
    .where('userId', '==', uid)
    .where('ticker', '==', ticker)
    .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
    .get();
  const hasLiveSell = liveOrders.docs.some(d => ['SELL', 'STOP_LOSS'].includes(d.data().type));

  if (hasLiveSell) {
    throw new functions.https.HttpsError('failed-precondition',
      'Cannot short while you have a pending sell order on this stock.');
  }
}

// Market-level gates: unlaunched IPO tickers, emergency admin halt, and
// per-ticker circuit breakers.
function assertMarketTradable(marketData, ticker) {
  const launchedTickers = marketData.launchedTickers || [];
  const charMeta = CHARACTER_MAP[ticker];
  if (charMeta?.ipoRequired && !launchedTickers.includes(ticker)) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `${ticker} is in IPO phase. Use the IPO panel to purchase shares.`
    );
  }

  if (marketData.marketHalted) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      marketData.haltReason || 'Market is currently halted.'
    );
  }

  const haltedTickers = marketData.haltedTickers || {};
  if (haltedTickers[ticker]) {
    const halt = haltedTickers[ticker];
    if (halt.resumeAt && Date.now() < halt.resumeAt) {
      const resumeIn = Math.ceil((halt.resumeAt - Date.now()) / 60000);
      throw new functions.https.HttpsError(
        'failed-precondition',
        `$${ticker} trading is halted (circuit breaker). Resumes in ~${resumeIn} min. ${halt.reason || ''}`
      );
    }
  }
}

// Bankrupt users may sell/cover to exit positions, but can't open new ones.
function assertUserCanTrade(userData, action) {
  if (userData.isBankrupt || (userData.cash || 0) < 0) {
    if (action === 'buy' || action === 'short') {
      throw new functions.https.HttpsError('failed-precondition', 'Account is bankrupt. Use bailout to reset.');
    }
  }
}

// Hard per-IP cap: at most MAX_ACCOUNTS_PER_IP distinct accounts may buy/short from
// one IP per hour (admin exempt; sell/cover always allowed so users can exit).
function assertIpAccountCap({ ip, uid, action, ipRecentTraders, now }) {
  if (
    IP_ACCOUNT_CAP_ENABLED && ip !== 'unknown' && uid !== ADMIN_UID &&
    (action === 'buy' || action === 'short')
  ) {
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const recentTraderUids = new Set(
      Object.entries(ipRecentTraders)
        .filter(([, ts]) => now - (typeof ts === 'number' ? ts : 0) < ONE_HOUR_MS)
        .map(([u]) => u)
    );
    recentTraderUids.add(uid);
    if (recentTraderUids.size > MAX_ACCOUNTS_PER_IP) {
      throw new functions.https.HttpsError(
        'permission-denied',
        'Too many accounts trading from this network. Trading is limited per network.'
      );
    }
  }
}

// Global 3-second cooldown between trades, plus the 10-second same-ticker
// cooldown on position-opening actions.
function assertCooldowns(userData, ticker, action, now) {
  const lastTradeTime = userData.lastTradeTime;
  if (lastTradeTime) {
    const lastTradeMs = lastTradeTime.toMillis ? lastTradeTime.toMillis() : lastTradeTime;
    const timeSinceLastTrade = now - lastTradeMs;

    if (timeSinceLastTrade < TRADE_COOLDOWN_MS) {
      const remainingMs = TRADE_COOLDOWN_MS - timeSinceLastTrade;
      throw new functions.https.HttpsError(
        'failed-precondition',
        `Trade cooldown: ${Math.ceil(remainingMs / 1000)}s remaining`
      );
    }
  }

  if (action === 'buy' || action === 'short') {
    const lastTickerTradeTime = userData.lastTickerTradeTime?.[ticker];
    if (lastTickerTradeTime) {
      const lastTickerMs = lastTickerTradeTime.toMillis ? lastTickerTradeTime.toMillis() : lastTickerTradeTime;
      const timeSinceTickerTrade = now - lastTickerMs;
      if (timeSinceTickerTrade < TICKER_COOLDOWN_MS) {
        const remainingMs = TICKER_COOLDOWN_MS - timeSinceTickerTrade;
        throw new functions.https.HttpsError('failed-precondition',
          `Same-stock cooldown: ${Math.ceil(remainingMs / 1000)}s remaining`);
      }
    }
  }
}

// Trade velocity: hourly cap and 5-minute burst limit per ticker. Only
// rate-limits position-opening actions (buy/short) — closing positions
// (sell/cover) should never be blocked. Plain (non-transactional) queries.
async function assertVelocityLimits(uid, ticker, action, now) {
  if (action !== 'buy' && action !== 'short') return;

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const oneHourAgo = new Date(now - ONE_HOUR_MS);
  const recentTickerTradesSnap = await db.collection('trades')
    .where('uid', '==', uid)
    .where('ticker', '==', ticker)
    .where('timestamp', '>', oneHourAgo)
    .get();

  const tradesInLastHour = recentTickerTradesSnap.size;

  if (tradesInLastHour >= MAX_TRADES_PER_TICKER_HOUR) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Trade velocity limit: You've traded ${ticker} ${tradesInLastHour} times in the last hour.`
    );
  }

  const fiveMinAgo = new Date(now - TRADE_BURST_WINDOW_MS);
  const burstTradesSnap = await db.collection('trades')
    .where('uid', '==', uid)
    .where('ticker', '==', ticker)
    .where('timestamp', '>', fiveMinAgo)
    .get();
  const burstCount = burstTradesSnap.docs.filter(d => d.data().action === action).length;

  if (burstCount >= TRADE_BURST_LIMIT) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Slow down: Max ${TRADE_BURST_LIMIT} ${action === 'buy' ? 'buys' : 'shorts'} per ticker every 5 minutes.`
    );
  }
}

// Rolling 24h cap on trades per ticker per action.
function assertTradeCapNotHit(tradeCount, action, ticker) {
  if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
    throw new functions.https.HttpsError('failed-precondition',
      `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} ${action}s on ${ticker}. This resets on a rolling 24h basis.`);
  }
}

module.exports = {
  validateTradeInput,
  assertNoLiveSellOrders,
  assertMarketTradable,
  assertUserCanTrade,
  assertIpAccountCap,
  assertCooldowns,
  assertVelocityLimits,
  assertTradeCapNotHit,
};
