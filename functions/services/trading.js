'use strict';
// Server-side trade execution with anti-manipulation enforcement.
// executeTrade runs as ONE atomic Firestore transaction; the heavy lifting
// lives in focused sibling modules, all called from here in a fixed order:
//   tradeGuards.js  — input validation + anti-abuse gates
//   tradeActions.js — buy/sell/short/cover price & balance math
//   tradePricing.js — trailing effects + ETF price propagation
//   tradeState.js   — IP tracking + user-doc update assembly
//   tradeEffects.js — post-commit achievements, notifications, feed
// All transaction reads happen before any writes, and the write order is:
// market doc → price history → trade record → ipTracking → user doc.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTERS } = require('../characters');
const {
  BID_ASK_SPREAD, ETF_BID_ASK_SPREAD,
  MAX_DAILY_IMPACT, MAX_TRADES_PER_TICKER_24H,
} = require('../constants');
const {
  checkBanned,
  checkDiscordWall,
  buildTradeCreditUpdates,
  getAccountAgeImpactFactor,
  pruneAndSumTradeHistory,
  priceHistoryRef,
  appendPriceHistory,
} = require('../helpers');
const {
  validateTradeInput, assertNoLiveSellOrders, assertMarketTradable,
  assertUserCanTrade, assertIpAccountCap, assertCooldowns,
  assertVelocityLimits, assertTradeCapNotHit,
} = require('./tradeGuards');
const { computeBuy, computeSell, computeShort, computeCover } = require('./tradeActions');
const { computePriceUpdates, buildTrailingEntries } = require('./tradePricing');
const {
  readIpTradeData, pruneHistoryMap, appendTradeEntries,
  buildIpTrackingUpdate, buildUserUpdates,
} = require('./tradeState');
const {
  buildAchievementCtx, buildShortWarning, sendTradeLimitNotifications,
  processTradeAchievements, writeTradeSideEffects,
} = require('./tradeEffects');

const ACTION_HANDLERS = { buy: computeBuy, sell: computeSell, short: computeShort, cover: computeCover };

