const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// Import bot trader
const { botTrader } = require('./botTrader');

// Import content generation
const contentGen = require('./contentGeneration');

// Constants
const STARTING_CASH = 1000;
// Admin UID from environment variable (set in functions/.env)
// Falls back to hardcoded value for backwards compatibility
const ADMIN_UID = process.env.ADMIN_UID || '4usiVxPmHLhmitEKH2HfCpbx4Yi1';

// Banned usernames (impersonation prevention)
const BANNED_NAMES = [
  'admin', 'administrator', 'mod', 'moderator', 'support', 'staff',
  'official', 'system', 'root', 'owner', 'founder', 'manager',
  'stockism', 'darthyg', 'darth_yg', 'darth', 'null', 'undefined'
];

// Profanity filter
const PROFANITY_LIST = [
  // Profanity
  'fuck', 'shit', 'ass', 'bitch', 'damn', 'cunt', 'dick', 'cock', 'pussy', 'bastard',
  'whore', 'slut', 'piss', 'crap', 'fag', 'retard', 'nigger', 'nigga', 'chink',
  // Variations/leetspeak
  'f4ck', 'fuk', 'fck', 'sh1t', 'b1tch', 'azz', 'a55', 'd1ck', 'c0ck', 'cnt',
  'fag0t', 'r3tard', 'n1gger', 'n1gga',
  // Slurs
  'kike', 'spic', 'beaner', 'wetback', 'gook', 'towelhead', 'sandnigger',
  // Sexual/inappropriate
  'sex', 'porn', 'xxx', 'rape', 'molest', 'pedo', 'anal', 'vagina', 'penis',
  'testicle', 'semen', 'cumshot', 'jizz', 'blowjob', 'handjob',
  // Hate/offensive
  'nazi', 'hitler', 'kill', 'murder', 'terrorist', 'jihad', 'isis',
  // Common substitutions
  'fvck', 'phuck', 'biatch', 'bytch', 'azhole', 'assh0le'
];

/**
 * Normalize text for profanity detection (remove special chars, numbers that look like letters)
 * @param {string} text - Text to normalize
 * @returns {string} - Normalized text
 */
function normalizeProfanity(text) {
  return text.toLowerCase()
    .replace(/0/g, 'o')
    .replace(/1/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5/g, 's')
    .replace(/7/g, 't')
    .replace(/8/g, 'b')
    .replace(/\$/g, 's')
    .replace(/@/g, 'a')
    .replace(/!/g, 'i')
    .replace(/\+/g, 't')
    .replace(/[^a-z]/g, '');
}

/**
 * Checks if text contains profanity
 * @param {string} text - Text to check
 * @returns {boolean} - True if profanity detected
 */
function containsProfanity(text) {
  if (!text) return false;

  const normalized = normalizeProfanity(text);
  const lower = text.toLowerCase();

  for (const word of PROFANITY_LIST) {
    // Exact match (whole word)
    const wordBoundaryRegex = new RegExp(`\\b${word}\\b`, 'i');
    if (wordBoundaryRegex.test(lower) || wordBoundaryRegex.test(normalized)) {
      return true;
    }

    // Substring match for shorter words (3+ chars)
    if (word.length >= 3 && (lower.includes(word) || normalized.includes(word))) {
      return true;
    }
  }

  return false;
}

/**
 * Checks if a username is banned (handles leetspeak variations).
 * @param {string} username - Lowercase username to check
 * @returns {boolean} - True if banned
 */
function isBannedUsername(username) {
  // Normalize leetspeak and variations
  const normalized = username
    .replace(/[0]/g, 'o')
    .replace(/[1]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/_/g, '');

  // Check exact matches
  if (BANNED_NAMES.includes(username) || BANNED_NAMES.includes(normalized)) {
    return true;
  }

  // Check if it contains banned terms
  for (const banned of BANNED_NAMES) {
    if (username.includes(banned) || normalized.includes(banned)) {
      return true;
    }
  }

  return false;
}

/**
 * Creates a new user with case-insensitive unique username.
 *
 * Atomically:
 * 1. Checks if lowercase username is available
 * 2. Reserves the username in usernames collection
 * 3. Creates the user document
 *
 * @param {string} displayName - The desired display name (1-20 chars, alphanumeric + underscore)
 * @returns {Object} - { success: true } or throws error
 */
