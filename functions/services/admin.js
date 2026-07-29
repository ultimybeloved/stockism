'use strict';
// Direct admin actions on players and the market: bans, price-cliff repair,
// and bot creation. The backup/restore tooling is in adminBackups.js.

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { ADMIN_UID } = require('../constants');
const { sendDiscordMessage, priceHistoryRef } = require('../helpers');

/**
 * Cancel every open order a banned user left on the books.
 *
 * The ban itself wipes holdings and resets cash, so a surviving order is either
 * selling shares that no longer exist or spending the rollback cash. The fill
 * paths reject banned users now, but leaving the orders PENDING means the sweep
 * re-reads and re-cancels them every cycle and the player still sees them as
 * live in their order list. Clear them at ban time instead.
 *
 * @param {string} userId - Banned user's ID
 * @returns {Promise<{limit: number, preMarket: number}>} counts cancelled
 */
const cancelOpenOrders = async (userId) => {
  const counts = { limit: 0, preMarket: 0 };
  const stamp = admin.firestore.FieldValue.serverTimestamp();

  const [limitSnap, preMarketSnap] = await Promise.all([
    db.collection('limitOrders')
      .where('userId', '==', userId)
      .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
      .get(),
    db.collection('preMarketOrders')
      .where('userId', '==', userId)
      .where('status', '==', 'PENDING')
      .get()
  ]);

  if (limitSnap.empty && preMarketSnap.empty) return counts;

  const batch = db.batch();
  limitSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp });
    counts.limit++;
  });
  preMarketSnap.docs.forEach((doc) => {
    batch.update(doc.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp });
    counts.preMarket++;
  });
  await batch.commit();

  return counts;
};

/**
 * Admin function to ban a user and rollback fraudulent gains
 * @param {string} userId - User ID to ban
 * @param {number} rollbackCash - Cash amount to reset to (default: 1000)
 * @param {string} reason - Reason for ban
 */
exports.banUser = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  // Verify admin
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can ban users.'
    );
  }

  const { userId, rollbackCash = 1000, reason } = data;

  if (!userId) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'User ID is required.'
    );
  }

  try {
    const userRef = db.collection('users').doc(userId);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found.');
    }

    const userData = userDoc.data();
    const displayName = userData.displayName;

    // Create ban record
    await db.collection('banned_users').doc(userId).set({
      uid: userId,
      displayName,
      bannedAt: admin.firestore.FieldValue.serverTimestamp(),
      bannedBy: context.auth.uid,
      reason,
      originalCash: userData.cash,
      originalPortfolio: userData.portfolioValue,
      rollbackCash
    });

    // Reset user to starting state
    await userRef.update({
      cash: rollbackCash,
      holdings: {},
      shorts: {},
      hasOpenShorts: false,
      costBasis: {},
      // Clear the share locks along with the shares they referred to — a lock left
      // pointing at destroyed shares blocks selling anything rebought on that
      // ticker if the account is ever reinstated (reinstateUser only adds cash).
      marginLockup: {},
      ipoLockup: {},
      portfolioValue: rollbackCash,
      lastPortfolioSnapshot: { timestamp: Date.now(), value: rollbackCash },
      marginUsed: 0,
      isBanned: true,
      bannedAt: admin.firestore.FieldValue.serverTimestamp(),
      banReason: reason
    });

    // Record the rollback in the permanent history subcollection
    await userRef.collection('portfolioHistory').add({ timestamp: Date.now(), value: rollbackCash });

    // Pull their open orders off the books — the wipe above just destroyed the
    // shares and cash those orders were written against.
    let cancelled = { limit: 0, preMarket: 0 };
    try {
      cancelled = await cancelOpenOrders(userId);
    } catch (err) {
      // The ban itself already committed; a failure here is recoverable (the
      // fill paths reject banned users) so don't fail the whole call.
      console.error('Failed to cancel open orders for banned user:', err);
    }

    // Log to console
    console.log(`USER BANNED: ${displayName} (${userId}) - Reason: ${reason} - cancelled ${cancelled.limit} limit / ${cancelled.preMarket} pre-market orders`);

    // Send Discord alert
    try {
      const orderNote = (cancelled.limit + cancelled.preMarket) > 0
        ? `\nCancelled ${cancelled.limit} limit / ${cancelled.preMarket} pre-market orders`
        : '';
      await sendDiscordMessage(`🔨 **User Banned**\nUsername: ${displayName}\nReason: ${reason}\nRolled back from $${(userData.cash || 0).toFixed(2)} to $${rollbackCash}${orderNote}`);
    } catch (err) {
      console.error('Failed to send Discord alert:', err);
    }

    return {
      success: true,
      message: `User ${displayName} has been banned and reset to $${rollbackCash}`,
      previousCash: userData.cash,
      previousPortfolio: userData.portfolioValue
    };

  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Ban user error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to ban user: ' + error.message
    );
  }
});


/**
 * Fix Base Price Cliffs - Removes first data point if >2% jump to second
 * Admin only - fixes chart artifacts from data loss
 */
