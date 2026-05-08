'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { ADMIN_UID } = require('../constants');
const { sendDiscordMessage } = require('../helpers');

/**
 * Admin function to ban a user and rollback fraudulent gains
 * @param {string} userId - User ID to ban
 * @param {number} rollbackCash - Cash amount to reset to (default: 1000)
 * @param {string} reason - Reason for ban
 */
exports.banUser = functions.https.onCall(async (data, context) => {
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
      costBasis: {},
      portfolioValue: rollbackCash,
      portfolioHistory: [{ timestamp: Date.now(), value: rollbackCash }],
      marginUsed: 0,
      isBanned: true,
      bannedAt: admin.firestore.FieldValue.serverTimestamp(),
      banReason: reason
    });

    // Log to console
    console.log(`USER BANNED: ${displayName} (${userId}) - Reason: ${reason}`);

    // Send Discord alert
    try {
      await sendDiscordMessage(`🔨 **User Banned**\nUsername: ${displayName}\nReason: ${reason}\nRolled back from $${(userData.cash || 0).toFixed(2)} to $${rollbackCash}`);
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
 * Automated Backup System
 * Runs every 12 hours to backup critical market data
 */
exports.backupMarketData = functions.pubsub
  .schedule('every 12 hours')
  .onRun(async (context) => {
    try {
      const bucket = admin.storage().bucket();
      const timestamp = new Date().toISOString();
      const dateStr = timestamp.split('T')[0]; // YYYY-MM-DD
      const timeStr = timestamp.split('T')[1].split('.')[0].replace(/:/g, '-'); // HH-MM-SS

      console.log(`Starting backup at ${timestamp}`);

      // 1. Backup market data
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (marketSnap.exists) {
        const marketData = marketSnap.data();
        const marketBackup = {
          timestamp,
          prices: marketData.prices || {},
          priceHistory: marketData.priceHistory || {},
          liquidity: marketData.liquidity || {},
          metadata: {
            backupDate: timestamp,
            totalTickers: Object.keys(marketData.prices || {}).length
          }
        };

        const marketFile = bucket.file(`backups/market/${dateStr}_${timeStr}_market.json`);
        await marketFile.save(JSON.stringify(marketBackup, null, 2), {
          contentType: 'application/json',
          metadata: {
            backupType: 'market',
            timestamp
          }
        });
        console.log('Market data backed up successfully');
      }

      // 2. Backup top 100 user portfolios (leaderboard)
      const usersSnap = await db.collection('users')
        .where('isBot', '==', false)
        .orderBy('portfolioValue', 'desc')
        .limit(100)
        .get();

      const userBackups = [];
      usersSnap.forEach(doc => {
        const data = doc.data();
        userBackups.push({
          uid: doc.id,
          displayName: data.displayName,
          portfolioValue: data.portfolioValue || 0,
          cash: data.cash || 0,
          holdings: data.holdings || {},
          shorts: data.shorts || {},
          costBasis: data.costBasis || {},
          totalTrades: data.totalTrades || 0,
          crew: data.crew || null
        });
      });

      const leaderboardBackup = {
        timestamp,
        topUsers: userBackups,
        metadata: {
          backupDate: timestamp,
          userCount: userBackups.length
        }
      };

      const leaderboardFile = bucket.file(`backups/users/${dateStr}_${timeStr}_leaderboard.json`);
      await leaderboardFile.save(JSON.stringify(leaderboardBackup, null, 2), {
        contentType: 'application/json',
        metadata: {
          backupType: 'leaderboard',
          timestamp
        }
      });
      console.log('Leaderboard backed up successfully');

      // 3. Cleanup old backups (keep last 7 days)
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [marketFiles] = await bucket.getFiles({ prefix: 'backups/market/' });
      const [userFiles] = await bucket.getFiles({ prefix: 'backups/users/' });

      let deletedCount = 0;
      for (const file of [...marketFiles, ...userFiles]) {
        const [metadata] = await file.getMetadata();
        const fileDate = new Date(metadata.timeCreated);

        if (fileDate < sevenDaysAgo) {
          await file.delete();
          deletedCount++;
          console.log(`Deleted old backup: ${file.name}`);
        }
      }

      console.log(`Backup complete. Deleted ${deletedCount} old backups.`);
      return null;
    } catch (error) {
      console.error('Error in backup:', error);
      return null;
    }
  });

/**
 * Manual Backup - Admin can trigger this from Admin Panel
 */
exports.triggerManualBackup = functions.https.onCall(async (data, context) => {
  // Check admin permission
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can trigger manual backups.'
    );
  }

  try {
    const bucket = admin.storage().bucket();
    const timestamp = new Date().toISOString();
    const dateStr = timestamp.split('T')[0];
    const timeStr = timestamp.split('T')[1].split('.')[0].replace(/:/g, '-');

    // Backup market data
    const marketRef = db.collection('market').doc('current');
    const marketSnap = await marketRef.get();

    if (!marketSnap.exists) {
      throw new Error('Market data not found');
    }

    const marketData = marketSnap.data();
    const marketBackup = {
      timestamp,
      manual: true,
      prices: marketData.prices || {},
      priceHistory: marketData.priceHistory || {},
      liquidity: marketData.liquidity || {},
      metadata: {
        backupDate: timestamp,
        totalTickers: Object.keys(marketData.prices || {}).length,
        triggeredBy: context.auth.uid
      }
    };

    const marketFile = bucket.file(`backups/manual/${dateStr}_${timeStr}_manual_market.json`);
    await marketFile.save(JSON.stringify(marketBackup, null, 2), {
      contentType: 'application/json',
      metadata: {
        backupType: 'manual_market',
        timestamp,
        triggeredBy: context.auth.uid
      }
    });

    return {
      success: true,
      message: 'Manual backup created successfully',
      timestamp,
      filename: `${dateStr}_${timeStr}_manual_market.json`
    };
  } catch (error) {
    console.error('Error in manual backup:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to create manual backup: ' + error.message
    );
  }
});

