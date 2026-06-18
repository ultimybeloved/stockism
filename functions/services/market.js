'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { ADMIN_UID, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MAX_DAILY_IMPACT, MAX_PRICE_CHANGE_PERCENT, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS } = require('../constants');
const { writeNotification, writeFeedEntry, sendDiscordMessage, sendMarketStatusAlert, calculateMarginalImpact, pruneAndSumTradeHistory } = require('../helpers');


exports.dailyMarketSummary = cf().pubsub
  .schedule('0 21 * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.log('No market data found');
        return null;
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};

      // Get all users for stats
      const usersSnap = await db.collection('users').get();
      const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate 24h changes
      const now = Date.now();
      const dayAgo = now - (24 * 60 * 60 * 1000);
      const gainers = [];
      const losers = [];
      const athStocks = [];

      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        // Find price 24h ago
        let price24hAgo = history[0].price;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= dayAgo) {
            price24hAgo = history[i].price;
            break;
          }
        }

        const change = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
        const stock = { ticker, price: currentPrice, change };

        if (change > 0) gainers.push(stock);
        if (change < 0) losers.push(stock);

        // Check for ATH
        const highestHistorical = Math.max(...history.map(h => h.price));
        if (currentPrice >= highestHistorical) {
          athStocks.push(ticker);
        }
      });

      gainers.sort((a, b) => b.change - a.change);
      losers.sort((a, b) => a.change - b.change);

      // Calculate trading volume (from transaction logs)
      let totalVolume = 0;
      let tradeCount = 0;
      const traderActivity = {};

      users.forEach(user => {
        const txLog = user.transactionLog || [];
        txLog.forEach(tx => {
          if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.timestamp > dayAgo) {
            totalVolume += tx.totalCost || tx.totalRevenue || 0;
            tradeCount++;
            traderActivity[user.id] = (traderActivity[user.id] || 0) + 1;
          }
        });
      });

      const topTraders = Object.entries(traderActivity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      // Build Discord embed
      const embed = {
        title: '📊 Daily Market Summary',
        description: `Market close - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
        color: 0xFF6B35,
        fields: [
          {
            name: '📈 Market Activity',
            value: `${tradeCount} trades • $${totalVolume.toFixed(2)} volume`,
            inline: false
          },
          {
            name: '🔥 Top Gainers (24h)',
            value: gainers.slice(0, 3).map(s =>
              `**${s.ticker}** $${s.price.toFixed(2)} (+${s.change.toFixed(1)}%)`
            ).join('\n') || 'None',
            inline: true
          },
          {
            name: '📉 Top Losers (24h)',
            value: losers.slice(0, 3).map(s =>
              `**${s.ticker}** $${s.price.toFixed(2)} (${s.change.toFixed(1)}%)`
            ).join('\n') || 'None',
            inline: true
          }
        ],
        timestamp: new Date().toISOString()
      };

      if (athStocks.length > 0) {
        embed.fields.push({
          name: '🎯 New All-Time Highs',
          value: athStocks.slice(0, 5).join(', '),
          inline: false
        });
      }

      if (topTraders.length > 0) {
        embed.fields.push({
          name: '⚡ Most Active Traders',
          value: topTraders.map(([, count], i) => `#${i + 1}: ${count} trades`).join('\n'),
          inline: false
        });
      }

      embed.fields.push({
        name: '💰 Market Stats',
        value: `Total Cash: $${Math.round(users.reduce((sum, u) => sum + (u.cash || 0), 0)).toLocaleString()}\nActive Traders: ${users.length}`,
        inline: false
      });

      await sendDiscordMessage(null, [embed]);
      return null;
    } catch (error) {
      console.error('Error in dailyMarketSummary:', error);
      return null;
    }
  });

/**
 * Save pre-halt prices snapshot every Thursday at 12:55 UTC (5 min before halt)
 */
exports.savePreHaltPrices = cf().pubsub
  .schedule('55 12 * * 4')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) {
        console.log('No market data found for pre-halt snapshot');
        return null;
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};

      await db.collection('market').doc('preHaltSnapshot').set({
        prices,
        savedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`Pre-halt snapshot saved with ${Object.keys(prices).length} tickers`);
      return null;
    } catch (error) {
      console.error('Error saving pre-halt snapshot:', error);
      return null;
    }
  });

/**
 * Chapter review recap - posts Discord alert every Thursday at 21:05 UTC
 * Compares pre-halt prices to current prices after admin adjustments
 */