exports.createUser = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in to create a user profile.'
    );
  }

  const uid = context.auth.uid;
  const displayName = data.displayName;

  // Validate displayName
  if (!displayName || typeof displayName !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Display name is required.'
    );
  }

  const trimmed = displayName.trim();

  if (trimmed.length < 3) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username must be at least 3 characters.'
    );
  }

  if (trimmed.length > 20) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username must be 20 characters or less.'
    );
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username can only contain letters, numbers, and underscores.'
    );
  }

  const displayNameLower = trimmed.toLowerCase();

  // Check if username is banned
  if (isBannedUsername(displayNameLower)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'This username is not allowed.'
    );
  }

  // Check for profanity
  if (containsProfanity(trimmed)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username contains inappropriate language. Please choose a different name.'
    );
  }

  // Use a transaction to atomically check and create
  try {
    await db.runTransaction(async (transaction) => {
      const usernameRef = db.collection('usernames').doc(displayNameLower);
      const userRef = db.collection('users').doc(uid);

      // Check if username is already taken (including deleted usernames)
      const usernameDoc = await transaction.get(usernameRef);
      if (usernameDoc.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'This username is already taken.'
        );
      }

      // Check if user already has a profile
      const userDoc = await transaction.get(userRef);
      if (userDoc.exists) {
        throw new functions.https.HttpsError(
          'already-exists',
          'User profile already exists.'
        );
      }

      const now = admin.firestore.FieldValue.serverTimestamp();

      // Reserve the username
      transaction.set(usernameRef, {
        uid: uid,
        createdAt: now
      });

      // Create the user document
      transaction.set(userRef, {
        displayName: trimmed,
        displayNameLower: displayNameLower,
        cash: STARTING_CASH,
        holdings: {},
        portfolioValue: STARTING_CASH,
        portfolioHistory: [{ timestamp: Date.now(), value: STARTING_CASH }],
        lastCheckin: null,
        createdAt: now,
        achievements: [],
        totalCheckins: 0,
        totalTrades: 0,
        peakPortfolioValue: STARTING_CASH,
        predictionWins: 0,
        costBasis: {},
        lendingUnlocked: false,
        isBankrupt: false
      });
    });

    return { success: true };
  } catch (error) {
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    // Wrap other errors
    console.error('Error creating user:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to create user profile. Please try again.'
    );
  }
});

/**
 * Migrates existing users to the usernames collection.
 * Admin-only function to be run once after deployment.
 *
 * @returns {Object} - { migrated: number, conflicts: Array, errors: Array }
 */
exports.migrateUsernames = functions.https.onCall(async (data, context) => {
  // Verify admin
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError(
      'permission-denied',
      'Only admin can run migrations.'
    );
  }

  const results = {
    migrated: 0,
    conflicts: [],
    errors: []
  };

  try {
    // Get all users
    const usersSnapshot = await db.collection('users').get();

    // Track lowercase names to detect conflicts
    const seenNames = new Map(); // lowercase -> { uid, displayName }

    // First pass: detect conflicts
    usersSnapshot.forEach((doc) => {
      const userData = doc.data();
      const displayName = userData.displayName;

      if (!displayName) {
        results.errors.push({
          uid: doc.id,
          error: 'No displayName found'
        });
        return;
      }

      const lower = displayName.toLowerCase();

      if (seenNames.has(lower)) {
        // Conflict detected
        const existing = seenNames.get(lower);
        results.conflicts.push({
          username: lower,
          users: [
            { uid: existing.uid, displayName: existing.displayName },
            { uid: doc.id, displayName: displayName }
          ]
        });
      } else {
        seenNames.set(lower, { uid: doc.id, displayName });
      }
    });

    // If there are conflicts, don't migrate - return conflicts for manual resolution
    if (results.conflicts.length > 0) {
      return {
        ...results,
        message: 'Conflicts detected. Please resolve manually before migrating.',
        migrated: 0
      };
    }

    // Second pass: migrate non-conflicting usernames
    const batch = db.batch();
    let batchCount = 0;
    const MAX_BATCH_SIZE = 500;

    for (const [lower, { uid, displayName }] of seenNames) {
      const usernameRef = db.collection('usernames').doc(lower);
      const userRef = db.collection('users').doc(uid);

      batch.set(usernameRef, {
        uid: uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

      // Also update user doc with displayNameLower for consistency
      batch.update(userRef, {
        displayNameLower: lower
      });

      batchCount++;
      results.migrated++;

      // Commit batch if at limit
      if (batchCount >= MAX_BATCH_SIZE) {
        await batch.commit();
        batchCount = 0;
      }
    }

    // Commit remaining
    if (batchCount > 0) {
      await batch.commit();
    }

    return {
      ...results,
      message: `Successfully migrated ${results.migrated} usernames.`
    };
  } catch (error) {
    console.error('Migration error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Migration failed: ' + error.message
    );
  }
});

/**
 * Check if a username is available (case-insensitive).
 * Public function for real-time availability checking.
 *
 * @param {string} displayName - The username to check
 * @returns {Object} - { available: boolean }
 */
exports.checkUsername = functions.https.onCall(async (data, context) => {
  const displayName = data.displayName;

  if (!displayName || typeof displayName !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Display name is required.'
    );
  }

  const trimmed = displayName.trim();

  if (trimmed.length < 3 || trimmed.length > 20) {
    return { available: false, reason: 'Invalid length' };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(trimmed)) {
    return { available: false, reason: 'Invalid characters' };
  }

  const lower = trimmed.toLowerCase();

  // Check if username is banned
  if (isBannedUsername(lower)) {
    return { available: false, reason: 'Username not allowed' };
  }

  const usernameDoc = await db.collection('usernames').doc(lower).get();

  // Username is taken if the document exists (even if marked as deleted)
  return {
    available: !usernameDoc.exists,
    reason: usernameDoc.exists ? 'Username taken' : null
  };
});