/**
 * List Available Backups - Admin can see all available backups
 */
exports.listBackups = functions.https.onCall(async (data, context) => {
  // Check admin permission
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can list backups.'
    );
  }

  try {
    const bucket = admin.storage().bucket();
    const [marketFiles] = await bucket.getFiles({ prefix: 'backups/market/' });
    const [userFiles] = await bucket.getFiles({ prefix: 'backups/users/' });
    const [manualFiles] = await bucket.getFiles({ prefix: 'backups/manual/' });

    const backups = [];

    for (const file of [...marketFiles, ...userFiles, ...manualFiles]) {
      const [metadata] = await file.getMetadata();
      backups.push({
        name: file.name,
        size: metadata.size,
        created: metadata.timeCreated,
        type: metadata.metadata?.backupType || 'unknown'
      });
    }

    // Sort by date (newest first)
    backups.sort((a, b) => new Date(b.created) - new Date(a.created));

    return {
      success: true,
      backups,
      total: backups.length
    };
  } catch (error) {
    console.error('Error listing backups:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to list backups: ' + error.message
    );
  }
});

exports.restoreBackup = functions.https.onCall(async (data, context) => {
  // Check admin permission
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can restore backups.'
    );
  }

  const { backupName } = data;

  if (!backupName) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Backup name is required'
    );
  }

  try {
    const bucket = admin.storage().bucket();
    const file = bucket.file(backupName);

    console.log(`Restoring backup: ${backupName}`);

    // Download backup
    const [content] = await file.download();
    const backupData = JSON.parse(content.toString());

    console.log(`Backup loaded. Contains ${Object.keys(backupData.priceHistory || {}).length} tickers`);

    // Restore price history to Firestore (keep current prices)
    const marketRef = db.collection('market').doc('current');

    await marketRef.update({
      priceHistory: backupData.priceHistory
    });

    console.log('✅ Price history restored successfully!');

    return {
      success: true,
      message: 'Price history restored successfully',
      tickersRestored: Object.keys(backupData.priceHistory || {}).length,
      backupFile: backupName
    };
  } catch (error) {
    console.error('Error restoring backup:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to restore backup: ' + error.message
    );
  }
});

