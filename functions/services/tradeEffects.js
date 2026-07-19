'use strict';
// Post-trade side effects for executeTrade: achievement context + awarding,
// trade-limit notifications, feed entries, crew mission progress, and
// watched-IP fraud tracking. Everything here runs outside (or is computed for
// use outside) the trade transaction and must never throw into the caller.
// Internal module — required by trading.js, not exported through index.js.
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTERS } = require('../characters');
const {
  MAX_TRADES_PER_TICKER_24H, ALL_CREW_TICKERS, UNIFIER_FULL_SHARE_MIN,
  MAX_SHORTS_BEFORE_COOLDOWN, SHORT_COOLDOWN_WINDOW_MS,
} = require('../constants');
const { writeNotification, writeFeedEntry, reportError } = require('../helpers');
const { updateCrewMissionProgress } = require('./crewMissions');
const { trackWatchedIpTrade } = require('./watchlist');

// Compute achievement context inside the transaction (the caller has all the
// data there; awarding happens after commit via processTradeAchievements).
function buildAchievementCtx({
  action, ticker, amount, totalCost, hitMaxImpact, priceHistory,
  currentPrice, executionPrice, userData, shorts, newHoldings,
  animalProfitTotal, now,
}) {
  const achievementCtx = { tradeValue: totalCost };
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
    // Track if this sell dropped the holding below a full share (for Unifier
    // revocation — the achievement requires a full share of every character).
    achievementCtx.droppedBelowFullShare = !((newHoldings[ticker] || 0) >= UNIFIER_FULL_SHARE_MIN);
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
    // Animal Instinct: cumulative animal-character profit — computed (and
    // written to profitByTicker) by buildTradeCreditUpdates.
    if (animalProfitTotal !== null) {
      achievementCtx.animalProfit = animalProfitTotal;
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
  return achievementCtx;
}

// Warn if the next short on this ticker will trigger the cooldown. Uses the
// pre-trade shortHistory (+1 for the short that was just executed).
function buildShortWarning({ action, ticker, userData, now }) {
  if (action !== 'short') return null;
  const sh = userData.shortHistory?.[ticker] || [];
  // +1 because this trade's timestamp hasn't been pushed yet when we read shortHistory
  const recentCount = sh.filter(ts => now - ts < SHORT_COOLDOWN_WINDOW_MS).length + 1;
  if (recentCount >= MAX_SHORTS_BEFORE_COOLDOWN - 1) {
    return `Next short on $${ticker} will trigger an 8-hour cooldown.`;
  }
  return null;
}

// Trade limit notifications (fire-and-forget, after transaction)
async function sendTradeLimitNotifications(uid, action, ticker, remainingTrades) {
  const tradesUsed = MAX_TRADES_PER_TICKER_24H - (remainingTrades || 0);
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
}

// Award context-based achievements AFTER the transaction completes (can't do
// additional queries inside the transaction). Mutates result.newAchievements.
async function processTradeAchievements(uid, ticker, action, result) {
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

      // Unifier of Seoul revocation: if this sell dropped a non-ETF holding
      // below a full share and the user currently holds UNIFIER, they no
      // longer qualify. syncPortfolio re-awards it if they buy back up to a
      // full share. Also drop it from displayed pins so it can't keep
      // occupying a profile slot the user can no longer see to free up.
      if (
        action === 'sell' &&
        ctx.droppedBelowFullShare &&
        currentAchievements.includes('UNIFIER')
      ) {
        const char = CHARACTERS.find(c => c.ticker === ticker);
        if (char && !char.isETF) {
          await db.collection('users').doc(uid).update({
            achievements: admin.firestore.FieldValue.arrayRemove('UNIFIER'),
            displayedAchievementPins: admin.firestore.FieldValue.arrayRemove('UNIFIER'),
          });
        }
      }
    }
  } catch (achErr) {
    reportError(achErr, { where: 'executeTrade.achievementCheck', uid, ticker, action });
  }
}

// Fire-and-forget: trade feed entry, achievement notifications, crew mission
// progress, and watched-IP fraud tracking.
async function writeTradeSideEffects({ uid, ticker, action, amount, result, ip }) {
  try {
    const userDoc2 = await db.collection('users').doc(uid).get();
    const uData = userDoc2.exists ? userDoc2.data() : {};
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
      trackWatchedIpTrade(uid, uData.displayName, ip);
    }
  } catch (feedErr) {
    reportError(feedErr, { where: 'executeTrade.feedWrite', uid, ticker, action });
  }
}

module.exports = {
  buildAchievementCtx,
  buildShortWarning,
  sendTradeLimitNotifications,
  processTradeAchievements,
  writeTradeSideEffects,
};