/**
 * Deletes a user account and all associated data.
 *
 * Atomically:
 * 1. Deletes the user document from users collection
 * 2. Marks the username as deleted (keeps it reserved to prevent reuse)
 * 3. Deletes the Firebase Auth account
 *
 * @param {string} confirmUsername - Must match the user's display name to confirm deletion
 * @returns {Object} - { success: true } or throws error
 */
exports.deleteAccount = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in to delete your account.'
    );
  }

  const uid = context.auth.uid;
  const confirmUsername = data.confirmUsername;

  // Validate confirmation username is provided
  if (!confirmUsername || typeof confirmUsername !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Username confirmation is required.'
    );
  }

  try {
    // Get user document to verify username match
    const userRef = db.collection('users').doc(uid);
    const userDoc = await userRef.get();

    if (!userDoc.exists) {
      throw new functions.https.HttpsError(
        'not-found',
        'User profile not found.'
      );
    }

    const userData = userDoc.data();
    const displayName = userData.displayName;
    const displayNameLower = userData.displayNameLower;

    // Verify the confirmation username matches (case-insensitive)
    if (confirmUsername.toLowerCase() !== displayName.toLowerCase()) {
      throw new functions.https.HttpsError(
        'invalid-argument',
        'Username confirmation does not match.'
      );
    }

    // Use a batch to atomically delete both documents
    const batch = db.batch();

    // Delete user document
    batch.delete(userRef);

    // Mark username as deleted (but keep reserved) if it exists
    if (displayNameLower) {
      const usernameRef = db.collection('usernames').doc(displayNameLower);
      batch.set(usernameRef, {
        deleted: true,
        deletedAt: admin.firestore.FieldValue.serverTimestamp(),
        deletedUid: uid
      }, { merge: true });
    }

    // Commit the batch
    await batch.commit();

    // Delete the Firebase Auth account
    await admin.auth().deleteUser(uid);

    return { success: true };
  } catch (error) {
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    // Wrap other errors
    console.error('Error deleting account:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to delete account. Please try again.'
    );
  }
});

// ============================================
// DISCORD INTEGRATIONS
// ============================================

/**
 * Helper function to send messages to Discord
 */
async function sendDiscordMessage(content, embeds = null) {
  const config = functions.config();
  const botToken = config.discord?.bot_token;
  const channelId = config.discord?.channel_id;

  if (!botToken || !channelId) {
    console.error('Discord config missing');
    return;
  }

  try {
    const payload = { content };
    if (embeds) {
      payload.embeds = embeds;
    }

    await axios.post(
      `https://discord.com/api/v10/channels/${channelId}/messages`,
      payload,
      {
        headers: {
          'Authorization': `Bot ${botToken}`,
          'Content-Type': 'application/json'
        }
      }
    );
    console.log('Discord message sent successfully');
  } catch (error) {
    console.error('Error sending Discord message:', error.response?.data || error.message);
  }
}

/**
 * Daily Market Summary - Runs at 4 PM EST (9 PM UTC) - NYSE close
 */
