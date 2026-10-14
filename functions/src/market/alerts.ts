import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { CHARACTERS } from '../shared/characters';
import {
  isWeeklyTradingHalt,
  TWENTY_FOUR_HOURS_MS,
  SITE_URL,
  PRICE_ALERT_CHECK_SCHEDULE,
  PRICE_ALERT_LOOKBACK_MS,
  MAX_ACTIVE_PRICE_ALERTS,
  PRICE_MOVE_ALERT_PERCENT,
  PRICE_MOVE_ALERT_COOLDOWN_MS,
} from '../shared/constants';
import { sendDiscordMessage, sendDiscordDM } from '../shared/discordApi';
import { writeNotification } from '../shared/notifications';
import { priceHistoryRef } from '../shared/marketData';
import { recordHeartbeat } from '../shared/activity';
import { reportError } from '../shared/sentry';
import type { PricePoint } from '../shared/types';

// ─── Discord Alert Triggers ──────────────────────────────────────────────────

/**
 * IPO Announcement - Called when a new IPO is created
 */
export const ipoAnnouncementAlert = cf().https.onCall(async (data, context) => {
  // Only the admin panel creates IPOs, so only the admin may announce one —
  // otherwise any user could post fake official announcements through the bot.
  requireAdmin(context, 'Admin only.');

  const { ticker, characterName, ipoPrice, postIpoPrice, startsAt, endsAt, totalShares, maxPerUser } = data;
  const startsImmediately = !startsAt || startsAt <= Date.now() + 60000;

  const embed = {
    color: 0x00d4ff,
    title: '🚀 NEW IPO ANNOUNCED!',
    description: `**${characterName}** ($${ticker}) is going public!`,
    fields: [
      { name: 'IPO Price', value: `$${ipoPrice.toFixed(2)}`, inline: true },
      { name: 'Post-IPO Price', value: `$${postIpoPrice.toFixed(2)} (+15%)`, inline: true },
      {
        name: 'Shares Available',
        value: `${totalShares || 150} total (max ${maxPerUser || 10}/person)`,
        inline: false,
      },
      {
        name: startsImmediately ? 'IPO Ends' : 'IPO Opens',
        value: startsImmediately ? `<t:${Math.floor(endsAt / 1000)}:R>` : `<t:${Math.floor(startsAt / 1000)}:R>`,
        inline: false,
      },
    ],
    footer: {
      text: startsImmediately
        ? 'IPO is LIVE now - first come, first served!'
        : 'IPO window coming soon - Get in early!',
    },
    timestamp: new Date().toISOString(),
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true };
});

/**
 * Price Threshold Alert - Runs every 6 hours
 * Alerts when stocks cross significant 24h thresholds (3%, 5%, 10%)
 */
export const priceThresholdAlert = cf()
  .pubsub.schedule('0 */6 * * *')
  .timeZone('UTC')
  .onRun(async (_context) => {
    if (isWeeklyTradingHalt()) {
      logger.info('Skipping price threshold alerts — weekly trading halt active');
      return null;
    }

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();
      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data()!;
      if (marketData.marketHalted) {
        logger.info('Skipping price threshold alerts — emergency halt active');
        return null;
      }

      const prices: Record<string, number> = marketData.prices || {};
      const histSnap = await priceHistoryRef().get();
      const priceHistory: Record<string, PricePoint[]> = histSnap.exists ? histSnap.data() || {} : {};
      const alertedThresholds = marketData.alertedThresholds || {};

      const now = Date.now();
      const dayAgo = now - TWENTY_FOUR_HOURS_MS;
      const newAlerts: { ticker: string; price: number; price24hAgo: number; change: number; alertKey: string }[] = [];
      const updatedAlertedThresholds = { ...alertedThresholds };

      for (const [ticker, currentPrice] of Object.entries(prices)) {
        // The price a day ago. The live chart keeps only its last 60 points,
        // which on a busy stock can cover less than a day, so this used to
        // fall back to the oldest live point and call a few hours "24 hours".
        // Older points are in the archive. A stock with no point that old
        // (just launched) has no 24h change to report.
        let price24hAgo = priceAtOrBefore(priceHistory[ticker], dayAgo);
        if (price24hAgo === null) {
          const archive = await db.collection('market').doc('current').collection('price_history').doc(ticker).get();
          price24hAgo = priceAtOrBefore(archive.data()?.history, dayAgo);
        }
        if (!price24hAgo || price24hAgo <= 0) continue;

        const change = ((currentPrice - price24hAgo) / price24hAgo) * 100;
        const alertKey = `${ticker}_10_${change > 0 ? 'up' : 'down'}`;
        const lastAlerted = alertedThresholds[alertKey] || 0;

        if (Math.abs(change) >= PRICE_MOVE_ALERT_PERCENT && now - lastAlerted > PRICE_MOVE_ALERT_COOLDOWN_MS) {
          newAlerts.push({ ticker, price: currentPrice, price24hAgo, change, alertKey });
          updatedAlertedThresholds[alertKey] = now;
        }
      }

      if (newAlerts.length === 0) {
        await recordHeartbeat('priceThresholdAlert');
        return null;
      }

      await marketRef.update({ alertedThresholds: updatedAlertedThresholds });

      for (const alert of newAlerts) {
        const emoji = alert.change > 0 ? '🚀' : '💥';
        const direction = alert.change > 0 ? 'surged' : 'crashed';
        const embed = {
          title: `${emoji} Major Price Movement`,
          description: `**${alert.ticker}** has ${direction} ${Math.abs(alert.change).toFixed(1)}% in 24 hours`,
          color: alert.change > 0 ? 0x00ff00 : 0xff0000,
          fields: [
            { name: 'Current Price', value: `$${alert.price.toFixed(2)}`, inline: true },
            { name: '24h Ago', value: `$${alert.price24hAgo.toFixed(2)}`, inline: true },
            { name: 'Change', value: `${alert.change > 0 ? '+' : ''}${alert.change.toFixed(1)}%`, inline: true },
          ],
          timestamp: new Date().toISOString(),
        };
        await sendDiscordMessage(null, [embed]);
      }

      await recordHeartbeat('priceThresholdAlert');
      return null;
    } catch (error) {
      reportError(error, { where: 'priceThresholdAlert' });
      return null;
    }
  });