exports.executeTrade = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in to trade.'
    );
  }

  const uid = context.auth.uid;
  const { ticker, action, amount } = validateTradeInput(data);
  await assertNoLiveSellOrders(uid, ticker, action);

  try {
    const userRef = db.collection('users').doc(uid);
    const marketRef = db.collection('market').doc('current');
    const now = admin.firestore.Timestamp.now().toMillis();

    // Execute trade in atomic transaction (maxAttempts:1 prevents phantom retries
    // where the first attempt commits but a retry sees post-trade state and fails)
    const result = await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);
      const marketDoc = await transaction.get(marketRef);
      const historyDoc = await transaction.get(priceHistoryRef());

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
      assertMarketTradable(marketData, ticker);

      const prices = marketData.prices || {};
      const priceHistory = historyDoc.exists ? (historyDoc.data() || {}) : {};
      let currentPrice = prices[ticker];

      const character = CHARACTERS.find(c => c.ticker === ticker);
      if (!character) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
      }

      // Auto-initialize price from basePrice if missing in Firestore
      if (!currentPrice) {
        currentPrice = character.basePrice;
      }

      assertUserCanTrade(userData, action);

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
      const { totalShares: cumulativeVolume, count: tradeCount } = pruneAndSumTradeHistory(actionHistory, now);

      // Compute total daily impact across ALL actions for this ticker (for 10% cap)
      let cumulativeDailyImpact = 0;
      const allActionsForTicker = tickerTradeHistory[ticker] || {};
      for (const act of ['buy', 'sell', 'short', 'cover']) {
        const { totalImpact } = pruneAndSumTradeHistory(allActionsForTicker[act] || [], now);
        cumulativeDailyImpact += totalImpact;
      }

      // IP-level trade history (shared across all accounts on the same IP);
      // transaction read, so it must come before any transaction writes.
      const ip = context.rawRequest?.ip || 'unknown';
      const { ipCumulativeDailyImpact, ipTrackingRef, ipTickerTradeHistory, ipRecentTraders } =
        await readIpTradeData(transaction, ip, ticker, now);

      assertIpAccountCap({ ip, uid, action, ipRecentTraders, now });
      assertCooldowns(userData, ticker, action, now);
      await assertVelocityLimits(uid, ticker, action, now);

      // Working copies of positions (sanitized: dust holdings dropped, short
      // fields defaulted so undefined values can't crash Firestore writes)
      const newHoldings = {};
      for (const [t, s] of Object.entries(holdings)) {
        if (s > 0.001) newHoldings[t] = s;
      }
      const newShorts = {};
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

      const effectiveSpread = character.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;
      // New accounts move the market less (anti-manipulation). Enforced here so
      // it actually applies — the frontend preview mirrors this factor.
      const ageImpactFactor = getAccountAgeImpactFactor(userData);

      assertTradeCapNotHit(tradeCount, action, ticker);

      // Per-action rules + price/balance math (mutates newHoldings/newShorts)
      const { priceImpact, newPrice, executionPrice, totalCost, newCash, newMarginUsed, marginLockUpdate, hitMaxImpact } =
        ACTION_HANDLERS[action]({
          ticker, amount, now, currentPrice, prices, effectiveSpread, ageImpactFactor,
          cumulativeVolume, cumulativeDailyImpact, ipCumulativeDailyImpact,
          cash, holdings, shorts, userData, marginEnabled, marginUsed, tierMultiplier,
          newHoldings, newShorts,
        });

      // Trailing effects + ETF propagation, and the synthetic history entries
      // that keep trailing moves inside the daily impact cap
      const priceUpdates = computePriceUpdates({ ticker, currentPrice, newPrice, prices });
      const trailingEntries = buildTrailingEntries({ priceUpdates, ticker, prices, action, now });

      // Build market updates (prices + price history)
      const timestamp = Date.now();
      const marketUpdates = {
        prices: { ...prices, ...priceUpdates }
      };
      const historyPoints = {};
      Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
        historyPoints[updatedTicker] = { timestamp, price: updatedPrice };
      });

      transaction.update(marketRef, marketUpdates);
      appendPriceHistory(transaction, historyPoints);

      // User trade history: prune old entries, append this trade + trailing
      const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
      const newTradeEntry = { ts: now, shares: amount, impact: impactPercent };
      const updatedTickerTradeHistory = appendTradeEntries(
        pruneHistoryMap(tickerTradeHistory, now), ticker, action, newTradeEntry, trailingEntries
      );

      // NaN guard — never write corrupted data to Firestore
      if (isNaN(newCash) || isNaN(executionPrice) || isNaN(totalCost) || isNaN(newPrice)) {
        throw new functions.https.HttpsError('internal', 'Trade calculation error: invalid numeric result');
      }

      // Compute final trade count for this action (after appending new entry)
      const finalTradeCount = updatedTickerTradeHistory[ticker]?.[action]?.length || 0;

      // Mission progress (server-side — blocks client spoofing). Shared with
      // limit-order and pre-market fills so every fill path counts the same.
      const { updates: creditUpdates, animalProfitTotal } = buildTradeCreditUpdates({
        userData, ticker, action, shares: amount, totalValue: totalCost,
        executionPrice, marketPrice: currentPrice, now
      });

      const updates = buildUserUpdates({
        ticker, action, amount, now, userData, character,
        cash, holdings, shorts, newCash, newHoldings, newShorts, newMarginUsed,
        marginLockUpdate, updatedTickerTradeHistory, creditUpdates,
        executionPrice, totalCost, currentPrice,
      });

      // Log trade
      const tradeRecord = {
        uid,
        ticker,
        action,
        amount,
        price: executionPrice,
        priceImpact: impactPercent,
        totalValue: totalCost,
        cashBefore: cash,
        cashAfter: newCash,
        timestamp: admin.firestore.FieldValue.serverTimestamp(),
        ip
      };
      const tradeRef = db.collection('trades').doc();
      transaction.set(tradeRef, tradeRecord);

      // ANTI-MANIPULATION: Save IP-level tickerTradeHistory
      if (ipTrackingRef) {
        transaction.set(ipTrackingRef, buildIpTrackingUpdate({
          ipTickerTradeHistory, ipRecentTraders, ticker, action, newTradeEntry, trailingEntries, uid, now
        }), { merge: true });
      }

      // Compute achievement context inside transaction (we have the data here)
      const achievementCtx = buildAchievementCtx({
        action, ticker, amount, totalCost, hitMaxImpact, priceHistory,
        currentPrice, executionPrice, userData, shorts, newHoldings,
        animalProfitTotal, now,
      });

      // Persist the user updates. Single write — transaction.update() snapshots
      // its data at call time, so anything appended to `updates` after this
      // call would be silently dropped.
      transaction.update(userRef, updates);

      const shortWarning = buildShortWarning({ action, ticker, userData, now });

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
    await sendTradeLimitNotifications(uid, action, ticker, result.remainingTrades);

    // Award context-based achievements AFTER transaction completes
    await processTradeAchievements(uid, ticker, action, result);

    // Remove internal context from response
    delete result.achievementCtx;

    // Fire-and-forget: trade feed entry, achievement notifications, crew
    // mission progress, watched-IP tracking
    await writeTradeSideEffects({
      uid, ticker, action, amount, result,
      ip: context.rawRequest?.ip || 'unknown'
    });

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