exports.dailyMarketSummary = functions.pubsub
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

        const change = ((currentPrice - price24hAgo) / price24hAgo) * 100;
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
          value: topTraders.map((_, i) => `#${i + 1}: ${topTraders[i][1]} trades`).join('\n'),
          inline: false
        });
      }

      embed.fields.push({
        name: '💰 Market Stats',
        value: `Total Cash: $${(marketData.totalCashInSystem || 0).toLocaleString()}\nActive Traders: ${users.length}`,
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
 * Manual trigger for daily market summary (admin only)
 */
exports.triggerDailyMarketSummary = functions.https.onCall(async (data, context) => {
  // Admin check
  if (!context.auth || !ADMIN_UIDS.includes(context.auth.uid)) {
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

      const change = ((currentPrice - price24hAgo) / price24hAgo) * 100;
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
      value: `Total Cash: $${(marketData.totalCashInSystem || 0).toLocaleString()}\nActive Traders: ${users.length}`,
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
 * Weekly Market Summary - Runs Sundays at 7 PM EST (Monday midnight UTC)
 */
exports.weeklyMarketSummary = functions.pubsub
  .schedule('0 0 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};

      // Get all users
      const usersSnap = await db.collection('users').get();
      const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate weekly stats
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

      // Weekly price changes
      const weeklyChanges = [];
      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        let priceWeekAgo = history[0].price;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= weekAgo) {
            priceWeekAgo = history[i].price;
            break;
          }
        }

        const change = ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100;
        weeklyChanges.push({ ticker, price: currentPrice, change, priceWeekAgo });
      });

      weeklyChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      const topGainer = weeklyChanges.find(s => s.change > 0);
      const topLoser = weeklyChanges.find(s => s.change < 0);

      // Weekly volume
      let weeklyVolume = 0;
      let weeklyTrades = 0;
      users.forEach(user => {
        const txLog = user.transactionLog || [];
        txLog.forEach(tx => {
          if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.timestamp > weekAgo) {
            weeklyVolume += tx.totalCost || tx.totalRevenue || 0;
            weeklyTrades++;
          }
        });
      });

      // Top portfolios
      const topPortfolios = users
        .filter(u => u.portfolioValue > 0)
        .sort((a, b) => b.portfolioValue - a.portfolioValue)
        .slice(0, 5);

      // Build comprehensive embed
      const embed = {
        title: '📈 Weekly Market Report',
        description: `Week ending ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        color: 0x4ECDC4,
        fields: [
          {
            name: '📊 Weekly Activity',
            value: `${weeklyTrades} trades\n$${weeklyVolume.toLocaleString(undefined, {maximumFractionDigits: 0})} total volume\n${users.length} active traders`,
            inline: false
          },
          {
            name: '🚀 Biggest Mover (Up)',
            value: topGainer ? `**${topGainer.ticker}**\n$${topGainer.priceWeekAgo.toFixed(2)} → $${topGainer.price.toFixed(2)}\n+${topGainer.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '📉 Biggest Mover (Down)',
            value: topLoser ? `**${topLoser.ticker}**\n$${topLoser.priceWeekAgo.toFixed(2)} → $${topLoser.price.toFixed(2)}\n${topLoser.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '🏆 Top 5 Portfolios',
            value: topPortfolios.map((u, i) =>
              `${i + 1}. ${u.displayName || 'Anonymous'} - $${u.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`
            ).join('\n') || 'None',
            inline: false
          }
        ],
        footer: {
          text: 'Next report: Next Sunday 7 PM EST'
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      return null;
    } catch (error) {
      console.error('Error in weeklyMarketSummary:', error);
      return null;
    }
  });

/**
 * Big Trade Alert - Triggered when large trades occur
 * Called from client after trade execution
 */
exports.bigTradeAlert = functions.https.onCall(async (data, context) => {
  // Require authentication to prevent spam
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, shares, price, totalValue, type } = data;

  // Only alert for:
  // - 50+ shares of $35+ stocks
  // - 100+ shares of any price
  if ((shares >= 50 && price >= 35) || shares >= 100) {
    const embed = {
      title: '🚨 Large Trade Detected',
      description: `A significant ${type.toLowerCase()} order was executed`,
      color: type === 'BUY' ? 0x44FF44 : 0xFF4444,
      fields: [
        {
          name: 'Stock',
          value: `**${ticker}**`,
          inline: true
        },
        {
          name: 'Shares',
          value: shares.toLocaleString(),
          inline: true
        },
        {
          name: 'Price',
          value: `$${price.toFixed(2)}`,
          inline: true
        },
        {
          name: 'Total Value',
          value: `$${totalValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`,
          inline: false
        }
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
  // Require authentication to prevent spam
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { crewName, memberCount } = data;

  // Alert for milestones: 5, 10, 25, 50, 100
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
  // Require authentication to prevent spam
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { question, winningOption, totalBets, totalPayout, winners } = data;

  const embed = {
    title: '🔮 Prediction Resolved',
    description: `**${question}**`,
    color: 0x9B59B6,
    fields: [
      {
        name: 'Winning Outcome',
        value: `✅ ${winningOption}`,
        inline: false
      },
      {
        name: 'Total Bets',
        value: totalBets.toString(),
        inline: true
      },
      {
        name: 'Winners',
        value: winners.toString(),
        inline: true
      },
      {
        name: 'Total Payout',
        value: `$${totalPayout.toLocaleString(undefined, {maximumFractionDigits: 2})}`,
        inline: true
      }
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
  // Require authentication to prevent spam
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, price, previousHigh } = data;

  const embed = {
    title: '🎯 New All-Time High!',
    description: `**${ticker}** just hit a new record`,
    color: 0xFF6B35,
    fields: [
      {
        name: 'New High',
        value: `$${price.toFixed(2)}`,
        inline: true
      },
      {
        name: 'Previous High',
        value: `$${previousHigh.toFixed(2)}`,
        inline: true
      },
      {
        name: 'Gain',
        value: `+${(((price - previousHigh) / previousHigh) * 100).toFixed(1)}%`,
        inline: true
      }
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
  // Require authentication to prevent spam
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
 * Hourly Market Movers - Runs every 2 hours
 * Shows top gainers and losers over the past few hours
 */
exports.hourlyMovers = functions.pubsub
  .schedule('0 */2 * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};

      const now = Date.now();
      const hoursAgo = now - (2 * 60 * 60 * 1000); // 2 hours

      const movers = [];

      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        // Find price 2 hours ago
        let priceAtStart = currentPrice;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= hoursAgo) {
            priceAtStart = history[i].price;
            break;
          }
        }

        const change = ((currentPrice - priceAtStart) / priceAtStart) * 100;
        if (Math.abs(change) >= 0.5) { // Only include if moved 0.5%+
          movers.push({ ticker, price: currentPrice, change, priceAtStart });
        }
      });

      if (movers.length === 0) return null; // No significant movement

      movers.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      const gainers = movers.filter(m => m.change > 0).slice(0, 3);
      const losers = movers.filter(m => m.change < 0).slice(0, 3);

      if (gainers.length === 0 && losers.length === 0) return null;

      const embed = {
        title: '📊 Market Update',
        description: `Movement over the last 2 hours`,
        color: 0x3498DB,
        fields: [],
        timestamp: new Date().toISOString()
      };

      if (gainers.length > 0) {
        embed.fields.push({
          name: '📈 Rising',
          value: gainers.map(s => `**${s.ticker}** $${s.price.toFixed(2)} (+${s.change.toFixed(1)}%)`).join('\n'),
          inline: true
        });
      }

      if (losers.length > 0) {
        embed.fields.push({
          name: '📉 Falling',
          value: losers.map(s => `**${s.ticker}** $${s.price.toFixed(2)} (${s.change.toFixed(1)}%)`).join('\n'),
          inline: true
        });
      }

      await sendDiscordMessage(null, [embed]);
      return null;
    } catch (error) {
      console.error('Error in hourlyMovers:', error);
      return null;
    }
  });

/**
 * Price Threshold Alert - Runs every 30 minutes
 * Alerts when stocks cross significant 24h thresholds (3%, 5%, 10%)
 */
exports.priceThresholdAlert = functions.pubsub
  .schedule('*/30 * * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};
      const alertedThresholds = marketData.alertedThresholds || {}; // Track what we've already alerted

      const now = Date.now();
      const dayAgo = now - (24 * 60 * 60 * 1000);
      const thresholds = [3, 5, 10]; // Alert at these % changes

      const newAlerts = [];
      const updatedAlertedThresholds = { ...alertedThresholds };

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

        const change = ((currentPrice - price24hAgo) / price24hAgo) * 100;
        const absChange = Math.abs(change);

        // Check each threshold
        thresholds.forEach(threshold => {
          const alertKey = `${ticker}_${threshold}_${change > 0 ? 'up' : 'down'}`;
          const lastAlerted = alertedThresholds[alertKey] || 0;
          const hoursSinceAlert = (now - lastAlerted) / (60 * 60 * 1000);

          // Alert if crossed threshold and hasn't been alerted in 12 hours
          if (absChange >= threshold && hoursSinceAlert > 12) {
            newAlerts.push({
              ticker,
              price: currentPrice,
              price24hAgo,
              change,
              threshold,
              alertKey
            });
            updatedAlertedThresholds[alertKey] = now;
          }
        });
      });

      if (newAlerts.length === 0) return null;

      // Save updated alert tracking
      await marketRef.update({ alertedThresholds: updatedAlertedThresholds });

      // Group alerts by threshold for cleaner messaging
      const majorAlerts = newAlerts.filter(a => a.threshold >= 5);
      const minorAlerts = newAlerts.filter(a => a.threshold < 5);

      // Send major alerts individually (5%+ moves are significant)
      for (const alert of majorAlerts) {
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

      // Batch minor alerts (3% moves)
      if (minorAlerts.length > 0) {
        const gainers = minorAlerts.filter(a => a.change > 0);
        const losers = minorAlerts.filter(a => a.change < 0);

        const embed = {
          title: '📊 24h Price Alerts',
          color: 0xFFA500,
          fields: [],
          timestamp: new Date().toISOString()
        };

        if (gainers.length > 0) {
          embed.fields.push({
            name: '📈 Up 3%+',
            value: gainers.map(a => `**${a.ticker}** +${a.change.toFixed(1)}%`).join('\n'),
            inline: true
          });
        }

        if (losers.length > 0) {
          embed.fields.push({
            name: '📉 Down 3%+',
            value: losers.map(a => `**${a.ticker}** ${a.change.toFixed(1)}%`).join('\n'),
            inline: true
          });
        }

        await sendDiscordMessage(null, [embed]);
      }

      return null;
    } catch (error) {
      console.error('Error in priceThresholdAlert:', error);
      return null;
    }
  });

/**
 * Trade Spike Alert - Called when a single trade moves price significantly (1%+)
 */
exports.tradeSpikeAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, priceBefore, priceAfter, tradeType, shares } = data;

  const change = ((priceAfter - priceBefore) / priceBefore) * 100;
  const absChange = Math.abs(change);

  // Only alert for 1%+ single-trade moves
  if (absChange < 1) return { success: true, alerted: false };

  const emoji = change > 0 ? '⚡' : '💨';
  const direction = change > 0 ? 'spiked' : 'dropped';
  const tradeAction = tradeType === 'BUY' ? 'buy' : 'sell';

  const embed = {
    title: `${emoji} Price Spike`,
    description: `**${ticker}** just ${direction} ${absChange.toFixed(1)}% from a single ${tradeAction}`,
    color: change > 0 ? 0x00FF00 : 0xFF4444,
    fields: [
      { name: 'Before', value: `$${priceBefore.toFixed(2)}`, inline: true },
      { name: 'After', value: `$${priceAfter.toFixed(2)}`, inline: true },
      { name: 'Impact', value: `${change > 0 ? '+' : ''}${change.toFixed(2)}%`, inline: true }
    ],
    timestamp: new Date().toISOString()
  };

  await sendDiscordMessage(null, [embed]);
  return { success: true, alerted: true };
});

/**
 * Achievement Alert - Called when someone unlocks an achievement
 */
exports.achievementAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { achievementId, achievementName, achievementDescription } = data;

  // List of "exciting" achievements worth announcing (skip basic ones)
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
    fields: [
      { name: 'Description', value: achievementDescription, inline: false }
    ],
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

/**
 * Create bot traders - Admin only
 */
exports.createBots = functions.https.onCall(async (data, context) => {
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
exports.botTrader = botTrader;

// ============================================
// TRADE VALIDATION & ANTI-EXPLOIT
// ============================================

/**
 * Validates a trade request before execution
 * Enforces server-side cooldown, validates cash/holdings
 * Returns validation result + computed trade parameters
 */
exports.validateTrade = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in to trade.'
    );
  }

  const uid = context.auth.uid;
  const { ticker, action, amount } = data;

  // Validate inputs
  if (!ticker || !action || !amount || amount <= 0) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid trade parameters.'
    );
  }

  if (!['buy', 'sell', 'short', 'cover'].includes(action)) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid trade action.'
    );
  }

  try {
    const userRef = db.collection('users').doc(uid);
    const marketRef = db.collection('market').doc('current');

    const [userDoc, marketDoc] = await Promise.all([
      userRef.get(),
      marketRef.get()
    ]);

    if (!userDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found.');
    }

    if (!marketDoc.exists) {
      throw new functions.https.HttpsError('not-found', 'Market data not found.');
    }

    const userData = userDoc.data();
    const marketData = marketDoc.data();
    const prices = marketData.prices || {};
    const currentPrice = prices[ticker];

    if (!currentPrice) {
      throw new functions.https.HttpsError('not-found', `Price for ${ticker} not found.`);
    }

    // CRITICAL: Enforce 3-second cooldown using server timestamp
    const now = admin.firestore.Timestamp.now().toMillis();
    const lastTradeTime = userData.lastTradeTime;

    if (lastTradeTime) {
      const lastTradeMs = lastTradeTime.toMillis ? lastTradeTime.toMillis() : lastTradeTime;
      const timeSinceLastTrade = now - lastTradeMs;
      const COOLDOWN_MS = 3000; // 3 seconds

      if (timeSinceLastTrade < COOLDOWN_MS) {
        const remainingMs = COOLDOWN_MS - timeSinceLastTrade;
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Trade cooldown: ${Math.ceil(remainingMs / 1000)}s remaining`
        );
      }
    }

    // Validate based on action
    const cash = userData.cash || 0;
    const holdings = userData.holdings || {};
    const shorts = userData.shorts || {};

    if (action === 'buy') {
      // Validate sufficient cash (including margin if enabled)
      const marginEnabled = userData.marginEnabled || false;
      const marginUsed = userData.marginUsed || 0;

      // Calculate estimated cost using actual price impact formula (matches client)
      const BASE_IMPACT = 0.012;
      const BASE_LIQUIDITY = 100;
      const BID_ASK_SPREAD = 0.002;
      const MAX_PRICE_CHANGE_PERCENT = 0.05;

      let priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(amount / BASE_LIQUIDITY);
      const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
      priceImpact = Math.min(priceImpact, maxImpact);

      const newMidPrice = currentPrice + priceImpact;
      const askPrice = newMidPrice * (1 + BID_ASK_SPREAD / 2);
      const estimatedCost = askPrice * amount;

      if (cash < 0) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Cannot open new positions while in debt.'
        );
      }

      if (!marginEnabled && cash < estimatedCost) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Insufficient funds.'
        );
      }

    } else if (action === 'sell') {
      // Validate sufficient holdings
      const currentHoldings = holdings[ticker] || 0;
      if (currentHoldings < amount) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Insufficient shares to sell.'
        );
      }

      // Enforce 45-second hold period
      const lastBuyTime = userData.lastBuyTime?.[ticker];
      if (lastBuyTime) {
        const lastBuyMs = lastBuyTime.toMillis ? lastBuyTime.toMillis() : lastBuyTime;
        const timeSinceBuy = now - lastBuyMs;
        const HOLD_PERIOD_MS = 45 * 1000; // 45 seconds

        if (timeSinceBuy < HOLD_PERIOD_MS) {
          const remainingMs = HOLD_PERIOD_MS - timeSinceBuy;
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Hold period: ${Math.ceil(remainingMs / 1000)}s remaining`
          );
        }
      }

    } else if (action === 'short') {
      // Validate shorting eligibility
      if (cash < 0) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Cannot open new positions while in debt.'
        );
      }

      const marginRequired = currentPrice * amount * 0.5; // 50% margin
      if (cash < marginRequired) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Insufficient margin for short position.'
        );
      }

    } else if (action === 'cover') {
      // Validate existing short position
      const shortPosition = shorts[ticker];
      if (!shortPosition || shortPosition.shares < amount) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'No short position to cover.'
        );
      }

      // Enforce 45-second hold period for shorts
      const openedAt = shortPosition.openedAt;
      if (openedAt) {
        const openedMs = openedAt.toMillis ? openedAt.toMillis() : openedAt;
        const timeSinceOpen = now - openedMs;
        const HOLD_PERIOD_MS = 45 * 1000; // 45 seconds

        if (timeSinceOpen < HOLD_PERIOD_MS) {
          const remainingMs = HOLD_PERIOD_MS - timeSinceOpen;
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Hold period: ${Math.ceil(remainingMs / 1000)}s remaining`
          );
        }
      }
    }

    // All validations passed
    return {
      valid: true,
      currentPrice,
      serverTimestamp: now,
      cash,
      holdings: holdings[ticker] || 0
    };

  } catch (error) {
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Trade validation error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Trade validation failed: ' + error.message
    );
  }
});

