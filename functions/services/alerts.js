'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { isWeeklyTradingHalt, ADMIN_UID } = require('../constants');
const { sendDiscordMessage, writeNotification, priceHistoryRef } = require('../helpers');

// ─── Discord Alert Triggers ──────────────────────────────────────────────────

/**
 * IPO Announcement - Called when a new IPO is created
 */
exports.ipoAnnouncementAlert = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  // Only the admin panel creates IPOs, so only the admin may announce one —
  // otherwise any user could post fake official announcements through the bot.
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
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
 * Price Threshold Alert - Runs every 30 minutes
 * Alerts when stocks cross significant 24h thresholds (3%, 5%, 10%)
 */
exports.priceThresholdAlert = cf().pubsub
  .schedule('0 */6 * * *')
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
      const histSnap = await priceHistoryRef().get();
      const priceHistory = histSnap.exists ? (histSnap.data() || {}) : {};
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
// Server-side copy of the announceable achievements (subset of
// src/constants/achievements.js). The embed text comes from here, never from
// the client — otherwise any caller could post arbitrary text through the bot.
const NOTEWORTHY_ACHIEVEMENTS = {
  SHARK:           { name: 'Shark',            description: 'Execute a single trade worth $1,000+' },
  BULL_RUN:        { name: 'Bull Run',         description: 'Sell a stock for 25%+ profit' },
  DIAMOND_HANDS:   { name: 'Diamond Hands',    description: 'Hold through a 30% dip and recover to profit' },
  COLD_BLOODED:    { name: 'Cold Blooded',     description: 'Profit from closing a short position' },
  BROKE_100K:      { name: 'Six Figures',      description: 'Reach $100,000 portfolio value' },
  BROKE_250K:      { name: 'Market Shark',     description: 'Reach $250,000 portfolio value' },
  BROKE_500K:      { name: 'Untouchable',      description: 'Reach $500,000 portfolio value' },
  BROKE_1M:        { name: 'First Million',    description: 'Reach $1,000,000 portfolio value' },
  ORACLE:          { name: 'Oracle',           description: 'Win 3 prediction bets' },
  PROPHET:         { name: 'Prophet',          description: 'Win 10 prediction bets' },
  TOP_10:          { name: 'Contender',        description: 'Reach the top 10 on the leaderboard' },
  TOP_3:           { name: 'Elite',            description: 'Reach the top 3 on the leaderboard' },
  TOP_1:           { name: 'Champion',         description: 'Reach #1 on the leaderboard' },
  CASINO_CHAMPION: { name: 'Casino Champion',  description: 'Place 1st on the Ladder Game leaderboard' },
  DEDICATED_30:    { name: 'Devoted',          description: 'Check in 30 days total' },
  DEDICATED_100:   { name: 'Legendary',        description: 'Check in 100 days total' },
  MISSION_50:      { name: 'Mission Master',   description: 'Complete 50 daily missions' },
  MISSION_100:     { name: 'Mission Legend',   description: 'Complete 100 daily missions' },
};

exports.achievementAlert = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { achievementId } = data;

  const noteworthy = NOTEWORTHY_ACHIEVEMENTS[achievementId];
  if (!noteworthy) {
    return { success: true, alerted: false };
  }

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

  const embed = {
    title: '🏆 Achievement Unlocked',
    description: `A trader just earned **${noteworthy.name}**`,
    color: 0xFFD700,
    fields: [{ name: 'Description', value: noteworthy.description, inline: false }],
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
exports.createPriceAlert = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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
exports.deletePriceAlert = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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
exports.checkPriceAlerts = cf().pubsub
  .schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) return null;
      const prices = marketSnap.data().prices || {};

      // Collection-group query reads only the untriggered alert docs
      // themselves, instead of scanning every user doc plus one subcollection
      // query per user on every run.
      const alertsSnap = await db.collectionGroup('priceAlerts')
        .where('triggered', '==', false)
        .get();
      let triggered = 0;

      for (const alertDoc of alertsSnap.docs) {
        const alert = alertDoc.data();
        const currentPrice = prices[alert.ticker];
        if (!currentPrice) continue;

        let shouldTrigger = false;
        if (alert.direction === 'above' && currentPrice >= alert.targetPrice) shouldTrigger = true;
        if (alert.direction === 'below' && currentPrice <= alert.targetPrice) shouldTrigger = true;

        if (shouldTrigger) {
          const uid = alertDoc.ref.parent.parent.id;
          await alertDoc.ref.update({ triggered: true });
          await writeNotification(uid, {
            type: 'alert',
            title: `Price Alert: $${alert.ticker}`,
            message: `$${alert.ticker} is now $${currentPrice.toFixed(2)} (${alert.direction === 'above' ? 'above' : 'below'} your target of $${alert.targetPrice.toFixed(2)})`,
            data: { ticker: alert.ticker, price: currentPrice }
          });
          triggered++;
        }
      }

      console.log(`Price alert check: ${triggered} alerts triggered`);
      return { triggered };
    } catch (err) {
      console.error('Price alert check failed:', err);
      return null;
    }
  });