exports.chapterReviewRecap = cf().pubsub
  .schedule('30 20 * * 4')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      // Read pre-halt snapshot
      const snapshotRef = db.collection('market').doc('preHaltSnapshot');
      const snapshotSnap = await snapshotRef.get();

      if (!snapshotSnap.exists) {
        console.warn('No pre-halt snapshot found, skipping chapter review recap');
        return null;
      }

      const beforePrices = snapshotSnap.data().prices || {};

      // Read current prices
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) {
        console.error('No current market data found');
        return null;
      }

      const afterPrices = marketSnap.data().prices || {};

      // Build ETF ticker set from CHARACTERS
      const etfTickers = new Set(CHARACTERS.filter(c => c.isETF).map(c => c.ticker));

      // Compute changes per ticker (stocks split into gainers/losers, ETFs tracked separately)
      const gainers = [];
      const losers = [];
      const etfMovements = [];
      let unchangedCount = 0;

      for (const [ticker, afterPrice] of Object.entries(afterPrices)) {
        const beforePrice = beforePrices[ticker];
        if (beforePrice == null) continue;

        const pctChange = beforePrice > 0
          ? ((afterPrice - beforePrice) / beforePrice) * 100
          : 0;

        if (etfTickers.has(ticker)) {
          if (Math.abs(pctChange) >= 0.01) {
            etfMovements.push({ ticker, before: beforePrice, after: afterPrice, change: pctChange });
          }
          continue;
        }

        if (Math.abs(pctChange) < 0.01) {
          unchangedCount++;
        } else if (pctChange > 0) {
          gainers.push({ ticker, before: beforePrice, after: afterPrice, change: pctChange });
        } else {
          losers.push({ ticker, before: beforePrice, after: afterPrice, change: pctChange });
        }
      }

      gainers.sort((a, b) => b.change - a.change);
      losers.sort((a, b) => a.change - b.change);

      // Compute SMI before and after
      const nonETFChars = CHARACTERS.filter(c => !c.isETF);
      const computeSMI = (prices) => {
        let sum = 0;
        let count = 0;
        for (const char of nonETFChars) {
          const base = char.basePrice;
          if (base <= 0) continue;
          const price = prices[char.ticker];
          sum += (price != null ? price : base) / base;
          count++;
        }
        return count > 0 ? 1000 * (sum / count) : 1000;
      };

      const smiBefore = computeSMI(beforePrices);
      const smiAfter = computeSMI(afterPrices);
      const smiChange = smiBefore > 0
        ? ((smiAfter - smiBefore) / smiBefore) * 100
        : 0;

      // Build Discord embed
      const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });

      const formatLine = (s) =>
        `**${s.ticker}**  $${s.before.toFixed(2)} → $${s.after.toFixed(2)}  (${s.change > 0 ? '+' : ''}${s.change.toFixed(1)}%)`;

      const fields = [];

      if (gainers.length > 0) {
        fields.push({
          name: '📈 Price Increases',
          value: gainers.slice(0, 10).map(formatLine).join('\n'),
          inline: false
        });
      }

      if (losers.length > 0) {
        fields.push({
          name: '📉 Price Decreases',
          value: losers.slice(0, 10).map(formatLine).join('\n'),
          inline: false
        });
      }

      if (gainers.length === 0 && losers.length === 0) {
        fields.push({
          name: '➖ No Changes',
          value: 'No price adjustments were made this week.',
          inline: false
        });
      } else if (unchangedCount > 0) {
        fields.push({
          name: '➖ Unchanged',
          value: `${unchangedCount} stock${unchangedCount !== 1 ? 's' : ''}`,
          inline: false
        });
      }

      if (etfMovements.length > 0) {
        fields.push({
          name: '🧺 ETF Movements',
          value: etfMovements
            .sort((a, b) => b.change - a.change)
            .slice(0, 15)
            .map(formatLine)
            .join('\n'),
          inline: false
        });
      }

      const smiSign = smiChange >= 0 ? '+' : '';
      fields.push({
        name: '📊 Stockism Market Index',
        value: `${Math.round(smiBefore).toLocaleString()} → ${Math.round(smiAfter).toLocaleString()} (${smiSign}${smiChange.toFixed(1)}%)`,
        inline: false
      });

      const embed = {
        title: '📖 Chapter Review Recap',
        description: dateStr,
        color: 0x9B59B6,
        fields,
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);

      // Cleanup snapshot
      await snapshotRef.delete();
      console.log(`Chapter review recap sent: ${gainers.length} gainers, ${losers.length} losers, ${unchangedCount} unchanged`);

      return null;
    } catch (error) {
      console.error('Error in chapterReviewRecap:', error);
      return null;
    }
  });

/**
 * Fill pending stop loss orders at market open after chapter review.
 * Also runs the opening auction for pre-market orders placed during 20:30-21:00 UTC.
 * Runs at exactly 21:00 UTC Thursday — same moment the halt ends.
 */