/**
 * Records and validates a completed trade
 * Called after client executes trade, logs for auditing
 * Detects suspicious patterns
 */
exports.recordTrade = functions.https.onCall(async (data, context) => {
  // Verify authentication
  if (!context.auth) {
    throw new functions.https.HttpsError(
      'unauthenticated',
      'Must be logged in.'
    );
  }

  const uid = context.auth.uid;
  const { ticker, action, amount, price, totalValue, cashBefore, cashAfter, portfolioAfter } = data;

  try {
    const now = admin.firestore.FieldValue.serverTimestamp();

    // Record in transaction log
    const tradeRecord = {
      uid,
      ticker,
      action,
      amount,
      price,
      totalValue,
      cashBefore,
      cashAfter,
      portfolioAfter,
      timestamp: now,
      ip: context.rawRequest?.ip || 'unknown'
    };

    // Store in a separate trades collection for auditing
    await db.collection('trades').add(tradeRecord);

    // Check for suspicious patterns
    const recentTradesSnap = await db.collection('trades')
      .where('uid', '==', uid)
      .where('timestamp', '>', new Date(Date.now() - 60000)) // Last minute
      .get();

    const tradeCount = recentTradesSnap.size;

    // Flag suspicious activity (>10 trades per minute)
    if (tradeCount > 10) {
      console.warn(`SUSPICIOUS ACTIVITY: User ${uid} made ${tradeCount} trades in 1 minute`);

      // Log to admin collection for review
      await db.collection('admin').doc('suspicious_activity').set({
        [uid]: {
          timestamp: now,
          tradeCount,
          reason: 'Excessive trading frequency',
          recentTrade: tradeRecord
        }
      }, { merge: true });

      // Send Discord alert if configured
      try {
        await sendDiscordMessage(`⚠️ **Suspicious Activity Detected**\nUser: ${uid}\nTrades in 1 minute: ${tradeCount}\nAction: Manual review required`);
      } catch (err) {
        console.error('Failed to send Discord alert:', err);
      }
    }

    return { success: true, recorded: true };

  } catch (error) {
    console.error('Trade recording error:', error);
    // Don't throw - recording failure shouldn't block the trade
    return { success: false, error: error.message };
  }
});

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
      await sendDiscordMessage(`🔨 **User Banned**\nUsername: ${displayName}\nReason: ${reason}\nRolled back from $${userData.cash.toFixed(2)} to $${rollbackCash}`);
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

      // 3. Cleanup old backups (keep last 7 days, but skip monthly backups)
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
      const percentChange = ((secondPrice - firstPrice) / firstPrice) * 100;

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
// LADDER GAME FUNCTIONS
// ============================================