/**
 * Fix Base Price Cliffs - Removes first data point if >2% jump to second
 * Admin only - fixes chart artifacts from data loss
 */
exports.fixBasePriceCliffs = functions.https.onCall(async (data, context) => {
  // Check admin permission
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can fix price cliffs.'
    );
  }

  try {
    const marketRef = db.collection('market').doc('current');
    const marketDoc = await marketRef.get();

    if (!marketDoc.exists) {
      throw new Error('Market document not found');
    }

    const data = marketDoc.data();
    const priceHistory = data.priceHistory || {};

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
        updates[`priceHistory.${ticker}`] = history.slice(1);
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
    await marketRef.update(updates);

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

/**
 * Monthly Permanent Backup
 * Runs at midnight UTC on the 1st of every month
 * Keeps one permanent snapshot per month for historical records
 */
exports.monthlyPermanentBackup = functions.pubsub
  .schedule('0 0 1 * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const bucket = admin.storage().bucket();
      const now = new Date();
      const timestamp = now.toISOString();

      // Format: YYYY-MM (e.g., 2026-01)
      const yearMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;

      console.log(`Starting monthly permanent backup for ${yearMonth}`);

      // Backup market data
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (marketSnap.exists) {
        const marketData = marketSnap.data();
        const marketBackup = {
          timestamp,
          yearMonth,
          permanent: true,
          prices: marketData.prices || {},
          priceHistory: marketData.priceHistory || {},
          liquidity: marketData.liquidity || {},
          metadata: {
            backupDate: timestamp,
            backupType: 'monthly_permanent',
            totalTickers: Object.keys(marketData.prices || {}).length,
            totalTrades: marketData.totalTrades || 0
          }
        };

        const marketFile = bucket.file(`backups/monthly/${yearMonth}_market.json`);
        await marketFile.save(JSON.stringify(marketBackup, null, 2), {
          contentType: 'application/json',
          metadata: {
            backupType: 'monthly_permanent',
            yearMonth,
            timestamp
          }
        });
        console.log(`Monthly market backup saved: ${yearMonth}_market.json`);
      }

      // Backup leaderboard (top 100 users)
      const usersSnap = await db.collection('users')
        .where('isBot', '==', false)
        .orderBy('portfolioValue', 'desc')
        .limit(100)
        .get();

      const userBackups = [];
      usersSnap.forEach(doc => {
        const data = doc.data();
        userBackups.push({
          uid: doc.id,
          displayName: data.displayName,
          portfolioValue: data.portfolioValue || 0,
          cash: data.cash || 0,
          holdings: data.holdings || {},
          shorts: data.shorts || {},
          costBasis: data.costBasis || {},
          totalTrades: data.totalTrades || 0,
          crew: data.crew || null
        });
      });

      const leaderboardBackup = {
        timestamp,
        yearMonth,
        permanent: true,
        topUsers: userBackups,
        metadata: {
          backupDate: timestamp,
          backupType: 'monthly_permanent',
          userCount: userBackups.length
        }
      };

      const leaderboardFile = bucket.file(`backups/monthly/${yearMonth}_leaderboard.json`);
      await leaderboardFile.save(JSON.stringify(leaderboardBackup, null, 2), {
        contentType: 'application/json',
        metadata: {
          backupType: 'monthly_permanent',
          yearMonth,
          timestamp
        }
      });
      console.log(`Monthly leaderboard backup saved: ${yearMonth}_leaderboard.json`);

      console.log(`Monthly permanent backup complete for ${yearMonth}`);
      return null;
    } catch (error) {
      console.error('Error in monthly permanent backup:', error);
      return null;
    }
  });

// ============================================
