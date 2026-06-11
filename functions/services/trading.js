'use strict';
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const {
  BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, CREW_MEMBERS,
  isWeeklyTradingHalt, MAX_PRICE_CHANGE_PERCENT,
  MAX_DAILY_IMPACT, MAX_TRADES_PER_TICKER_24H,
  ALL_CREW_TICKERS, ANIMAL_TICKERS, SHORT_CONCENTRATION_CAP,
  SHORT_MARGIN_RATIO, ADMIN_UID, MAX_ACCOUNTS_PER_IP, IP_ACCOUNT_CAP_ENABLED,
} = require('../constants');
const {
  checkBanned,
  checkDiscordWall,
  calculateMarginalImpact,
  getAccountAgeImpactFactor,
  pruneAndSumTradeHistory,
  addPendingShares,
  decrementCohort,
  writeNotification,
  writeFeedEntry,
} = require('../helpers');
const { updateCrewMissionProgress } = require('./crewMissions');
const { trackWatchedIpTrade } = require('./watchlist');

/**
 * SECURITY FIX: Server-side trade execution with anti-manipulation enforcement
 * Executes trades atomically in a Firestore transaction
 * Prevents price manipulation by enforcing 10% daily impact limit
 */
exports.executeTrade = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in to trade.'
    );
  }

  const uid = context.auth.uid;
  const { ticker, action, amount } = data;

  // Validate inputs - finite, bounded, max 2 decimal places
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

  // Block trades during weekly halt
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Market closed for chapter review. Trading resumes at 21:00 UTC.'
    );
  }

  // Anti-manipulation: Block shorting if user has a pending SELL or STOP_LOSS limit order on same ticker
  if (action === 'short') {
    const pendingSells = await db.collection('limitOrders')
      .where('userId', '==', uid)
      .where('ticker', '==', ticker)
      .where('status', '==', 'PENDING')
      .where('type', 'in', ['SELL', 'STOP_LOSS'])
      .limit(1)
      .get();

    if (!pendingSells.empty) {
      throw new functions.https.HttpsError('failed-precondition',
        'Cannot short while you have a pending sell order on this stock.');
    }
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const marketRef = db.collection('market').doc('current');
    const now = admin.firestore.Timestamp.now().toMillis();
    const todayDate = new Date().toISOString().split('T')[0];

    // Execute trade in atomic transaction (maxAttempts:1 prevents phantom retries
    // where the first attempt commits but a retry sees post-trade state and fails)
    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const marketDoc = await transaction.get(marketRef);

      if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }
      if (!marketDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'Market data not found.');
      }

      const userData = userDoc.data();
      checkBanned(userData);
      checkDiscordWall(userData);

      const marketData = marketDoc.data();

      // Block normal trades on IPO-only tickers that haven't launched yet
      const launchedTickers = marketData.launchedTickers || [];
      const charMeta = CHARACTER_MAP[ticker];
      if (charMeta?.ipoRequired && !launchedTickers.includes(ticker)) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `${ticker} is in IPO phase. Use the IPO panel to purchase shares.`
        );
      }

      // Check emergency admin halt
      if (marketData.marketHalted) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          marketData.haltReason || 'Market is currently halted.'
        );
      }

      // Check circuit breaker halt on this ticker
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

      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};
      let currentPrice = prices[ticker];

      const character = CHARACTERS.find(c => c.ticker === ticker);
      if (!character) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
      }

      // Auto-initialize price from basePrice if missing in Firestore
      if (!currentPrice) {
        currentPrice = character.basePrice;
      }

      // Block bankrupt users from trading
      if (userData.isBankrupt || (userData.cash || 0) < 0) {
        // Allow selling and covering to exit positions, block new buys/shorts
        if (action === 'buy' || action === 'short') {
          throw new functions.https.HttpsError('failed-precondition', 'Account is bankrupt. Use bailout to reset.');
        }
      }

      // Get user data
      const cash = userData.cash || 0;
      const holdings = userData.holdings || {};
      const shorts = userData.shorts || {};
      const marginEnabled = userData.marginEnabled || false;
      const marginUsed = userData.marginUsed || 0;
      // Calculate tier multiplier from peak portfolio (same tiers as frontend)
      const peakPortfolio = userData.peakPortfolioValue || 0;
      const tierMultiplier = peakPortfolio >= 30000 ? 0.75
        : peakPortfolio >= 15000 ? 0.50
        : peakPortfolio >= 7500 ? 0.35
        : 0.25;
      // Read tickerTradeHistory and compute cumulative stats for this action
      const tickerTradeHistory = userData.tickerTradeHistory || {};
      const actionHistory = tickerTradeHistory[ticker]?.[action] || [];
      const { recent: recentActionTrades, totalShares: cumulativeVolume, totalImpact: cumulativeActionImpact, count: tradeCount } = pruneAndSumTradeHistory(actionHistory, now);

      // Compute total daily impact across ALL actions for this ticker (for 10% cap)
      let cumulativeDailyImpact = 0;
      const allActionsForTicker = tickerTradeHistory[ticker] || {};
      for (const act of ['buy', 'sell', 'short', 'cover']) {
        const { totalImpact } = pruneAndSumTradeHistory(allActionsForTicker[act] || [], now);
        cumulativeDailyImpact += totalImpact;
      }

      // ANTI-MANIPULATION: Read IP-level trade history (shared across all accounts on same IP)
      const ip = context.rawRequest?.ip || 'unknown';
      let ipCumulativeDailyImpact = 0;
      let ipTrackingRef = null;
      let sanitizedIp = null;
      let ipTickerTradeHistory = {};
      let ipRecentTraders = {};

      if (ip !== 'unknown') {
        sanitizedIp = ip.replace(/[.:/]/g, '_');
        ipTrackingRef = db.collection('ipTracking').doc(sanitizedIp);
        const ipDoc = await transaction.get(ipTrackingRef);
        if (ipDoc.exists) {
          const ipData = ipDoc.data();
          ipTickerTradeHistory = ipData.tickerTradeHistory || {};
          ipRecentTraders = ipData.recentTraders || {};
          const ipAllActions = ipTickerTradeHistory[ticker] || {};
          for (const act of ['buy', 'sell', 'short', 'cover']) {
            const { totalImpact } = pruneAndSumTradeHistory(ipAllActions[act] || [], now);
            ipCumulativeDailyImpact += totalImpact;
          }
        }
      }

      // Hard per-IP cap: at most MAX_ACCOUNTS_PER_IP distinct accounts may buy/short from
      // one IP per hour (admin exempt; sell/cover always allowed so users can exit).
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

      // Enforce 3-second cooldown
      const lastTradeTime = userData.lastTradeTime;
      if (lastTradeTime) {
        const lastTradeMs = lastTradeTime.toMillis ? lastTradeTime.toMillis() : lastTradeTime;
        const timeSinceLastTrade = now - lastTradeMs;
        const COOLDOWN_MS = 3000;

        if (timeSinceLastTrade < COOLDOWN_MS) {
          const remainingMs = COOLDOWN_MS - timeSinceLastTrade;
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Trade cooldown: ${Math.ceil(remainingMs / 1000)}s remaining`
          );
        }
      }

      // ANTI-MANIPULATION: 10-second same-ticker cooldown (buy/short only)
      if (action === 'buy' || action === 'short') {
        const TICKER_COOLDOWN_MS = 10000;
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

      // Check trade velocity (15 trades per ticker per hour)
      // Only rate-limit position-opening actions (buy/short)
      // Closing positions (sell/cover) should never be blocked
      if (action === 'buy' || action === 'short') {
        const ONE_HOUR_MS = 60 * 60 * 1000;
        const oneHourAgo = new Date(now - ONE_HOUR_MS);
        const recentTickerTradesSnap = await db.collection('trades')
          .where('uid', '==', uid)
          .where('ticker', '==', ticker)
          .where('timestamp', '>', oneHourAgo)
          .get();

        const tradesInLastHour = recentTickerTradesSnap.size;
        const MAX_TRADES_PER_HOUR = 15;

        if (tradesInLastHour >= MAX_TRADES_PER_HOUR) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Trade velocity limit: You've traded ${ticker} ${tradesInLastHour} times in the last hour.`
          );
        }

        // ANTI-MANIPULATION: 5-minute burst limit (max 3 per ticker per 5 min)
        const FIVE_MIN_MS = 5 * 60 * 1000;
        const fiveMinAgo = new Date(now - FIVE_MIN_MS);
        const burstTradesSnap = await db.collection('trades')
          .where('uid', '==', uid)
          .where('ticker', '==', ticker)
          .where('timestamp', '>', fiveMinAgo)
          .get();
        const burstCount = burstTradesSnap.docs.filter(d => d.data().action === action).length;

        if (burstCount >= 3) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Slow down: Max 3 ${action === 'buy' ? 'buys' : 'shorts'} per ticker every 5 minutes.`
          );
        }
      }

      // Calculate price impact
      const MIN_PRICE = 0.01;
      let priceImpact = 0;
      let newPrice = currentPrice;
      let executionPrice = currentPrice;
      let totalCost = 0;
      let hitMaxImpact = false;
      let newCash = cash;
      let newHoldings = {};
      for (const [t, s] of Object.entries(holdings)) {
        if (s > 0.001) newHoldings[t] = s;
      }
      // Sanitize shorts to prevent undefined fields from crashing Firestore writes
      let newShorts = {};
      for (const [t, pos] of Object.entries(shorts)) {
        if (pos && pos.shares > 0) {
          newShorts[t] = {
            shares: pos.shares,
            costBasis: pos.costBasis || pos.entryPrice || 0,
            margin: pos.margin || 0,
            openedAt: pos.openedAt || admin.firestore.Timestamp.now(),
            system: pos.system || 'v2'
          };
        }
      }
      let newMarginUsed = marginUsed;
      const effectiveSpread = character.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;
      // New accounts move the market less (anti-manipulation). Enforced here so
      // it actually applies — the frontend preview mirrors this factor.
      const ageImpactFactor = getAccountAgeImpactFactor(userData);

      // BUY LOGIC
      if (action === 'buy') {
        // Enforce 10-trade cap
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} buys on ${ticker}. This resets on a rolling 24h basis.`);
        }

        // Calculate marginal price impact (cumulative volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;
        const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
        hitMaxImpact = priceImpact >= maxImpact;

        // Check daily 10% impact cap
        const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
        if (effectiveDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
          throw new functions.https.HttpsError('failed-precondition',
            `Daily trading limit reached for ${ticker}. No more buys today.`);
        }

        newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
        executionPrice = newPrice * (1 + effectiveSpread / 2); // Ask price
        totalCost = executionPrice * amount;

        // Validate cash (with margin if enabled)
        if (cash < 0) {
          throw new functions.https.HttpsError('failed-precondition', 'Cannot open new positions while in debt.');
        }

        const maxBorrowable = Math.max(0, cash * tierMultiplier);
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

        newCash = Math.max(0, cash - totalCost + marginToUse);
        newMarginUsed = marginUsed + marginToUse;
        newHoldings[ticker] = (holdings[ticker] || 0) + amount;

      // SELL LOGIC
      } else if (action === 'sell') {
        // Enforce 10-trade cap for sells
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} sells on ${ticker}. This resets on a rolling 24h basis.`);
        }

        // Validate holdings
        const currentHoldings = holdings[ticker] || 0;
        if (currentHoldings < amount) {
          throw new functions.https.HttpsError('failed-precondition', 'Insufficient shares to sell.');
        }

        // Enforce 45-second hold period
        const lastBuyTime = userData.lastBuyTime?.[ticker];
        if (lastBuyTime) {
          const lastBuyMs = lastBuyTime.toMillis ? lastBuyTime.toMillis() : lastBuyTime;
          const timeSinceBuy = now - lastBuyMs;
          const HOLD_PERIOD_MS = 45 * 1000;

          if (timeSinceBuy < HOLD_PERIOD_MS) {
            const remainingMs = HOLD_PERIOD_MS - timeSinceBuy;
            throw new functions.https.HttpsError(
              'failed-precondition',
              `Hold period: ${Math.ceil(remainingMs / 1000)}s remaining`
            );
          }
        }

        // Calculate marginal price impact (cumulative sell volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;

        // Daily 10% impact cap: sells always execute (players must be able to
        // exit), but once the cap is hit the trade stops moving the price.
        const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
        const remainingDailyImpact = Math.max(0, MAX_DAILY_IMPACT - effectiveDailyImpact);
        priceImpact = Math.min(priceImpact, currentPrice * remainingDailyImpact);

        newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
        executionPrice = Math.max(MIN_PRICE, newPrice * (1 - effectiveSpread / 2)); // Bid price
        totalCost = executionPrice * amount;

        // Execute sell
        newCash = cash + totalCost;
        newHoldings[ticker] = Math.round((currentHoldings - amount) * 10000) / 10000;
        if (newHoldings[ticker] <= 0) {
          delete newHoldings[ticker];
        }

      // SHORT LOGIC
      } else if (action === 'short') {
        // Enforce 10-trade cap
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} shorts on ${ticker}. This resets on a rolling 24h basis.`);
        }

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
        const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
        const MAX_SHORTS_BEFORE_COOLDOWN = 3;
        const shortHistory = userData.shortHistory?.[ticker] || [];
        const recentShorts = shortHistory.filter(ts => now - ts < EIGHT_HOURS_MS);

        if (recentShorts.length >= MAX_SHORTS_BEFORE_COOLDOWN) {
          const oldestRecent = Math.min(...recentShorts);
          const unlocksAt = oldestRecent + EIGHT_HOURS_MS;
          const remainingMs = unlocksAt - now;
          const hours = Math.floor(remainingMs / 3600000);
          const minutes = Math.ceil((remainingMs % 3600000) / 60000);
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Short limit reached. You can short ${ticker} again in ${hours}h ${minutes}m.`
          );
        }

        // Calculate marginal price impact (cumulative volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;

        // Check daily 10% impact cap
        const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
        if (effectiveDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
          throw new functions.https.HttpsError('failed-precondition',
            `Daily trading limit reached for ${ticker}. No more shorts today.`);
        }

        newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
        executionPrice = Math.max(MIN_PRICE, newPrice * (1 - effectiveSpread / 2)); // Bid price
        totalCost = executionPrice * amount;

        // Execute short — v2: deduct margin only, no sale proceeds
        newCash = cash - marginRequired;

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

      // COVER LOGIC
      } else if (action === 'cover') {
        // Enforce 10-trade cap for covers
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} covers on ${ticker}. This resets on a rolling 24h basis.`);
        }

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
          const HOLD_PERIOD_MS = 45 * 1000;

          if (timeSinceOpen < HOLD_PERIOD_MS) {
            const remainingMs = HOLD_PERIOD_MS - timeSinceOpen;
            throw new functions.https.HttpsError(
              'failed-precondition',
              `Hold period: ${Math.ceil(remainingMs / 1000)}s remaining`
            );
          }
        }

        // Calculate marginal price impact (cumulative cover volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume) * ageImpactFactor;

        // Daily 10% impact cap: covers always execute (players must be able to
        // exit), but once the cap is hit the trade stops moving the price.
        const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
        const remainingDailyImpact = Math.max(0, MAX_DAILY_IMPACT - effectiveDailyImpact);
        priceImpact = Math.min(priceImpact, currentPrice * remainingDailyImpact);

        newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
        executionPrice = newPrice * (1 + effectiveSpread / 2); // Ask price
        totalCost = executionPrice * amount;

        // Calculate margin to return (based on entry price, not current price)
        const costBasis = shortPosition.costBasis || shortPosition.entryPrice || executionPrice;
        const totalPositionMargin = shortPosition.margin || (costBasis * shortPosition.shares * 0.5);
        const marginToReturn = shortPosition.shares > 0 ? (totalPositionMargin / shortPosition.shares) * amount : 0;

        // Execute cover
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

        // Covers tracked in tickerTradeHistory for 10-trade limit
      }

      // Apply trailing effects to related characters
      // (CHARACTER_MAP is imported at the top of this file)
      const applyTrailingEffects = (sourceTicker, sourceOldPrice, sourceNewPrice, priceUpdates, depth = 0, visited = new Set()) => {
        if (depth > 3 || visited.has(sourceTicker)) {
          return; // Max 3 levels deep, prevent cycles
        }
        visited.add(sourceTicker);

        const character = CHARACTER_MAP[sourceTicker];
        if (!character?.trailingFactors) {
          return;
        }

        // No price change or zero price = no trailing effects (prevents division by zero)
        if (sourceOldPrice <= 0 || sourceOldPrice === sourceNewPrice) return;

        const priceChangePercent = (sourceNewPrice - sourceOldPrice) / sourceOldPrice;

        character.trailingFactors.forEach(({ ticker: relatedTicker, coefficient }) => {
          if (visited.has(relatedTicker)) {
            return; // Skip already visited
          }

          // Get current price - check priceUpdates first, then fall back to prices
          const oldRelatedPrice = priceUpdates[relatedTicker] || prices[relatedTicker];
          if (oldRelatedPrice) {
            const trailingChange = priceChangePercent * coefficient;
            const newRelatedPrice = oldRelatedPrice * (1 + trailingChange);
            const settledRelatedPrice = Math.max(MIN_PRICE, Math.round(newRelatedPrice * 100) / 100);

            priceUpdates[relatedTicker] = settledRelatedPrice;

            // Recursively apply trailing effects
            applyTrailingEffects(relatedTicker, oldRelatedPrice, settledRelatedPrice, priceUpdates, depth + 1, visited);
          }
        });
      };

      // Start with the traded ticker's price change
      const priceUpdates = { [ticker]: newPrice };
      applyTrailingEffects(ticker, currentPrice, newPrice, priceUpdates);

      // Stock → ETF reverse propagation: when a non-ETF stock changes price,
      // update any parent ETFs proportionally using their trailing coefficients.
      // Build reverse lookup: stockTicker → [{etfTicker, coefficient}]
      const reverseETFMap = {};
      CHARACTERS.filter(c => c.isETF && c.trailingFactors).forEach(etf => {
        etf.trailingFactors.forEach(({ ticker: stockTicker, coefficient }) => {
          if (!reverseETFMap[stockTicker]) reverseETFMap[stockTicker] = [];
          reverseETFMap[stockTicker].push({ etfTicker: etf.ticker, coefficient });
        });
      });

      // For each changed non-ETF ticker, propagate to parent ETFs
      Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
        const updatedChar = CHARACTER_MAP[updatedTicker];
        if (updatedChar?.isETF) return; // Skip ETFs themselves

        const originalPrice = updatedTicker === ticker ? currentPrice : prices[updatedTicker];
        if (!originalPrice || originalPrice <= 0 || originalPrice === updatedPrice) return;

        const parentETFs = reverseETFMap[updatedTicker];
        if (!parentETFs) return;

        const stockChangePercent = (updatedPrice - originalPrice) / originalPrice;

        parentETFs.forEach(({ etfTicker, coefficient }) => {
          // Skip if this ETF is the ticker being directly traded (prevents feedback loop)
          if (etfTicker === ticker) return;

          const etfOldPrice = priceUpdates[etfTicker] || prices[etfTicker];
          if (!etfOldPrice || etfOldPrice <= 0) return;

          const etfChange = stockChangePercent * coefficient;
          const etfNewPrice = Math.max(MIN_PRICE, Math.round(etfOldPrice * (1 + etfChange) * 100) / 100);
          priceUpdates[etfTicker] = etfNewPrice;
          // Do NOT call applyTrailingEffects on updated ETFs (prevents ETF→stock→ETF loop)
        });
      });

      // Track trailing effects in tickerTradeHistory so users can't bypass the 10% limit
      // by trading one ticker and getting free impact on related tickers
      // Append synthetic entries (shares: 0, just impact) for affected tickers
      const trailingEntries = {}; // { ticker: { action: entry } }
      Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
        if (updatedTicker === ticker) return; // Already tracked via main entry
        const originalPrice = prices[updatedTicker];
        if (originalPrice && originalPrice > 0) {
          const trailingImpactPercent = Math.abs(updatedPrice - originalPrice) / originalPrice;
          // Use buy direction for trailing effects (they represent buy-side pressure)
          const trailingAction = (action === 'buy' || action === 'cover') ? 'buy' : 'sell';
          trailingEntries[updatedTicker] = { action: trailingAction, entry: { ts: now, shares: 0, impact: trailingImpactPercent } };
        }
      });

      // Build market updates (prices + price history)
      const timestamp = Date.now();
      const marketUpdates = {
        prices: { ...prices, ...priceUpdates }
      };

      // Add price history for all updated tickers
      Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
        marketUpdates[`priceHistory.${updatedTicker}`] = admin.firestore.FieldValue.arrayUnion({
          timestamp,
          price: updatedPrice
        });
      });

      transaction.update(marketRef, marketUpdates);

      // Build updated tickerTradeHistory
      const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
      const newTradeEntry = { ts: now, shares: amount, impact: impactPercent };

      // Start from existing history, prune old entries, append new
      const updatedTickerTradeHistory = {};
      for (const [t, actions] of Object.entries(tickerTradeHistory)) {
        updatedTickerTradeHistory[t] = {};
        for (const [act, entries] of Object.entries(actions)) {
          const { recent } = pruneAndSumTradeHistory(entries, now);
          updatedTickerTradeHistory[t][act] = recent;
        }
      }
      // Ensure ticker+action path exists
      if (!updatedTickerTradeHistory[ticker]) updatedTickerTradeHistory[ticker] = {};
      if (!updatedTickerTradeHistory[ticker][action]) updatedTickerTradeHistory[ticker][action] = [];
      updatedTickerTradeHistory[ticker][action] = [...(updatedTickerTradeHistory[ticker][action] || []), newTradeEntry];

      // Append trailing effect entries
      for (const [trailingTicker, { action: trailingAction, entry }] of Object.entries(trailingEntries)) {
        if (!updatedTickerTradeHistory[trailingTicker]) updatedTickerTradeHistory[trailingTicker] = {};
        if (!updatedTickerTradeHistory[trailingTicker][trailingAction]) updatedTickerTradeHistory[trailingTicker][trailingAction] = [];
        updatedTickerTradeHistory[trailingTicker][trailingAction].push(entry);
      }

      // Compute week ID for weekly missions (Monday-based)
      const nowDate = new Date();
      const weekStart = new Date(nowDate);
      weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
      if (weekStart > nowDate) weekStart.setDate(weekStart.getDate() - 7);
      const weekId = weekStart.toISOString().split('T')[0];

      // NaN guard — never write corrupted data to Firestore
      if (isNaN(newCash) || isNaN(executionPrice) || isNaN(totalCost) || isNaN(newPrice)) {
        throw new functions.https.HttpsError('internal', 'Trade calculation error: invalid numeric result');
      }

      // Compute final trade count for this action (after appending new entry)
      const finalTradeCount = updatedTickerTradeHistory[ticker]?.[action]?.length || 0;

      const updates = {
        cash: newCash,
        holdings: newHoldings,
        shorts: newShorts,
        marginUsed: newMarginUsed,
        tickerTradeHistory: updatedTickerTradeHistory,
        lastTradeTime: admin.firestore.Timestamp.now(),
        // Mission progress (server-side — blocks client spoofing)
        totalTrades: admin.firestore.FieldValue.increment(1),
        [`dailyMissions.${todayDate}.tradesCount`]: admin.firestore.FieldValue.increment(1),
        [`dailyMissions.${todayDate}.tradeVolume`]: admin.firestore.FieldValue.increment(amount),
        [`weeklyMissions.${weekId}.tradeValue`]: admin.firestore.FieldValue.increment(totalCost),
        [`weeklyMissions.${weekId}.tradeVolume`]: admin.firestore.FieldValue.increment(amount),
        [`weeklyMissions.${weekId}.tradeCount`]: admin.firestore.FieldValue.increment(1),
        [`weeklyMissions.${weekId}.tradingDays.${todayDate}`]: true
      };

      // ANTI-MANIPULATION: Track ticker trade times for buy/short cooldown
      if (action === 'buy' || action === 'short') {
        updates[`lastTickerTradeTime.${ticker}`] = admin.firestore.Timestamp.now();
      }

      if (action === 'buy') {
        updates[`lastBuyTime.${ticker}`] = admin.firestore.Timestamp.now();
        updates[`dailyMissions.${todayDate}.boughtAny`] = true;

        // Cost basis tracking
        const currentHoldings = holdings[ticker] || 0;
        const currentCostBasis = userData.costBasis?.[ticker] || 0;
        const totalHoldings = newHoldings[ticker] || 0;
        const newCostBasis = currentHoldings > 0
          ? (totalHoldings > 0 ? ((currentCostBasis * currentHoldings) + (executionPrice * amount)) / totalHoldings : executionPrice)
          : executionPrice;
        updates[`costBasis.${ticker}`] = Math.round(newCostBasis * 100) / 100;

        // Dividend cohort: new shares enter pending with a 10-day wait
        const existingCohort = userData.holdingCohorts?.[ticker] || null;
        const newCohort = addPendingShares(existingCohort, amount, now);
        // Dividend Demon: track when user first held this ETF (preserve on add, reset on full sell)
        if (character?.isETF) {
          newCohort.firstHeldAt = existingCohort?.firstHeldAt || now;
        }
        updates[`holdingCohorts.${ticker}`] = newCohort;

        // Lowest price while holding (for Diamond Hands achievement)
        const currentLowest = userData.lowestWhileHolding?.[ticker];
        const newLowest = currentHoldings === 0
          ? executionPrice
          : Math.min(currentLowest || executionPrice, executionPrice);
        updates[`lowestWhileHolding.${ticker}`] = Math.round(newLowest * 100) / 100;

        // Crew-specific mission fields
        const userCrew = userData.crew;
        if (userCrew) {
          const crewMembers = CREW_MEMBERS[userCrew] || [];
          if (crewMembers.includes(ticker)) {
            updates[`dailyMissions.${todayDate}.boughtCrewMember`] = true;
            updates[`dailyMissions.${todayDate}.crewSharesBought`] = admin.firestore.FieldValue.increment(amount);
          }
          if (!crewMembers.includes(ticker) && ALL_CREW_TICKERS.has(ticker)) {
            updates[`dailyMissions.${todayDate}.boughtRival`] = true;
          }
        }
        // Underdog check (price < $20)
        if (currentPrice < 20) {
          updates[`dailyMissions.${todayDate}.boughtUnderdog`] = true;
        }
      }

      if (action === 'sell') {
        updates[`dailyMissions.${todayDate}.soldAny`] = true;
        // Clear cost basis if selling all shares
        const totalHoldings = newHoldings[ticker] || 0;
        if (totalHoldings <= 0) {
          updates[`costBasis.${ticker}`] = 0;
          updates[`lowestWhileHolding.${ticker}`] = admin.firestore.FieldValue.delete();
        }

        // Dividend cohort: consume eligible first, then oldest pending. Delete
        // the field entirely if the position is closed.
        const existingCohort = userData.holdingCohorts?.[ticker] || null;
        const newCohort = decrementCohort(existingCohort, amount);
        if (newCohort) {
          updates[`holdingCohorts.${ticker}`] = newCohort;
        } else {
          updates[`holdingCohorts.${ticker}`] = admin.firestore.FieldValue.delete();
        }
      }

      if (action === 'short') {
        const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
        const shortHistory = userData.shortHistory || {};
        const tickerHistory = (shortHistory[ticker] || []).filter(ts => now - ts < EIGHT_HOURS_MS);
        tickerHistory.push(now);
        updates.shortHistory = { ...shortHistory, [ticker]: tickerHistory };
      }

      // Append to transaction log (keep last 100 entries)
      const txLogEntry = { timestamp: now, ticker, shares: amount, cashBefore: cash, cashAfter: newCash };
      if (action === 'buy') {
        txLogEntry.type = 'BUY';
        txLogEntry.pricePerShare = executionPrice;
        txLogEntry.totalCost = totalCost;
      } else if (action === 'sell') {
        txLogEntry.type = 'SELL';
        txLogEntry.pricePerShare = executionPrice;
        txLogEntry.totalRevenue = totalCost;
        const costBasis = userData.costBasis?.[ticker] || 0;
        txLogEntry.profitPercent = costBasis > 0 ? Math.round(((executionPrice - costBasis) / costBasis) * 100) : 0;
      } else if (action === 'short') {
        txLogEntry.type = 'SHORT_OPEN';
        txLogEntry.entryPrice = executionPrice;
        txLogEntry.marginRequired = currentPrice * amount * SHORT_MARGIN_RATIO;
      } else if (action === 'cover') {
        txLogEntry.type = 'SHORT_CLOSE';
        const shortCostBasis = shorts[ticker]?.costBasis || shorts[ticker]?.entryPrice || 0;
        txLogEntry.totalProfit = (shortCostBasis - executionPrice) * amount;
      }
      const existingLog = userData.transactionLog || [];
      updates.transactionLog = [...existingLog, txLogEntry].slice(-100);

      transaction.update(userRef, updates);

      // Log trade
      const tradeRecord = {
        uid,
        ticker,
        action,
        amount,
        price: executionPrice,
        priceImpact: currentPrice > 0 ? priceImpact / currentPrice : 0,
        totalValue: totalCost,
        cashBefore: cash,
        cashAfter: newCash,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip: context.rawRequest?.ip || 'unknown'
      };
      const tradeRef = db.collection('trades').doc();
      transaction.set(tradeRef, tradeRecord);

      // ANTI-MANIPULATION: Save IP-level tickerTradeHistory
      if (ipTrackingRef && sanitizedIp) {
        // Build IP trade history: prune old, append new entry
        const updatedIpHistory = {};
        for (const [t, actions] of Object.entries(ipTickerTradeHistory)) {
          updatedIpHistory[t] = {};
          for (const [act, entries] of Object.entries(actions)) {
            const { recent } = pruneAndSumTradeHistory(entries, now);
            updatedIpHistory[t][act] = recent;
          }
        }
        if (!updatedIpHistory[ticker]) updatedIpHistory[ticker] = {};
        if (!updatedIpHistory[ticker][action]) updatedIpHistory[ticker][action] = [];
        updatedIpHistory[ticker][action].push(newTradeEntry);
        // Also append trailing entries to IP tracking
        for (const [trailingTicker, { action: trailingAction, entry }] of Object.entries(trailingEntries)) {
          if (!updatedIpHistory[trailingTicker]) updatedIpHistory[trailingTicker] = {};
          if (!updatedIpHistory[trailingTicker][trailingAction]) updatedIpHistory[trailingTicker][trailingAction] = [];
          updatedIpHistory[trailingTicker][trailingAction].push(entry);
        }
        // Record this account as a recent trader from the IP (rolling 1h) for the
        // per-IP multi-account cap; prune entries older than 1h.
        const ONE_HOUR_MS = 60 * 60 * 1000;
        const updatedRecentTraders = {};
        for (const [u, ts] of Object.entries(ipRecentTraders)) {
          if (now - (typeof ts === 'number' ? ts : 0) < ONE_HOUR_MS) updatedRecentTraders[u] = ts;
        }
        // Only buy/short consume a per-IP slot (sell/cover never blocked, so don't count them).
        if (action === 'buy' || action === 'short') updatedRecentTraders[uid] = now;
        transaction.set(ipTrackingRef, { tickerTradeHistory: updatedIpHistory, recentTraders: updatedRecentTraders }, { merge: true });
      }

      // Compute achievement context inside transaction (we have the data here)
      let achievementCtx = { tradeValue: totalCost };
      if (action === 'buy') {
        achievementCtx.isMonopoly = hitMaxImpact;
        // That's a Big Deal: bought a bullish stock at its 7-day low
        const buyHistory = priceHistory[ticker] || [];
        if (buyHistory.length >= 2) {
          const now7d = now - 7 * 24 * 60 * 60 * 1000;
          const now24h = now - 24 * 60 * 60 * 1000;
          const last7d = buyHistory.filter(h => h.timestamp >= now7d);
          const weeklyLow = last7d.length > 0 ? Math.min(...last7d.map(h => h.price)) : 0;
          const price24hAgo = [...buyHistory].reverse().find(h => h.timestamp <= now24h)?.price || currentPrice;
          const price7dAgo = [...buyHistory].reverse().find(h => h.timestamp <= now7d)?.price || currentPrice;
          const dailyChange = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
          const weeklyChange = price7dAgo > 0 ? ((currentPrice - price7dAgo) / price7dAgo) * 100 : 0;
          const sentimentScore = (dailyChange * 0.6) + (weeklyChange * 0.4);
          achievementCtx.boughtBullishAtWeeklyLow =
            weeklyLow > 0 && currentPrice <= weeklyLow * 1.03 && sentimentScore >= 1;
        }
      }
      if (action === 'sell') {
        const costBasis = userData.costBasis?.[ticker] || 0;
        const sellProfitPercent = costBasis > 0 ? ((executionPrice - costBasis) / costBasis) * 100 : 0;
        const lowestWhileHolding = userData.lowestWhileHolding?.[ticker] || costBasis;
        const dipPercent = costBasis > 0 ? ((costBasis - lowestWhileHolding) / costBasis) * 100 : 0;
        achievementCtx.sellProfitPercent = sellProfitPercent;
        achievementCtx.isDiamondHands = dipPercent >= 30 && sellProfitPercent > 0;
        // Track NPC profit (non-crew characters)
        if (!ALL_CREW_TICKERS.has(ticker) && costBasis > 0) {
          const profitPerShare = executionPrice - costBasis;
          if (profitPerShare > 0) {
            achievementCtx.npcProfit = profitPerShare * amount;
          }
        }
        // Track if user sold last share (for Unifier revocation)
        achievementCtx.soldLastShare = !(newHoldings[ticker] > 0);
        // Discount Deacon: dollar profit ending in .99
        if (costBasis > 0) {
          const dollarProfit = Math.round((executionPrice - costBasis) * amount * 100) / 100;
          if (dollarProfit > 0 && Math.round(dollarProfit * 100) % 100 === 99) {
            achievementCtx.isDiscountDeacon = true;
          }
        }
        // Topped Off: sold at all-time high
        const tickerHistory = priceHistory[ticker] || [];
        if (tickerHistory.length > 0) {
          const allTimeHigh = Math.max(...tickerHistory.map(h => h.price));
          achievementCtx.soldAtAllTimeHigh = executionPrice >= allTimeHigh;
        }
        // Animal Instinct: track cumulative profit from animal characters
        if (ANIMAL_TICKERS.has(ticker) && costBasis > 0) {
          const profitThisSell = Math.max(0, (executionPrice - costBasis) * amount);
          const pbt = userData.profitByTicker || {};
          const newTickerProfit = (pbt[ticker] || 0) + profitThisSell;
          updates[`profitByTicker.${ticker}`] = newTickerProfit;
          achievementCtx.animalProfit = newTickerProfit +
            [...ANIMAL_TICKERS].filter(t => t !== ticker).reduce((s, t) => s + (pbt[t] || 0), 0);
        }
      }
      if (action === 'cover') {
        const shortCostBasis = shorts[ticker]?.costBasis || shorts[ticker]?.entryPrice || 0;
        achievementCtx.isColdBlooded = shortCostBasis > 0 && executionPrice < shortCostBasis;
        // Discount Deacon: dollar profit ending in .99
        if (shortCostBasis > 0) {
          const dollarProfit = Math.round((shortCostBasis - executionPrice) * amount * 100) / 100;
          if (dollarProfit > 0 && Math.round(dollarProfit * 100) % 100 === 99) {
            achievementCtx.isDiscountDeacon = true;
          }
        }
      }

      // Warn if next short will trigger cooldown
      let shortWarning = null;
      if (action === 'short') {
        const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
        const sh = userData.shortHistory?.[ticker] || [];
        // +1 because this trade's timestamp hasn't been pushed yet when we read shortHistory
        const recentCount = sh.filter(ts => now - ts < EIGHT_HOURS_MS).length + 1;
        if (recentCount >= 2) {
          shortWarning = `Next short on $${ticker} will trigger an 8-hour cooldown.`;
        }
      }

      return {
        success: true,
        executionPrice,
        newPrice,
        priceImpact,
        totalCost,
        newCash,
        newHoldings,
        newShorts,
        newMarginUsed,
        priceUpdates, // All affected tickers (including trailing effects)
        remainingDailyImpact: MAX_DAILY_IMPACT - (cumulativeDailyImpact + impactPercent),
        remainingTrades: MAX_TRADES_PER_TICKER_24H - finalTradeCount,
        isLastTrade: finalTradeCount >= MAX_TRADES_PER_TICKER_24H,
        dailyImpactPercent: cumulativeDailyImpact + impactPercent,
        shortWarning,
        achievementCtx
      };
    }, { maxAttempts: 1 });

    // Trade limit notifications (fire-and-forget, after transaction)
    const tradesUsed = MAX_TRADES_PER_TICKER_24H - (result.remainingTrades || 0);
    if (tradesUsed >= 7 && tradesUsed < MAX_TRADES_PER_TICKER_24H) {
      await writeNotification(uid, {
        type: 'system',
        title: 'Trade Limit Warning',
        message: `You have ${tradesUsed}/${MAX_TRADES_PER_TICKER_24H} ${action}s on $${ticker} in the last 24h.`,
        data: { ticker }
      });
    } else if (tradesUsed >= MAX_TRADES_PER_TICKER_24H) {
      await writeNotification(uid, {
        type: 'system',
        title: 'Trade Limit Reached',
        message: `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} ${action}s on $${ticker}. This resets on a rolling 24h basis.`,
        data: { ticker }
      });
    }

    // Award context-based achievements AFTER transaction completes
    // (can't do additional queries inside the transaction)
    try {
      const ctx = result.achievementCtx || {};
      const userDoc = await db.collection('users').doc(uid).get();
      if (userDoc.exists) {
        const currentAchievements = userDoc.data().achievements || [];
        const newAchievements = [];

        if (ctx.tradeValue >= 1000 && !currentAchievements.includes('SHARK')) newAchievements.push('SHARK');
        if (ctx.sellProfitPercent >= 25 && !currentAchievements.includes('BULL_RUN')) newAchievements.push('BULL_RUN');
        if (ctx.isDiamondHands && !currentAchievements.includes('DIAMOND_HANDS')) newAchievements.push('DIAMOND_HANDS');
        if (ctx.isColdBlooded && !currentAchievements.includes('COLD_BLOODED')) newAchievements.push('COLD_BLOODED');
        if (ctx.isMonopoly && !currentAchievements.includes('MONOPOLY')) newAchievements.push('MONOPOLY');
        if (ctx.isDiscountDeacon && !currentAchievements.includes('DISCOUNT_DEACON')) newAchievements.push('DISCOUNT_DEACON');
        if (ctx.soldAtAllTimeHigh && !currentAchievements.includes('TOPPED_OFF')) newAchievements.push('TOPPED_OFF');
        if (ctx.boughtBullishAtWeeklyLow && !currentAchievements.includes('THATS_A_BIG_DEAL')) newAchievements.push('THATS_A_BIG_DEAL');
        if ((ctx.animalProfit || 0) >= 250 && !currentAchievements.includes('ANIMAL_INSTINCT')) newAchievements.push('ANIMAL_INSTINCT');

        // Plugged In: awarded once a Discord-linked user makes any trade
        if (userDoc.data().discordId && !currentAchievements.includes('DISCORD_LINKED')) newAchievements.push('DISCORD_LINKED');

        // NPC Lover: track cumulative profit from non-crew characters
        const achievementUpdate = {};
        if (ctx.npcProfit > 0) {
          achievementUpdate.npcProfit = admin.firestore.FieldValue.increment(ctx.npcProfit);
          const currentNpcProfit = (userDoc.data().npcProfit || 0) + ctx.npcProfit;
          if (currentNpcProfit >= 1000 && !currentAchievements.includes('NPC_LOVER')) newAchievements.push('NPC_LOVER');
        }

        if (newAchievements.length > 0) {
          achievementUpdate.achievements = admin.firestore.FieldValue.arrayUnion(...newAchievements);
          for (const achId of newAchievements) {
            achievementUpdate[`achievementDates.${achId}`] = Date.now();
          }
          result.newAchievements = newAchievements;
        }

        if (Object.keys(achievementUpdate).length > 0) {
          await db.collection('users').doc(uid).update(achievementUpdate);
        }

        // Unifier of Seoul revocation: if this sell emptied a non-ETF holding
        // and the user currently holds UNIFIER, they no longer qualify.
        // syncPortfolio will re-award it if they buy the share back.
        if (
          action === 'sell' &&
          ctx.soldLastShare &&
          currentAchievements.includes('UNIFIER')
        ) {
          const char = CHARACTERS.find(c => c.ticker === ticker);
          if (char && !char.isETF) {
            await db.collection('users').doc(uid).update({
              achievements: admin.firestore.FieldValue.arrayRemove('UNIFIER'),
            });
          }
        }
      }
    } catch (achErr) {
      console.error('Achievement check after trade failed:', achErr);
    }

    // Remove internal context from response
    delete result.achievementCtx;

    // Fire-and-forget: write trade feed entry + achievement notifications
    try {
      const userDoc2 = await db.collection('users').doc(uid).get();
      const uData = userDoc2.exists ? userDoc2.data() : {};
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
      const feedMsg = action === 'buy' ? `bought ${amount} $${ticker}`
        : action === 'sell' ? `sold ${amount} $${ticker}`
        : action === 'short' ? `shorted ${amount} $${ticker}`
        : `covered ${amount} $${ticker}`;

      writeFeedEntry({
        type: 'trade',
        userId: uid,
        displayName: uData.displayName || 'Anonymous',
        crew: uData.crew || null,
        message: feedMsg,
        ticker,
        action,
        amount,
        price: result.executionPrice || 0,
        // Delay large block trades 30 min to prevent real-time targeting
        displayAfter: amount >= 50 ? Date.now() + 30 * 60 * 1000 : null
      });

      // Notify on new achievements
      if (result.newAchievements && result.newAchievements.length > 0) {
        for (const achId of result.newAchievements) {
          await writeNotification(uid, {
            type: 'achievement',
            title: 'Achievement Unlocked!',
            message: `You earned: ${achId}`,
            data: { achievementId: achId }
          });
          writeFeedEntry({
            type: 'achievement',
            userId: uid,
            displayName: uData.displayName || 'Anonymous',
            crew: uData.crew || null,
            message: `unlocked ${achId}`,
            achievementId: achId
          });
        }
      }

      // Update crew mission progress counters (buy/sell only)
      if (uData.crew && (action === 'buy' || action === 'sell')) {
        updateCrewMissionProgress(uData.crew, uid, action, amount, ticker, result.totalCost || 0);
      }

      // Watched-IP fraud tracking (position-opening trades only, fire-and-forget)
      if (action === 'buy' || action === 'short') {
        trackWatchedIpTrade(uid, uData.displayName, context.rawRequest?.ip || 'unknown');
      }
    } catch (feedErr) {
      console.error('Feed/notification write after trade failed:', feedErr.message);
    }

    return result;

  } catch (error) {
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    // Transaction contention (another trade hit the same data) — ask user to retry
    if (error.code === 10 || error.message?.includes('contention') || error.message?.includes('ABORTED')) {
      throw new functions.https.HttpsError(
        'aborted',
        'Market was busy. Please try again.'
      );
    }
    console.error('Trade execution error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Trade execution failed: ' + error.message
    );
  }
});