/**
 * Play the ladder game - server-side RNG and validation
 */
exports.playLadderGame = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { startSide, bet, amount } = data;

  // Validate inputs
  if (!['left', 'right'].includes(startSide)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid start side.');
  }
  if (!['odd', 'even'].includes(bet)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid bet.');
  }
  if (!amount || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid amount.');
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const userRef = db.collection('ladderGameUsers').doc(uid);
      const globalRef = db.collection('ladderGame').doc('global');
      const mainUserRef = db.collection('users').doc(uid);

      const [userDoc, globalDoc, mainUserDoc] = await Promise.all([
        transaction.get(userRef),
        transaction.get(globalRef),
        transaction.get(mainUserRef)
      ]);

      // Get or create ladder game user
      let userData = userDoc.exists ? userDoc.data() : {
        balance: 500,
        totalDeposited: 0,
        totalWon: 0,
        totalLost: 0,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        currentStreak: 0,
        bestStreak: 0,
        lastPlayed: null
      };

      const mainUser = mainUserDoc.data();
      const username = mainUser?.displayName || 'Anonymous';

      // Check balance
      if (userData.balance < amount) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient balance.');
      }

      // Enforce 3-second cooldown
      const now = admin.firestore.Timestamp.now();
      if (userData.lastPlayed) {
        const lastPlayedMs = userData.lastPlayed.toMillis ? userData.lastPlayed.toMillis() : userData.lastPlayed;
        const timeSince = now.toMillis() - lastPlayedMs;
        if (timeSince < 3000) {
          throw new functions.https.HttpsError('failed-precondition', `Cooldown: ${Math.ceil((3000 - timeSince) / 1000)}s remaining`);
        }
      }

      // Server-side RNG
      const numRungs = Math.random() < 0.5 ? 2 : 3;
      const rungs = numRungs === 2 ? [3, 7] : [2, 5, 8];
      const pathsCross = numRungs % 2 === 1;
      const result = (startSide === 'left')
        ? (pathsCross ? 'even' : 'odd')
        : (pathsCross ? 'odd' : 'even');

      const won = bet === result;
      const payout = won ? amount * 2 : 0;

      // Calculate odds distribution (for UI) - add randomness for visual variety
      const globalData = globalDoc.exists ? globalDoc.data() : { history: [], totalGamesPlayed: 0 };
      const recentHistory = globalData.history || [];

      // Generate random percentages with some constraints (between 30-70%)
      const randomBase = 30 + Math.floor(Math.random() * 41); // 30-70
      const variance = Math.floor(Math.random() * 11) - 5; // -5 to +5
      const oddPct = Math.max(25, Math.min(75, randomBase + variance));
      const evenPct = 100 - oddPct;

      // Update user stats
      userData.balance = userData.balance - amount + payout;
      userData.gamesPlayed += 1;
      if (won) {
        userData.wins += 1;
        userData.totalWon += payout - amount;
        userData.currentStreak += 1;
        userData.bestStreak = Math.max(userData.bestStreak, userData.currentStreak);
      } else {
        userData.losses += 1;
        userData.totalLost += amount;
        userData.currentStreak = 0;
      }
      userData.lastPlayed = now;

      transaction.set(userRef, userData);

      // Update global history
      const gameRecord = {
        id: `${uid}_${Date.now()}`,
        timestamp: now,
        userId: uid,
        username,
        result,
        bet,
        amount,
        won,
        payout,
        oddPct,
        evenPct
      };

      const updatedHistory = [gameRecord, ...recentHistory].slice(0, 5);
      transaction.set(globalRef, {
        history: updatedHistory,
        totalGamesPlayed: (globalData.totalGamesPlayed || 0) + 1
      }, { merge: true });

      return {
        rungs,
        result,
        won,
        payout,
        newBalance: userData.balance,
        currentStreak: userData.currentStreak
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Ladder game error:', error);
    throw new functions.https.HttpsError('internal', 'Game failed: ' + error.message);
  }
});