/** Price of the last point at or before `ts` in an ascending history, or null. */
function priceAtOrBefore(history: PricePoint[] | null | undefined, ts: number): number | null {
  if (!Array.isArray(history)) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const p = history[i]!;
    if (p.timestamp <= ts) return p.price;
  }
  return null;
}

/**
 * Achievement Alert - Called when someone unlocks an achievement
 */
// Server-side copy of the announceable achievements (subset of
// src/constants/achievements.ts). The embed text comes from here, never from
// the client — otherwise any caller could post arbitrary text through the bot.
const NOTEWORTHY_ACHIEVEMENTS = {
  SHARK: { name: 'Shark', description: 'Execute a single trade worth $1,000+' },
  BULL_RUN: { name: 'Bull Run', description: 'Sell a stock for 25%+ profit' },
  DIAMOND_HANDS: { name: 'Diamond Hands', description: 'Hold through a 30% dip and recover to profit' },
  COLD_BLOODED: { name: 'Cold Blooded', description: 'Profit from closing a short position' },
  BROKE_100K: { name: 'Six Figures', description: 'Reach $100,000 portfolio value' },
  BROKE_250K: { name: 'Market Shark', description: 'Reach $250,000 portfolio value' },
  BROKE_500K: { name: 'Untouchable', description: 'Reach $500,000 portfolio value' },
  BROKE_1M: { name: 'First Million', description: 'Reach $1,000,000 portfolio value' },
  ORACLE: { name: 'Oracle', description: 'Win 3 prediction bets' },
  PROPHET: { name: 'Prophet', description: 'Win 10 prediction bets' },
  TOP_10: { name: 'Contender', description: 'Reach the top 10 on the leaderboard' },
  TOP_3: { name: 'Elite', description: 'Reach the top 3 on the leaderboard' },
  TOP_1: { name: 'Champion', description: 'Reach #1 on the leaderboard' },
  CASINO_CHAMPION: { name: 'Casino Champion', description: 'Place 1st on the Ladder Game leaderboard' },
  DEDICATED_30: { name: 'Devoted', description: 'Check in 30 days total' },
  DEDICATED_100: { name: 'Legendary', description: 'Check in 100 days total' },
  MISSION_50: { name: 'Mission Master', description: 'Complete 50 daily missions' },
  MISSION_100: { name: 'Mission Legend', description: 'Complete 100 daily missions' },
};

export const achievementAlert = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { achievementId } = data;

  const noteworthy = NOTEWORTHY_ACHIEVEMENTS[achievementId as keyof typeof NOTEWORTHY_ACHIEVEMENTS];
  if (!noteworthy) {
    return { success: true, alerted: false };
  }

  // Once per player per achievement. Owning it used to be the only check, so
  // anyone holding one could call this in a loop and flood the public channel.
  // achievementsAnnounced is server-only (not on the user-doc rules allowlist).
  const userRef = db.collection('users').doc(context.auth.uid);
  let shouldAnnounce = false;
  try {
    shouldAnnounce = await db.runTransaction(async (tx) => {
      const userDoc = await tx.get(userRef);
      if (!userDoc.exists) return false;
      const userData = userDoc.data()!;
      if (!(userData.achievements || []).includes(achievementId)) {
        logger.info(`Achievement alert rejected: ${context.auth!.uid} doesn't have ${achievementId}`);
        return false;
      }
      if ((userData.achievementsAnnounced || []).includes(achievementId)) return false;
      tx.update(userRef, { achievementsAnnounced: FieldValue.arrayUnion(achievementId) });
      return true;
    });
  } catch (e) {
    logger.error('Achievement validation failed:', e);
    return { success: true, alerted: false };
  }
  if (!shouldAnnounce) return { success: true, alerted: false };

  const embed = {
    title: '🏆 Achievement Unlocked',
    description: `A trader just earned **${noteworthy.name}**`,
    color: 0xffd700,
    fields: [{ name: 'Description', value: noteworthy.description, inline: false }],
    timestamp: new Date().toISOString(),
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true, alerted: true };
});

