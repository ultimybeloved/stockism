'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { isWeeklyTradingHalt } = require('../constants');
const { sendDiscordMessage, writeNotification } = require('../helpers');

// ─── Internal ────────────────────────────────────────────────────────────────

function censorUsername(username) {
  if (!username || username.length <= 2) return '***';
  const first = username.charAt(0);
  const last = username.charAt(username.length - 1);
  const middle = '*'.repeat(Math.max(1, username.length - 2));
  return `${first}${middle}${last}`;
}

// ─── Discord Alert Triggers (called from client after key events) ─────────────

/**
 * Big Trade Alert - Triggered when large trades occur
 * Called from client after trade execution
 */
exports.bigTradeAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, shares, price, totalValue, type } = data;

  if ((shares >= 50 && price >= 35) || shares >= 100) {
    const embed = {
      title: '🐋 Whale Alert',
      description: `A significant ${type.toLowerCase()} order was executed`,
      color: type === 'BUY' ? 0x44FF44 : 0xFF4444,
      fields: [
        { name: 'Stock', value: `**${ticker}**`, inline: true },
        { name: 'Shares', value: shares.toLocaleString(), inline: true },
        { name: 'Price', value: `$${price.toFixed(2)}`, inline: true },
        { name: 'Total Value', value: `$${totalValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`, inline: false }
      ],
      timestamp: new Date().toISOString()
    };
    await sendDiscordMessage(null, [embed]);
  }

  return { success: true };
});

/**
 * Crew Milestone Alert - Called when crew reaches member milestone
 */
exports.crewMilestoneAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { crewName, memberCount } = data;
  const milestones = [5, 10, 25, 50, 100];
  if (milestones.includes(memberCount)) {
    const embed = {
      title: '🎉 Crew Milestone!',
      description: `**${crewName}** has reached **${memberCount} members**!`,
      color: 0xFFD700,
      timestamp: new Date().toISOString()
    };
    await sendDiscordMessage(null, [embed]);
  }

  return { success: true };
});

/**
 * Prediction Result Alert - Called when prediction is resolved
 */
exports.predictionResultAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { question, winningOption, totalBets, totalPayout, winners } = data;

  const embed = {
    title: '🔮 Prediction Resolved',
    description: `**${question}**`,
    color: 0x9B59B6,
    fields: [
      { name: 'Winning Outcome', value: `✅ ${winningOption}`, inline: false },
      { name: 'Total Bets', value: totalBets.toString(), inline: true },
      { name: 'Winners', value: winners.toString(), inline: true },
      { name: 'Total Payout', value: `$${totalPayout.toLocaleString(undefined, {maximumFractionDigits: 2})}`, inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true };
});

/**
 * All-Time High Alert - Called when stock hits new ATH
 */
exports.allTimeHighAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, price, previousHigh } = data;

  const embed = {
    title: '🎯 New All-Time High!',
    description: `**${ticker}** just hit a new record`,
    color: 0xFF6B35,
    fields: [
      { name: 'New High', value: `$${price.toFixed(2)}`, inline: true },
      { name: 'Previous High', value: `$${previousHigh.toFixed(2)}`, inline: true },
      { name: 'Gain', value: `+${(previousHigh > 0 ? ((price - previousHigh) / previousHigh) * 100 : 0).toFixed(1)}%`, inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true };
});

/**
 * Portfolio Milestone Alert - Called when user hits major portfolio milestone
 */
exports.portfolioMilestoneAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { milestone } = data;
  const milestones = {
    10000: { emoji: '💎', label: '$10K Club' },
    25000: { emoji: '🌟', label: '$25K Elite' },
    50000: { emoji: '🚀', label: '$50K Legend' },
    100000: { emoji: '👑', label: '$100K Royalty' }
  };

  const milestoneInfo = milestones[milestone];
  if (milestoneInfo) {
    const embed = {
      title: `${milestoneInfo.emoji} Portfolio Milestone Achieved!`,
      description: `A trader just joined the **${milestoneInfo.label}**`,
      color: 0xFFD700,
      timestamp: new Date().toISOString()
    };
    await sendDiscordMessage(null, [embed]);
  }

  return { success: true };
});

/**
 * IPO Announcement - Called when a new IPO is created
 */