/**
 * Deposit from Stockism cash to ladder game balance (one-way)
 */
exports.depositToLadderGame = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { amount } = data;

  if (!amount || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid amount.');
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const mainUserRef = db.collection('users').doc(uid);
      const ladderUserRef = db.collection('ladderGameUsers').doc(uid);

      const [mainUserDoc, ladderUserDoc] = await Promise.all([
        transaction.get(mainUserRef),
        transaction.get(ladderUserRef)
      ]);

      if (!mainUserDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }

      const mainUser = mainUserDoc.data();
      const cash = mainUser.cash || 0;

      if (cash < amount) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient Stockism cash.');
      }

      // Deduct from Stockism cash
      transaction.update(mainUserRef, {
        cash: cash - amount
      });

      // Add to ladder balance
      const ladderData = ladderUserDoc.exists ? ladderUserDoc.data() : {
        balance: 0,
        totalDeposited: 0,
        totalWon: 0,
        totalLost: 0,
        gamesPlayed: 0,
        wins: 0,
        losses: 0,
        currentStreak: 0,
        bestStreak: 0,
        lastPlayed: null
      };

      transaction.set(ladderUserRef, {
        ...ladderData,
        balance: (ladderData.balance ?? 0) + amount,
        totalDeposited: (ladderData.totalDeposited || 0) + amount
      });

      return {
        success: true,
        newStockismCash: cash - amount,
        newLadderBalance: (ladderData.balance ?? 0) + amount
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Deposit error:', error);
    throw new functions.https.HttpsError('internal', 'Deposit failed: ' + error.message);
  }
});