// ─── Price Alerts (user-configured) ──────────────────────────────────────────

/**
 * Create a price alert for a ticker
 * Max 10 active alerts per user
 */
export const createPriceAlert = cf().https.onCall(async (data, context) => {
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

  const character = CHARACTERS.find((c) => c.ticker === ticker);
  if (!character) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown ticker.');
  }

  const alertsSnap = await db
    .collection('users')
    .doc(uid)
    .collection('priceAlerts')
    .where('triggered', '==', false)
    .get();

  if (alertsSnap.size >= MAX_ACTIVE_PRICE_ALERTS) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      `Maximum ${MAX_ACTIVE_PRICE_ALERTS} active price alerts.`,
    );
  }

  const alertRef = await db.collection('users').doc(uid).collection('priceAlerts').add({
    ticker,
    targetPrice,
    direction,
    triggered: false,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, alertId: alertRef.id };
});

/**
 * Delete a price alert
 */
export const deletePriceAlert = cf().https.onCall(async (data, context) => {
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
 * Check price alerts every few minutes. An alert fires if the price touched its
 * target at any point since the last check, not only if it is there right now:
 * at a 30-minute check on the current price alone, a spike that came back down
 * in between was missed. Players with Discord linked also get a DM.
 */
export const checkPriceAlerts = cf()
  .pubsub.schedule(PRICE_ALERT_CHECK_SCHEDULE)
  .timeZone('UTC')
  .onRun(async () => {
    try {
      // Collection-group query reads only the untriggered alert docs
      // themselves, instead of scanning every user doc plus one subcollection
      // query per user on every run.
      const alertsSnap = await db.collectionGroup('priceAlerts').where('triggered', '==', false).get();
      if (alertsSnap.empty) {
        await recordHeartbeat('checkPriceAlerts');
        return { triggered: 0 };
      }

      const [marketSnap, histSnap] = await Promise.all([
        db.collection('market').doc('current').get(),
        priceHistoryRef().get(),
      ]);
      if (!marketSnap.exists) return null;
      const prices: Record<string, number> = marketSnap.data()!.prices || {};
      const history: Record<string, PricePoint[]> = histSnap.exists ? histSnap.data() || {} : {};
      const now = Date.now();
      let triggered = 0;

      for (const alertDoc of alertsSnap.docs) {
        const alert = alertDoc.data();
        const currentPrice = prices[alert.ticker];
        if (!currentPrice) continue;

        // Every price since the window opened (or the alert was set, if later),
        // plus the price right now.
        const createdAt = alert.createdAt?.toMillis?.() ?? 0;
        const since = Math.max(createdAt, now - PRICE_ALERT_LOOKBACK_MS);
        const seen = (history[alert.ticker] || []).filter((p) => p.timestamp >= since).map((p) => p.price);
        seen.push(currentPrice);
        const hitPrice = alert.direction === 'above' ? Math.max(...seen) : Math.min(...seen);
        const hit = alert.direction === 'above' ? hitPrice >= alert.targetPrice : hitPrice <= alert.targetPrice;
        if (!hit) continue;

        const uid = alertDoc.ref.parent.parent!.id;
        await alertDoc.ref.update({ triggered: true, triggeredAt: now, triggeredPrice: hitPrice });
        const side = alert.direction === 'above' ? 'above' : 'below';
        const touched =
          hitPrice === currentPrice
            ? `$${alert.ticker} is now $${currentPrice.toFixed(2)}`
            : `$${alert.ticker} hit $${hitPrice.toFixed(2)} and is now $${currentPrice.toFixed(2)}`;
        const message = `${touched} (${side} your target of $${alert.targetPrice.toFixed(2)})`;
        await writeNotification(uid, {
          type: 'alert',
          title: `Price Alert: $${alert.ticker}`,
          message,
          data: { ticker: alert.ticker, price: currentPrice },
        });
        try {
          const userSnap = await db.getAll(db.collection('users').doc(uid), { fieldMask: ['discordId'] });
          const discordId = userSnap[0]?.data()?.discordId;
          if (discordId) await sendDiscordDM(discordId, `Price alert: ${message}. ${SITE_URL}/stock/${alert.ticker}`);
        } catch (e) {
          reportError(e, { where: 'checkPriceAlerts.dm', uid });
        }
        triggered++;
      }

      if (triggered) logger.info(`Price alert check: ${triggered} alerts triggered`);
      await recordHeartbeat('checkPriceAlerts');
      return { triggered };
    } catch (err) {
      reportError(err, { where: 'checkPriceAlerts' });
      return null;
    }
  });