exports.ipoAnnouncementAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, characterName, ipoPrice, postIpoPrice, startsAt, endsAt, totalShares, maxPerUser } = data;
  const startsImmediately = !startsAt || startsAt <= Date.now() + 60000;

  const embed = {
    color: 0x00D4FF,
    title: '🚀 NEW IPO ANNOUNCED!',
    description: `**${characterName}** ($${ticker}) is going public!`,
    fields: [
      { name: 'IPO Price', value: `$${ipoPrice.toFixed(2)}`, inline: true },
      { name: 'Post-IPO Price', value: `$${postIpoPrice.toFixed(2)} (+15%)`, inline: true },
      { name: 'Shares Available', value: `${totalShares || 150} total (max ${maxPerUser || 10}/person)`, inline: false },
      {
        name: startsImmediately ? 'IPO Ends' : 'IPO Opens',
        value: startsImmediately ? `<t:${Math.floor(endsAt / 1000)}:R>` : `<t:${Math.floor(startsAt / 1000)}:R>`,
        inline: false
      }
    ],
    footer: { text: startsImmediately ? 'IPO is LIVE now - first come, first served!' : 'IPO window coming soon - Get in early!' },
    timestamp: new Date().toISOString()
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true };
});

/**
 * IPO Closing Results - Called when an IPO closes
 */
exports.ipoClosingAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, characterName, participants, totalInvested, totalShares } = data;

  const embed = {
    color: 0x00FF00,
    title: '📊 IPO CLOSED',
    description: `**${characterName}** ($${ticker}) IPO has ended!`,
    fields: [
      { name: 'Participants', value: participants.toString(), inline: true },
      { name: 'Total Invested', value: `$${totalInvested.toLocaleString(undefined, {maximumFractionDigits: 2})}`, inline: true },
      { name: 'Shares Sold', value: totalShares.toLocaleString(), inline: true }
    ],
    footer: { text: 'Trading is now live at +15% from IPO price!' },
    timestamp: new Date().toISOString()
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true };
});

/**
 * Bankruptcy Alert - Called when a user goes bankrupt (censored name)
 */
exports.bankruptcyAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  try {
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists) return { success: true };
    const userData = userDoc.data();
    if (!userData.isBankrupt && (userData.cash || 0) >= 0) {
      console.log(`Bankruptcy alert rejected: ${context.auth.uid} is not bankrupt`);
      return { success: true };
    }

    const actualValue = userData.portfolioValue || 0;
    const censoredName = censorUsername(userData.displayName || 'Unknown');

    const embed = {
      color: 0xFF0000,
      title: '💔 Trader Bankrupt',
      description: `**${censoredName}** has gone bust`,
      fields: [
        { name: 'Final Portfolio Value', value: `$${actualValue.toFixed(2)}`, inline: true }
      ],
      footer: { text: 'Risk management is key!' },
      timestamp: new Date().toISOString()
    };

    await sendDiscordMessage(null, [embed]);
  } catch (e) {
    console.error('Bankruptcy alert failed:', e);
  }
  return { success: true };
});

/**
 * Comeback Story Alert - Called when someone recovers from near-bankruptcy (censored name)
 */
exports.comebackAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  try {
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists) return { success: true };
    const userData = userDoc.data();
    const actualValue = userData.portfolioValue || 0;

    const portfolioHistory = userData.portfolioHistory || [];
    const lowestHistorical = portfolioHistory.length > 0
      ? Math.min(...portfolioHistory.map(h => h.value || Infinity))
      : actualValue;
    const serverLowPoint = Math.min(lowestHistorical, actualValue);

    if (serverLowPoint <= 0 || actualValue <= serverLowPoint * 1.5) {
      return { success: true };
    }

    const gainPercent = ((actualValue - serverLowPoint) / serverLowPoint * 100).toFixed(0);
    const censoredName = censorUsername(userData.displayName || 'Unknown');

    const embed = {
      color: 0x00FF00,
      title: '🔥 Epic Comeback!',
      description: `**${censoredName}** recovered from the brink!`,
      fields: [
        { name: 'Lowest Point', value: `$${serverLowPoint.toFixed(2)}`, inline: true },
        { name: 'Current Value', value: `$${actualValue.toFixed(2)}`, inline: true },
        { name: 'Recovery', value: `+${gainPercent}%`, inline: true }
      ],
      footer: { text: 'Never give up!' },
      timestamp: new Date().toISOString()
    };

    await sendDiscordMessage(null, [embed]);
  } catch (e) {
    console.error('Comeback alert failed:', e);
  }
  return { success: true };
});

/**
 * Price Threshold Alert - Runs every 30 minutes
 * Alerts when stocks cross significant 24h thresholds (3%, 5%, 10%)
 */