/**
 * Get ladder game leaderboard (top 50 by balance)
 */
exports.getLadderLeaderboard = functions.https.onCall(async (data, context) => {
  try {
    const ladderUsersSnap = await db.collection('ladderGameUsers')
      .orderBy('balance', 'desc')
      .limit(50)
      .get();

    const userIds = ladderUsersSnap.docs.map(doc => doc.id);
    const leaderboard = [];

    // Batch get usernames
    for (const userId of userIds) {
      const ladderData = ladderUsersSnap.docs.find(doc => doc.id === userId).data();
      const userDoc = await db.collection('users').doc(userId).get();
      const userData = userDoc.data();

      leaderboard.push({
        userId,
        username: userData?.displayName || 'Anonymous',
        balance: ladderData.balance || 0,
        gamesPlayed: ladderData.gamesPlayed || 0,
        wins: ladderData.wins || 0,
        winRate: ladderData.gamesPlayed > 0
          ? Math.round((ladderData.wins / ladderData.gamesPlayed) * 100)
          : 0
      });
    }

    return { leaderboard };
  } catch (error) {
    console.error('Leaderboard error:', error);
    throw new functions.https.HttpsError('internal', 'Failed to get leaderboard: ' + error.message);
  }
});

// Export content generation functions
exports.generateMarketContent = contentGen.generateMarketContent;
exports.generateDramaVideo = contentGen.generateDramaVideo;
exports.listPendingContent = contentGen.listPendingContent;
exports.approveContent = contentGen.approveContent;
exports.rejectContent = contentGen.rejectContent;
exports.generateDailyMovers = contentGen.generateDailyMovers;