exports.fixBasePriceCliffs = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  // Check admin permission
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can fix price cliffs.'
    );
  }

  try {
    const histRef = priceHistoryRef();
    const histDoc = await histRef.get();

    if (!histDoc.exists) {
      throw new Error('Price history document not found');
    }

    const priceHistory = histDoc.data() || {};

    let tickersFixed = 0;
    let tickersSkipped = 0;
    const updates = {};
    const fixedTickers = [];

    for (const [ticker, history] of Object.entries(priceHistory)) {
      if (!history || history.length < 2) {
        tickersSkipped++;
        continue;
      }

      const firstPrice = history[0].price;
      const secondPrice = history[1].price;
      const percentChange = firstPrice > 0 ? ((secondPrice - firstPrice) / firstPrice) * 100 : 0;

      if (Math.abs(percentChange) > 2) {
        fixedTickers.push({
          ticker,
          firstPrice,
          secondPrice,
          percentChange: percentChange.toFixed(2),
          firstTimestamp: new Date(history[0].timestamp).toISOString()
        });

        // Remove the first element
        updates[ticker] = history.slice(1);
        tickersFixed++;
      } else {
        tickersSkipped++;
      }
    }

    if (tickersFixed === 0) {
      return {
        success: true,
        tickersFixed: 0,
        tickersSkipped,
        message: 'No cliffs found - all data looks good!'
      };
    }

    // Apply updates
    await histRef.update(updates);

    return {
      success: true,
      tickersFixed,
      tickersSkipped,
      fixed: fixedTickers,
      message: `Fixed ${tickersFixed} tickers with base price cliffs`
    };
  } catch (error) {
    console.error('Error fixing base price cliffs:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to fix price cliffs: ' + error.message
    );
  }
});


exports.createBots = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  // Verify admin
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can create bots.'
    );
  }

  const BOT_PROFILES = [
    { name: 'Momentum Mike', personality: 'momentum', cash: 2500 },
    { name: 'Contrarian Carl', personality: 'contrarian', cash: 3000 },
    { name: 'Diamond Dave', personality: 'hodler', cash: 2000 },
    { name: 'Day Trader Dan', personality: 'daytrader', cash: 4000 },
    { name: 'Gambler Greg', personality: 'random', cash: 1500 },
    { name: 'Big Deal Billy', personality: 'crew_loyal', cash: 2500, crew: 'BIG_DEAL' },
    { name: 'Swing Trader Sam', personality: 'swing', cash: 3500 },
    { name: 'FOMO Frank', personality: 'momentum', cash: 2000 },
    { name: 'Bargain Betty', personality: 'contrarian', cash: 3000 },
    { name: 'Long Term Larry', personality: 'hodler', cash: 5000 },
    { name: 'Scalper Steve', personality: 'daytrader', cash: 3500 },
    { name: 'Lucky Lucy', personality: 'random', cash: 2500 },
    { name: 'Hostel Harry', personality: 'crew_loyal', cash: 3000, crew: 'HOSTEL' },
    { name: 'Pattern Pete', personality: 'swing', cash: 2500 },
    { name: 'Panic Paul', personality: 'panic', cash: 2000 },
    { name: 'Value Vince', personality: 'contrarian', cash: 4000 },
    { name: 'Buy High Brian', personality: 'random', cash: 1500 },
    { name: 'Workers Wendy', personality: 'crew_loyal', cash: 3500, crew: 'WORKERS' },
    { name: 'Trend Tom', personality: 'momentum', cash: 3000 },
    { name: 'Diversified Donna', personality: 'balanced', cash: 4500 },
    // Market Follower Bots - amplify market trends
    { name: 'Amplifier Amy', personality: 'market_follower', cash: 3000 },
    { name: 'Wave Rider Will', personality: 'market_follower', cash: 2500 },
    { name: 'Trend Booster Bo', personality: 'market_follower', cash: 3500 },
    { name: 'Market Mover Max', personality: 'market_follower', cash: 4000 },
    { name: 'Momentum Amplifier Mia', personality: 'market_follower', cash: 2000 },
    { name: 'Surge Sarah', personality: 'market_follower', cash: 3500 },
    { name: 'Flow Follower Fred', personality: 'market_follower', cash: 2500 },
    { name: 'Velocity Vicky', personality: 'market_follower', cash: 3000 }
  ];

  let created = 0;
  let skipped = 0;

  try {
    for (const profile of BOT_PROFILES) {
      const botId = `bot_${profile.name.toLowerCase().replace(/\s+/g, '_')}`;
      const userRef = db.collection('users').doc(botId);

      // Check if bot already exists
      const botSnap = await userRef.get();
      if (botSnap.exists) {
        skipped++;
        continue;
      }

      // Create bot user
      await userRef.set({
        displayName: profile.name,
        displayNameLower: profile.name.toLowerCase(),
        isBot: true,
        botPersonality: profile.personality,
        botCrew: profile.crew || null,
        cash: profile.cash,
        portfolioValue: profile.cash,
        holdings: {},
        shorts: {},
        costBasis: {},
        bets: {},
        marginUsed: 0,
        totalTrades: 0,
        totalCheckins: 0,
        peakPortfolioValue: profile.cash,
        crew: null,
        dailyMissions: {},
        transactionLog: [],
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastActive: Date.now()
      });

      created++;
    }

    return {
      success: true,
      created,
      skipped,
      message: `Created ${created} bots! ${skipped > 0 ? `(${skipped} already existed)` : ''}`
    };
  } catch (error) {
    console.error('Error creating bots:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to create bots: ' + error.message
    );
  }
});

// Export bot trader