/**
 * Manual trigger for daily market summary (admin only)
 */
exports.triggerDailyMarketSummary = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  // Admin check
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  try {
    const marketRef = db.collection('market').doc('current');
    const marketSnap = await marketRef.get();

    if (!marketSnap.exists) {
      return { success: false, error: 'No market data found' };
    }

    const marketData = marketSnap.data();
    const prices = marketData.prices || {};
    const priceHistory = marketData.priceHistory || {};

    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const gainers = [];
    const losers = [];
    const athStocks = [];

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
      const stock = { ticker, price: currentPrice, change };

      if (change > 0) gainers.push(stock);
      if (change < 0) losers.push(stock);

      const highestHistorical = Math.max(...history.map(h => h.price));
      if (currentPrice >= highestHistorical) {
        athStocks.push(ticker);
      }
    });

    gainers.sort((a, b) => b.change - a.change);
    losers.sort((a, b) => a.change - b.change);

    let totalVolume = 0;
    let tradeCount = 0;
    const traderActivity = {};

    users.forEach(user => {
      const txLog = user.transactionLog || [];
      txLog.forEach(tx => {
        if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.timestamp > dayAgo) {
          totalVolume += tx.totalCost || tx.totalRevenue || 0;
          tradeCount++;
          traderActivity[user.id] = (traderActivity[user.id] || 0) + 1;
        }
      });
    });

    const topTraders = Object.entries(traderActivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const embed = {
      title: '📊 Daily Market Summary',
      description: `Market close - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
      color: 0xFF6B35,
      fields: [
        {
          name: '📈 Market Activity',
          value: `${tradeCount} trades • $${totalVolume.toFixed(2)} volume`,
          inline: false
        },
        {
          name: '🔥 Top Gainers (24h)',
          value: gainers.slice(0, 3).map(s =>
            `**${s.ticker}** $${s.price.toFixed(2)} (+${s.change.toFixed(1)}%)`
          ).join('\n') || 'None',
          inline: true
        },
        {
          name: '📉 Top Losers (24h)',
          value: losers.slice(0, 3).map(s =>
            `**${s.ticker}** $${s.price.toFixed(2)} (${s.change.toFixed(1)}%)`
          ).join('\n') || 'None',
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    if (athStocks.length > 0) {
      embed.fields.push({
        name: '🎯 New All-Time Highs',
        value: athStocks.slice(0, 5).join(', '),
        inline: false
      });
    }

    if (topTraders.length > 0) {
      embed.fields.push({
        name: '⚡ Most Active Traders',
        value: topTraders.map((_, i) => `#${i + 1}: ${topTraders[i][1]} trades`).join('\n'),
        inline: false
      });
    }

    embed.fields.push({
      name: '💰 Market Stats',
      value: `Total Cash: $${users.reduce((sum, u) => sum + (u.cash || 0), 0).toLocaleString()}\nActive Traders: ${users.length}`,
      inline: false
    });

    await sendDiscordMessage(null, [embed]);
    return { success: true };
  } catch (error) {
    console.error('Error in triggerDailyMarketSummary:', error);
    return { success: false, error: error.message };
  }
});

/**
 * Weekly Market Summary - Runs Mondays at 00:00 UTC
 */

// ============================================
// MARKET STATUS ALERTS (Discord)
// ============================================

// Weekly halt begins — Thursday 13:00 UTC
exports.marketClosedAlert = cf().pubsub
  .schedule('0 13 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    await sendMarketStatusAlert('closed');
    return null;
  });

// Pre-market queue opens — Thursday 20:30 UTC
exports.preMarketOpenAlert = cf().pubsub
  .schedule('30 20 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    await sendMarketStatusAlert('premarket');
    return null;
  });

// Trading resumes — Thursday 21:00 UTC
exports.marketOpenAlert = cf().pubsub
  .schedule('0 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    await sendMarketStatusAlert('open');
    return null;
  });

/**
 * Admin: manually halt or resume the market. Sets the flag and announces it on Discord.
 */
exports.setMarketHalt = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Only admin can halt the market.');
  }

  const halted = !!data.halted;
  const reason = typeof data.reason === 'string' ? data.reason.trim() : '';

  if (halted && !reason) {
    throw new functions.https.HttpsError('invalid-argument', 'A halt reason is required.');
  }

  await db.collection('market').doc('current').update({
    marketHalted: halted,
    haltReason: halted ? reason : '',
    haltedAt: halted ? Date.now() : null,
    haltedBy: halted ? context.auth.uid : null
  });

  try {
    await sendMarketStatusAlert(halted ? 'halted' : 'resumed', reason);
  } catch (err) {
    console.error('Failed to send market status alert:', err);
  }

  return { success: true, halted };
});