exports.priceThresholdAlert = functions.pubsub
  .schedule('*/30 * * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping price threshold alerts — weekly trading halt active');
      return null;
    }

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();
      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data();
      if (marketData.marketHalted) {
        console.log('Skipping price threshold alerts — emergency halt active');
        return null;
      }

      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};
      const alertedThresholds = marketData.alertedThresholds || {};

      const now = Date.now();
      const dayAgo = now - (24 * 60 * 60 * 1000);
      const newAlerts = [];
      const updatedAlertedThresholds = { ...alertedThresholds };

      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        let price24hAgo = history[0].price;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= dayAgo) {
            price24hAgo = history[i].price;
            break;
          }
        }

        const change = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
        const absChange = Math.abs(change);
        const alertKey = `${ticker}_10_${change > 0 ? 'up' : 'down'}`;
        const lastAlerted = alertedThresholds[alertKey] || 0;
        const hoursSinceAlert = (now - lastAlerted) / (60 * 60 * 1000);

        if (absChange >= 10 && hoursSinceAlert > 12) {
          newAlerts.push({ ticker, price: currentPrice, price24hAgo, change, alertKey });
          updatedAlertedThresholds[alertKey] = now;
        }
      });

      if (newAlerts.length === 0) return null;

      await marketRef.update({ alertedThresholds: updatedAlertedThresholds });

      for (const alert of newAlerts) {
        const emoji = alert.change > 0 ? '🚀' : '💥';
        const direction = alert.change > 0 ? 'surged' : 'crashed';
        const embed = {
          title: `${emoji} Major Price Movement`,
          description: `**${alert.ticker}** has ${direction} ${Math.abs(alert.change).toFixed(1)}% in 24 hours`,
          color: alert.change > 0 ? 0x00FF00 : 0xFF0000,
          fields: [
            { name: 'Current Price', value: `$${alert.price.toFixed(2)}`, inline: true },
            { name: '24h Ago', value: `$${alert.price24hAgo.toFixed(2)}`, inline: true },
            { name: 'Change', value: `${alert.change > 0 ? '+' : ''}${alert.change.toFixed(1)}%`, inline: true }
          ],
          timestamp: new Date().toISOString()
        };
        await sendDiscordMessage(null, [embed]);
      }

      return null;
    } catch (error) {
      console.error('Error in priceThresholdAlert:', error);
      return null;
    }
  });

/**
 * Achievement Alert - Called when someone unlocks an achievement
 */
exports.achievementAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { achievementId, achievementName, achievementDescription } = data;

  try {
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists) return { success: true, alerted: false };
    const achievements = userDoc.data().achievements || [];
    if (!achievements.includes(achievementId)) {
      console.log(`Achievement alert rejected: ${context.auth.uid} doesn't have ${achievementId}`);
      return { success: true, alerted: false };
    }
  } catch (e) {
    console.error('Achievement validation failed:', e);
    return { success: true, alerted: false };
  }

  const noteworthyAchievements = [
    'SHARK', 'BULL_RUN', 'DIAMOND_HANDS', 'COLD_BLOODED',
    'PORTFOLIO_10K', 'PORTFOLIO_25K', 'PORTFOLIO_50K', 'PORTFOLIO_100K',
    'ORACLE', 'PROPHET', 'TOP_10', 'TOP_3', 'CHAMPION',
    'STREAK_30', 'STREAK_100', 'MISSION_50', 'MISSION_100'
  ];

  if (!noteworthyAchievements.includes(achievementId)) {
    return { success: true, alerted: false };
  }

  const embed = {
    title: '🏆 Achievement Unlocked',
    description: `A trader just earned **${achievementName}**`,
    color: 0xFFD700,
    fields: [{ name: 'Description', value: achievementDescription, inline: false }],
    timestamp: new Date().toISOString()
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true, alerted: true };
});

/**
 * Leaderboard Change Alert - Called when someone enters/exits top 10
 */
exports.leaderboardChangeAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { changeType, newRank, portfolioValue } = data;

  try {
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists) return { success: true, alerted: false };
    const actualValue = userDoc.data().portfolioValue || 0;
    if (typeof portfolioValue !== 'number' || Math.abs(actualValue - portfolioValue) > actualValue * 0.2) {
      console.log(`Leaderboard alert rejected: claimed ${portfolioValue}, actual ${actualValue}`);
      return { success: true, alerted: false };
    }
  } catch (e) {
    console.error('Leaderboard alert validation failed:', e);
    return { success: true, alerted: false };
  }

  let embed;
  if (changeType === 'entered_top10') {
    embed = {
      title: '🔥 Leaderboard Shakeup',
      description: `A trader just broke into the **Top 10**!`,
      color: 0xFF6B35,
      fields: [
        { name: 'New Position', value: `#${newRank}`, inline: true },
        { name: 'Portfolio', value: `$${portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };
  } else if (changeType === 'new_leader') {
    embed = {
      title: '👑 New #1 Leader',
      description: `The throne has a new ruler!`,
      color: 0xFFD700,
      fields: [
        { name: 'Portfolio', value: `$${portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };
  } else if (changeType === 'entered_top3') {
    embed = {
      title: '🥇 Top 3 Entry',
      description: `A trader just climbed into the **Top 3**!`,
      color: 0xC0C0C0,
      fields: [
        { name: 'New Position', value: `#${newRank}`, inline: true },
        { name: 'Portfolio', value: `$${portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`, inline: true }
      ],
      timestamp: new Date().toISOString()
    };
  } else {
    return { success: true, alerted: false };
  }

  await sendDiscordMessage(null, [embed]);
  return { success: true, alerted: true };
});

/**
 * Margin Liquidation Alert - Called when someone gets liquidated
 */
exports.marginLiquidationAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { lossAmount, portfolioBefore, portfolioAfter } = data;

  try {
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists) return { success: true, alerted: false };
    const userData = userDoc.data();
    const lastLiq = userData.lastLiquidation || 0;
    if (Date.now() - lastLiq > 10 * 60 * 1000) {
      console.log(`Liquidation alert rejected: no recent liquidation for ${context.auth.uid}`);
      return { success: true, alerted: false };
    }
  } catch (e) {
    console.error('Liquidation alert validation failed:', e);
    return { success: true, alerted: false };
  }

  const embed = {
    title: '💥 Margin Liquidation',
    description: `A trader was just **LIQUIDATED**`,
    color: 0xFF0000,
    fields: [
      { name: 'Portfolio Before', value: `$${portfolioBefore.toLocaleString(undefined, {maximumFractionDigits: 0})}`, inline: true },
      { name: 'Portfolio After', value: `$${portfolioAfter.toLocaleString(undefined, {maximumFractionDigits: 0})}`, inline: true },
      { name: 'Value Lost', value: `$${lossAmount.toLocaleString(undefined, {maximumFractionDigits: 0})}`, inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true, alerted: true };
});

// ─── Price Alerts (user-configured) ──────────────────────────────────────────

/**
 * Create a price alert for a ticker
 * Max 10 active alerts per user
 */
exports.createPriceAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { ticker, targetPrice, direction } = data;

  if (!ticker || typeof ticker !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }
  if (!targetPrice || typeof targetPrice !== 'number' || targetPrice <= 0 || targetPrice > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid target price.');
  }
  if (!['above', 'below'].includes(direction)) {
    throw new functions.https.HttpsError('invalid-argument', 'Direction must be "above" or "below".');
  }

  const character = CHARACTERS.find(c => c.ticker === ticker);
  if (!character) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown ticker.');
  }

  const alertsSnap = await db.collection('users').doc(uid).collection('priceAlerts')
    .where('triggered', '==', false)
    .get();

  if (alertsSnap.size >= 10) {
    throw new functions.https.HttpsError('failed-precondition', 'Maximum 10 active price alerts.');
  }

  const alertRef = await db.collection('users').doc(uid).collection('priceAlerts').add({
    ticker,
    targetPrice,
    direction,
    triggered: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, alertId: alertRef.id };
});

/**
 * Delete a price alert
 */
exports.deletePriceAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { alertId } = data;

  if (!alertId) {
    throw new functions.https.HttpsError('invalid-argument', 'Alert ID required.');
  }

  await db.collection('users').doc(uid).collection('priceAlerts').doc(alertId).delete();
  return { success: true };
});

/**
 * Check price alerts - runs on same schedule as limit orders (every 2 min)
 */
exports.checkPriceAlerts = functions.pubsub
  .schedule('every 2 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) return null;
      const prices = marketSnap.data().prices || {};

      const usersSnap = await db.collection('users').get();
      let triggered = 0;

      for (const userDoc of usersSnap.docs) {
        const alertsSnap = await userDoc.ref.collection('priceAlerts')
          .where('triggered', '==', false)
          .get();

        if (alertsSnap.empty) continue;

        for (const alertDoc of alertsSnap.docs) {
          const alert = alertDoc.data();
          const currentPrice = prices[alert.ticker];
          if (!currentPrice) continue;

          let shouldTrigger = false;
          if (alert.direction === 'above' && currentPrice >= alert.targetPrice) shouldTrigger = true;
          if (alert.direction === 'below' && currentPrice <= alert.targetPrice) shouldTrigger = true;

          if (shouldTrigger) {
            await alertDoc.ref.update({ triggered: true });
            writeNotification(userDoc.id, {
              type: 'alert',
              title: `Price Alert: $${alert.ticker}`,
              message: `$${alert.ticker} is now $${currentPrice.toFixed(2)} (${alert.direction === 'above' ? 'above' : 'below'} your target of $${alert.targetPrice.toFixed(2)})`,
              data: { ticker: alert.ticker, price: currentPrice }
            });
            triggered++;
          }
        }
      }

      console.log(`Price alert check: ${triggered} alerts triggered`);
      return { triggered };
    } catch (err) {
      console.error('Price alert check failed:', err);
      return null;
    }
  });
