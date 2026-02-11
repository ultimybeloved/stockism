const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');

admin.initializeApp();
const db = admin.firestore();

// Import bot trader
const { botTrader } = require('./botTrader');

// Import character data for trailing effects
const { CHARACTERS } = require('./characters');

// Constants
const STARTING_CASH = 1000;
// Admin UID from environment variable (set in functions/.env)
// Falls back to hardcoded value for backwards compatibility
const ADMIN_UID = process.env.ADMIN_UID || '4usiVxPmHLhmitEKH2HfCpbx4Yi1';

// Weekly trading halt: Thursday 14:00–21:00 UTC (chapter review window)
const isWeeklyTradingHalt = () => {
  const now = new Date();
  if (now.getUTCDay() !== 4) return false;
  const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
  return utcMins >= 840 && utcMins < 1260;
};

// Daily Impact Anti-Manipulation Constants
const MAX_DAILY_IMPACT = 0.10; // 10% max price movement per user per ticker per day
const BASE_IMPACT = 0.012;
const BASE_LIQUIDITY = 100;
const BID_ASK_SPREAD = 0.002;
const MAX_PRICE_CHANGE_PERCENT = 0.05;

// Crew member mappings for mission tracking
const CREW_MEMBERS = {
  ALLIED: ['BDNL', 'LDNL', 'VSCO', 'ZACK', 'JAY', 'VIN', 'AHN'],
  BIG_DEAL: ['JAKE', 'SWRD', 'JSN', 'BRAD', 'LINE', 'SINU', 'LUAH'],
  FIST_GANG: ['GAP', 'ELIT', 'JYNG', 'TOM', 'KWON', 'DNCE', 'GNTL', 'MMA', 'LIAR', 'NOH'],
  GOD_DOG: ['GDOG'],
  SECRET_FRIENDS: ['GOO', 'LOGN', 'SAM', 'ALEX', 'SHMN'],
  HOSTEL: ['ELI', 'SLLY', 'CHAE', 'MAX', 'DJO', 'ZAMI', 'RYAN'],
  WTJC: ['TOM', 'SRMK', 'SGUI', 'YCHL', 'SERA', 'MMA', 'LIAR', 'NOH'],
  WORKERS: ['WRKR', 'BANG', 'CAPG', 'JYNG', 'NOMN', 'NEKO', 'DOOR', 'JINJ', 'DRMA', 'HYOT', 'OLDF', 'SHKO', 'HIKO', 'DOC', 'NO1'],
  YAMAZAKI: ['GUN', 'SHNG', 'SHRO', 'SHKO', 'HIKO', 'SOMI']
};
// Set of all crew member tickers (for rival detection)
const ALL_CREW_TICKERS = new Set(Object.values(CREW_MEMBERS).flat());

// Server-side mission reward lookup (prevents client reward inflation)
const MISSION_REWARDS = {
  // Daily missions
  BUY_CREW_MEMBER: 150, HOLD_CREW_SHARES: 75, MAKE_TRADES: 100,
  BUY_ANY_STOCK: 75, SELL_ANY_STOCK: 75, HOLD_LARGE_POSITION: 125, TRADE_VOLUME: 100,
  CREW_MAJORITY: 125, CREW_COLLECTOR: 100, FULL_ROSTER: 200, CREW_LEADER: 150,
  RIVAL_TRADER: 75, SPY_GAME: 100,
  TOP_DOG: 100, UNDERDOG_INVESTOR: 75,
  BALANCED_CREW: 100, CREW_ACCUMULATOR: 150,
  // Weekly missions
  MARKET_WHALE: 750, VOLUME_KING: 500, TRADING_MACHINE: 400,
  TRADING_STREAK: 600, DAILY_GRINDER: 500,
  CREW_MAXIMALIST: 600, CREW_HOARDER: 500, FULL_CREW_OWNERSHIP: 1000,
  DIVERSIFICATION_MASTER: 500, PORTFOLIO_BUILDER: 750,
  SHARE_MOGUL: 700, TRADE_MASTER: 600, HEAVY_BAGS: 600,
  PENNY_COLLECTOR: 500, BLUE_CHIP_INVESTOR: 600, SHORT_KING: 700,
  PORTFOLIO_MOONSHOT: 1000
};

// Server-side mission completion verification
// Maps mission IDs to their completion check logic
const DAILY_MISSION_CHECKS = {
  BUY_CREW_MEMBER: (dp) => !!dp.boughtCrewMember,
  HOLD_CREW_SHARES: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const total = CREW_MEMBERS[crew].reduce((s, t) => s + ((userData.holdings || {})[t] || 0), 0);
    return total >= 10;
  },
  MAKE_TRADES: (dp) => (dp.tradesCount || 0) >= 3,
  BUY_ANY_STOCK: (dp) => !!dp.boughtAny,
  SELL_ANY_STOCK: (dp) => !!dp.soldAny,
  HOLD_LARGE_POSITION: (dp, userData) => {
    const vals = Object.values(userData.holdings || {});
    return vals.length > 0 && Math.max(...vals) >= 25;
  },
  TRADE_VOLUME: (dp) => (dp.tradeVolume || 0) >= 10,
  CREW_MAJORITY: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const holdings = userData.holdings || {};
    const total = Object.values(holdings).reduce((s, v) => s + v, 0);
    if (total <= 0) return false;
    const crewShares = CREW_MEMBERS[crew].reduce((s, t) => s + (holdings[t] || 0), 0);
    return (crewShares / total) * 100 >= 50;
  },
  CREW_COLLECTOR: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const owned = CREW_MEMBERS[crew].filter(t => ((userData.holdings || {})[t] || 0) > 0).length;
    return owned >= 3;
  },
  FULL_ROSTER: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const members = CREW_MEMBERS[crew];
    return members.length > 0 && members.every(t => ((userData.holdings || {})[t] || 0) > 0);
  },
  CREW_LEADER: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const maxHolding = Math.max(0, ...CREW_MEMBERS[crew].map(t => ((userData.holdings || {})[t] || 0)));
    return maxHolding >= 20;
  },
  RIVAL_TRADER: (dp) => !!dp.boughtRival,
  SPY_GAME: (dp, userData) => {
    const holdings = userData.holdings || {};
    const crewsOwned = new Set();
    Object.entries(holdings).forEach(([ticker, shares]) => {
      if (shares > 0) {
        Object.entries(CREW_MEMBERS).forEach(([crewId, members]) => {
          if (members.includes(ticker)) crewsOwned.add(crewId);
        });
      }
    });
    return crewsOwned.size >= 3;
  },
  TOP_DOG: (dp, userData, prices) => {
    let highestTicker = null, highestPrice = 0;
    Object.entries(prices || {}).forEach(([t, p]) => { if (p > highestPrice) { highestPrice = p; highestTicker = t; } });
    return highestTicker && ((userData.holdings || {})[highestTicker] || 0) > 0;
  },
  UNDERDOG_INVESTOR: (dp) => !!dp.boughtUnderdog,
  BALANCED_CREW: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const qualifying = CREW_MEMBERS[crew].filter(t => ((userData.holdings || {})[t] || 0) >= 5).length;
    return qualifying >= 2;
  },
  CREW_ACCUMULATOR: (dp) => (dp.crewSharesBought || 0) >= 10
};

const WEEKLY_MISSION_CHECKS = {
  MARKET_WHALE: (wp) => (wp.tradeValue || 0) >= 10000,
  VOLUME_KING: (wp) => (wp.tradeVolume || 0) >= 100,
  TRADING_MACHINE: (wp) => (wp.tradeCount || 0) >= 25,
  TRADING_STREAK: (wp) => Object.keys(wp.tradingDays || {}).length >= 5,
  DAILY_GRINDER: (wp) => Object.keys(wp.checkinDays || {}).length >= 7,
  CREW_MAXIMALIST: (wp, userData, prices) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const holdings = userData.holdings || {};
    let totalVal = 0, crewVal = 0;
    Object.entries(holdings).forEach(([t, s]) => {
      if (s > 0) { const v = s * ((prices || {})[t] || 0); totalVal += v; if (CREW_MEMBERS[crew].includes(t)) crewVal += v; }
    });
    return totalVal > 0 && (crewVal / totalVal) * 100 >= 80;
  },
  CREW_HOARDER: (wp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const total = CREW_MEMBERS[crew].reduce((s, t) => s + ((userData.holdings || {})[t] || 0), 0);
    return total >= 50;
  },
  FULL_CREW_OWNERSHIP: (wp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const members = CREW_MEMBERS[crew];
    return members.length > 0 && members.every(t => ((userData.holdings || {})[t] || 0) >= 5);
  },
  DIVERSIFICATION_MASTER: (wp, userData) => {
    const holdings = userData.holdings || {};
    const crewsOwned = new Set();
    Object.entries(holdings).forEach(([ticker, shares]) => {
      if (shares > 0) {
        Object.entries(CREW_MEMBERS).forEach(([crewId, members]) => {
          if (members.includes(ticker)) crewsOwned.add(crewId);
        });
      }
    });
    return crewsOwned.size >= 5;
  },
  PORTFOLIO_BUILDER: (wp, userData) => {
    const startValue = wp.startPortfolioValue || 0;
    return startValue > 0 && (userData.portfolioValue || 0) - startValue >= 2000;
  },
  SHARE_MOGUL: (wp) => (wp.tradeVolume || 0) >= 250,
  TRADE_MASTER: (wp) => (wp.tradeCount || 0) >= 50,
  HEAVY_BAGS: (wp, userData) => {
    const total = Object.values(userData.holdings || {}).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    return total >= 200;
  },
  PENNY_COLLECTOR: (wp, userData, prices) => {
    let pennyShares = 0;
    Object.entries(userData.holdings || {}).forEach(([t, s]) => {
      if (s > 0 && ((prices || {})[t] || 0) < 25) pennyShares += s;
    });
    return pennyShares >= 50;
  },
  BLUE_CHIP_INVESTOR: (wp, userData, prices) => {
    let count = 0;
    Object.entries(userData.holdings || {}).forEach(([t, s]) => {
      if (s > 0 && ((prices || {})[t] || 0) > 100) count++;
    });
    return count >= 3;
  },
  SHORT_KING: (wp, userData) => {
    const shorts = userData.shorts || {};
    return Object.values(shorts).filter(p => p && p.shares > 0).length >= 3;
  },
  PORTFOLIO_MOONSHOT: (wp, userData) => {
    const startValue = wp.startPortfolioValue || 0;
    return startValue > 0 && (userData.portfolioValue || 0) - startValue >= 5000;
  }
};

// Banned usernames (impersonation prevention)
const BANNED_NAMES = [
  'admin', 'administrator', 'mod', 'moderator', 'support', 'staff',
  'official', 'system', 'root', 'owner', 'founder', 'manager',
  'stockism', 'darthyg', 'darth_yg', 'darth', 'null', 'undefined',
  'ricky'
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

    // Send Discord notification for new user signup
    try {
      const authProvider = context.auth.token.firebase?.sign_in_provider || 'unknown';
      const providerEmoji = {
        'google.com': '🔵',
        'twitter.com': '🐦',
        'password': '📧',
        'unknown': '🔑'
      };

      const embed = {
        color: 0x00ff00, // Green
        title: '🎉 New User Joined!',
        description: `**${trimmed}** just joined Stockism`,
        fields: [
          {
            name: 'Sign-up Method',
            value: `${providerEmoji[authProvider] || '🔑'} ${authProvider === 'google.com' ? 'Google' : authProvider === 'twitter.com' ? 'Twitter' : authProvider === 'password' ? 'Email' : 'Other'}`,
            inline: true
          },
          {
            name: 'Starting Cash',
            value: `$${STARTING_CASH.toLocaleString()}`,
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Stockism - Where Lookism characters become investments'
        }
      };

      await sendDiscordMessage(null, [embed], 'signups');
    } catch (discordError) {
      console.error('Failed to send Discord signup notification:', discordError);
      // Don't fail user creation if Discord notification fails
    }

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
 * @param {string} content - Message content (can be null if using embeds)
 * @param {Array} embeds - Array of Discord embed objects
 * @param {string} channelType - Channel type: 'default', 'signups', or custom channel ID
 */
async function sendDiscordMessage(content, embeds = null, channelType = 'default') {
  const botToken = process.env.DISCORD_BOT_TOKEN;

  // Determine which channel to use
  let channelId;
  if (channelType === 'default') {
    channelId = process.env.DISCORD_CHANNEL_ID;
  } else if (channelType === 'signups') {
    channelId = process.env.DISCORD_SIGNUP_CHANNEL_ID || process.env.DISCORD_CHANNEL_ID; // Fallback to default
  } else {
    channelId = channelType; // Assume it's a custom channel ID
  }

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
    console.log(`Discord message sent successfully to ${channelType} channel`);
  } catch (error) {
    console.error('Error sending Discord message:', error.response?.data || error.message);
  }
}

/**
 * Get leaderboard with only public data
 * Replaces direct Firestore queries to protect user privacy
 */
exports.getLeaderboard = functions.https.onCall(async (data, context) => {
  try {
    const { crew } = data || {};

    // Build query - use composite index for crew filtering
    let query = db.collection('users');

    if (crew) {
      query = query.where('crew', '==', crew);
    }

    query = query.orderBy('portfolioValue', 'desc').limit(100);

    const snapshot = await query.get();

    // Filter out bots and return only safe fields
    const leaderboard = [];
    snapshot.forEach(doc => {
      const userData = doc.data();

      // Skip bots
      if (userData.isBot) return;

      // Limit to top 50
      if (leaderboard.length >= 50) return;

      // Count holdings (only non-zero positions)
      const holdingsCount = userData.holdings
        ? Object.keys(userData.holdings).filter(k => userData.holdings[k] > 0).length
        : 0;

      leaderboard.push({
        userId: doc.id,
        displayName: userData.displayName || 'Anonymous',
        portfolioValue: userData.portfolioValue || 0,
        crew: userData.crew || null,
        isCrewHead: userData.isCrewHead || false,
        crewHeadColor: userData.crewHeadColor || null,
        holdingsCount: holdingsCount,
        displayCrewPin: userData.displayCrewPin || null,
        displayedAchievementPins: userData.displayedAchievementPins || [],
        achievements: userData.achievements || [],
        displayedShopPins: userData.displayedShopPins || []
      });
    });

    // Find caller's rank if authenticated
    let callerRank = null;
    if (context.auth) {
      const callerIndex = leaderboard.findIndex(entry => entry.userId === context.auth.uid);
      if (callerIndex !== -1) {
        callerRank = callerIndex + 1;
      }
    }

    return {
      leaderboard,
      callerRank,
      timestamp: Date.now()
    };
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    throw new functions.https.HttpsError('internal', 'Failed to fetch leaderboard');
  }
});

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

        const change = priceWeekAgo > 0 ? ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100 : 0;
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
        value: `+${(previousHigh > 0 ? ((price - previousHigh) / previousHigh) * 100 : 0).toFixed(1)}%`,
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
 * Helper function to censor usernames for privacy
 * Example: "JohnDoe" -> "J*****e"
 */
function censorUsername(username) {
  if (!username || username.length <= 2) return '***';
  const first = username.charAt(0);
  const last = username.charAt(username.length - 1);
  const middle = '*'.repeat(Math.max(1, username.length - 2));
  return `${first}${middle}${last}`;
}

/**
 * IPO Announcement - Called when a new IPO is created
 */
exports.ipoAnnouncementAlert = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const { ticker, characterName, basePrice, ipoPrice, endsAt } = data;

  const embed = {
    color: 0x00D4FF, // Bright blue
    title: '🚀 NEW IPO ANNOUNCED!',
    description: `**${characterName}** ($${ticker}) is going public!`,
    fields: [
      {
        name: 'IPO Price',
        value: `$${ipoPrice.toFixed(2)}`,
        inline: true
      },
      {
        name: 'Post-IPO Price',
        value: `$${basePrice.toFixed(2)} (+30%)`,
        inline: true
      },
      {
        name: 'Trading Opens',
        value: `<t:${Math.floor(endsAt / 1000)}:R>`,
        inline: false
      }
    ],
    footer: {
      text: '24-hour IPO window - Get in early!'
    },
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
    color: 0x00FF00, // Green
    title: '📊 IPO CLOSED',
    description: `**${characterName}** ($${ticker}) IPO has ended!`,
    fields: [
      {
        name: 'Participants',
        value: participants.toString(),
        inline: true
      },
      {
        name: 'Total Invested',
        value: `$${totalInvested.toLocaleString(undefined, {maximumFractionDigits: 2})}`,
        inline: true
      },
      {
        name: 'Shares Sold',
        value: totalShares.toLocaleString(),
        inline: true
      }
    ],
    footer: {
      text: 'Trading is now live at +30% from IPO price!'
    },
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

  // Validate: verify the user is actually bankrupt and compute values server-side
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
      color: 0xFF0000, // Red
      title: '💔 Trader Bankrupt',
      description: `**${censoredName}** has gone bust`,
      fields: [
        {
          name: 'Final Portfolio Value',
          value: `$${actualValue.toFixed(2)}`,
          inline: true
        }
      ],
      footer: {
        text: 'Risk management is key!'
      },
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

  // Compute all values server-side from user data
  try {
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists) return { success: true };
    const userData = userDoc.data();
    const actualValue = userData.portfolioValue || 0;

    // Use lowestWhileHolding or portfolio history to determine low point
    const portfolioHistory = userData.portfolioHistory || [];
    const lowestHistorical = portfolioHistory.length > 0
      ? Math.min(...portfolioHistory.map(h => h.value || Infinity))
      : actualValue;
    const serverLowPoint = Math.min(lowestHistorical, actualValue);

    // Only alert if there's a meaningful comeback (at least 50% recovery from a low)
    if (serverLowPoint <= 0 || actualValue <= serverLowPoint * 1.5) {
      return { success: true };
    }

    const gainPercent = ((actualValue - serverLowPoint) / serverLowPoint * 100).toFixed(0);
    const censoredName = censorUsername(userData.displayName || 'Unknown');

    const embed = {
      color: 0x00FF00, // Green
      title: '🔥 Epic Comeback!',
      description: `**${censoredName}** recovered from the brink!`,
      fields: [
        {
          name: 'Lowest Point',
          value: `$${serverLowPoint.toFixed(2)}`,
          inline: true
        },
        {
          name: 'Current Value',
          value: `$${actualValue.toFixed(2)}`,
          inline: true
        },
        {
          name: 'Recovery',
          value: `+${gainPercent}%`,
          inline: true
        }
      ],
      footer: {
        text: 'Never give up!'
      },
      timestamp: new Date().toISOString()
    };

    await sendDiscordMessage(null, [embed]);
  } catch (e) {
    console.error('Comeback alert failed:', e);
  }
  return { success: true };
});

/**
 * Weekly Leaderboard - Runs every Sunday at 8 PM EST (Monday 1 AM UTC)
 */
exports.weeklyLeaderboard = functions.pubsub
  .schedule('0 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // Calculate portfolio values and sort
      const traders = [];
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if (!user.isBankrupt) {
          traders.push({
            username: user.displayName,
            portfolioValue: user.portfolioValue || user.cash || 0
          });
        }
      });

      traders.sort((a, b) => b.portfolioValue - a.portfolioValue);
      const top5 = traders.slice(0, 5);

      const leaderboardText = top5.map((trader, idx) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][idx];
        return `${medal} **${trader.username}** - $${trader.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
      }).join('\n');

      const embed = {
        color: 0xFFD700, // Gold
        title: '🏆 Weekly Leaderboard',
        description: leaderboardText,
        footer: {
          text: `Total Active Traders: ${traders.length}`
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      console.log('Weekly leaderboard sent');
      return null;
    } catch (error) {
      console.error('Error in weekly leaderboard:', error);
      return null;
    }
  });

/**
 * Weekly Crew Rankings - Runs every Sunday at 8:30 PM EST (Monday 1:30 AM UTC)
 */
exports.weeklyCrewRankings = functions.pubsub
  .schedule('30 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // Crew data structure
      const crews = {
        'ALLIED': { name: 'Allied', emblem: '🏛️', members: [], totalCash: 0, weeklyGain: 0 },
        'BIG_DEAL': { name: 'Big Deal', emblem: '🤝', members: [], totalCash: 0, weeklyGain: 0 },
        'FIST_GANG': { name: 'Fist Gang', emblem: '👊', members: [], totalCash: 0, weeklyGain: 0 },
        'GOD_DOG': { name: 'God Dog', emblem: '🐕', members: [], totalCash: 0, weeklyGain: 0 },
        'SECRET_FRIENDS': { name: 'Secret Friends', emblem: '🤫', members: [], totalCash: 0, weeklyGain: 0 },
        'HOSTEL': { name: 'Hostel', emblem: '🏠', members: [], totalCash: 0, weeklyGain: 0 },
        'WTJC': { name: 'White Tiger Job Center', emblem: '🐯', members: [], totalCash: 0, weeklyGain: 0 },
        'WORKERS': { name: 'Workers', emblem: '⚒️', members: [], totalCash: 0, weeklyGain: 0 },
        'YAMAZAKI': { name: 'Yamazaki Syndicate', emblem: '⛩️', members: [], totalCash: 0, weeklyGain: 0 }
      };

      // Get week-old data for comparison
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

      usersSnapshot.forEach(doc => {
        const user = doc.data();
        const crew = user.crew;

        if (crew && crews[crew]) {
          const portfolioValue = user.portfolioValue || user.cash || 0;

          crews[crew].members.push({
            username: user.displayName,
            portfolioValue: portfolioValue
          });
          crews[crew].totalCash += portfolioValue;

          // Calculate weekly gain from portfolio history
          if (user.portfolioHistory && Array.isArray(user.portfolioHistory)) {
            const weekOldEntry = user.portfolioHistory.find(h => h.timestamp >= oneWeekAgo);
            if (weekOldEntry) {
              const weeklyGain = portfolioValue - weekOldEntry.value;
              crews[crew].weeklyGain += weeklyGain;
            }
          }
        }
      });

      // Sort crews by total cash
      const sortedCrews = Object.values(crews)
        .filter(crew => crew.members.length > 0)
        .sort((a, b) => b.totalCash - a.totalCash);

      // Build embed fields
      const fields = sortedCrews.map((crew, idx) => {
        // Sort members by portfolio value
        crew.members.sort((a, b) => b.portfolioValue - a.portfolioValue);
        const top5Members = crew.members.slice(0, 5);

        // Calculate average
        const avgCash = crew.members.length > 0 ? crew.totalCash / crew.members.length : 0;

        // Top 50 total (or all if less than 50)
        const top50 = crew.members.slice(0, 50);
        const top50Total = top50.reduce((sum, m) => sum + m.portfolioValue, 0);
        const consolidatedNote = crew.members.length <= 50 ? ' (same as total)' : '';

        // Build top 5 list
        let top5Text = top5Members.map((m, i) =>
          `${i + 1}. ${m.username} - $${m.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`
        ).join('\n');

        // Add blank spaces if less than 5 members
        if (top5Members.length < 5) {
          for (let i = top5Members.length; i < 5; i++) {
            top5Text += `\n${i + 1}. `;
          }
        }

        const weeklyGainText = crew.weeklyGain >= 0
          ? `+$${crew.weeklyGain.toLocaleString(undefined, {maximumFractionDigits: 2})}`
          : `-$${Math.abs(crew.weeklyGain).toLocaleString(undefined, {maximumFractionDigits: 2})}`;

        return {
          name: `${idx + 1}. ${crew.emblem} ${crew.name}`,
          value: `**Members:** ${crew.members.length}\n` +
                 `**Total Cash:** $${crew.totalCash.toLocaleString(undefined, {maximumFractionDigits: 2})}\n` +
                 `**Top 50 Total:** $${top50Total.toLocaleString(undefined, {maximumFractionDigits: 2})}${consolidatedNote}\n` +
                 `**Average:** $${avgCash.toLocaleString(undefined, {maximumFractionDigits: 2})}\n` +
                 `**Weekly Gain:** ${weeklyGainText}\n\n` +
                 `**Top 5:**\n${top5Text}`,
          inline: false
        };
      });

      const embed = {
        color: 0x5865F2, // Discord blurple
        title: '⚔️ Weekly Crew Rankings',
        description: '*Crews ranked by total cash among all members*',
        fields: fields,
        footer: {
          text: 'Note: Some crews have fewer than 5 members as the game is still early. Rankings will balance out as more players join.'
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      console.log('Weekly crew rankings sent');
      return null;
    } catch (error) {
      console.error('Error in weekly crew rankings:', error);
      return null;
    }
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

        const change = priceAtStart > 0 ? ((currentPrice - priceAtStart) / priceAtStart) * 100 : 0;
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

        const change = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
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

  // Validate: verify the price data roughly matches reality
  if (!ticker || typeof priceBefore !== 'number' || typeof priceAfter !== 'number' ||
      priceBefore <= 0 || priceAfter <= 0 || !Number.isFinite(priceBefore) || !Number.isFinite(priceAfter)) {
    return { success: true, alerted: false };
  }

  // Validate tradeType
  const VALID_TRADE_TYPES = ['BUY', 'SELL', 'SHORT', 'COVER'];
  if (!tradeType || !VALID_TRADE_TYPES.includes(tradeType)) {
    return { success: true, alerted: false };
  }

  const change = priceBefore > 0 ? ((priceAfter - priceBefore) / priceBefore) * 100 : 0;
  const absChange = Math.abs(change);

  // Only alert for 1%+ single-trade moves
  if (absChange < 1) return { success: true, alerted: false };

  const emoji = change > 0 ? '⚡' : '💨';
  const direction = change > 0 ? 'spiked' : 'dropped';
  const tradeAction = tradeType === 'BUY' ? 'buy' : tradeType === 'SHORT' ? 'short' : 'sell';

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

  // Validate: verify the user actually has this achievement
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

  // Validate: verify the user's portfolio value roughly matches claim
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

  // Validate: verify the user actually had a recent liquidation
  try {
    const userDoc = await db.collection('users').doc(context.auth.uid).get();
    if (!userDoc.exists) return { success: true, alerted: false };
    const userData = userDoc.data();
    const lastLiq = userData.lastLiquidation || 0;
    // Only allow alert if liquidation happened in last 10 minutes
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

  // Validate inputs - require whole numbers, finite, bounded
  if (!ticker || !action || !amount || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid trade parameters. Shares must be a whole number between 1 and 10,000.'
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

    // ANTI-MANIPULATION: Check trade velocity per ticker (last 1 hour)
    // Only rate-limit position-opening actions (buy/short)
    // Closing positions (sell/cover) should never be blocked
    const ONE_HOUR_MS = 60 * 60 * 1000;
    const oneHourAgo = new Date(now - ONE_HOUR_MS);

    const recentTickerTradesSnap = await db.collection('trades')
      .where('uid', '==', uid)
      .where('ticker', '==', ticker)
      .where('timestamp', '>', oneHourAgo)
      .get();

    const tradesInLastHour = recentTickerTradesSnap.size;

    // Hard block at 15 trades per ticker per hour (only for buy/short)
    if (action === 'buy' || action === 'short') {
      const MAX_TRADES_PER_HOUR = 15;
      if (tradesInLastHour >= MAX_TRADES_PER_HOUR) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Trade velocity limit: You've traded ${ticker} ${tradesInLastHour} times in the last hour. Please wait before trading this stock again.`
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
      const prices = marketData.prices || {};

      // v2: Must have enough cash for the margin deposit
      if (cash < marginRequired) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Insufficient cash for short margin deposit.'
        );
      }

      // Calculate portfolio equity to cap total short leverage
      let portfolioEquity = cash;
      Object.entries(holdings).forEach(([t, s]) => {
        if (s > 0) portfolioEquity += (prices[t] || 0) * s;
      });
      Object.entries(shorts).forEach(([t, pos]) => {
        if (pos && typeof pos === 'object' && pos.shares > 0) {
          if (pos.system === 'v2') {
            portfolioEquity += (pos.margin || 0) + ((pos.costBasis || 0) - (prices[t] || 0)) * pos.shares;
          } else {
            portfolioEquity += (pos.margin || 0) - ((prices[t] || 0) * pos.shares);
          }
        }
      });

      const existingShortMargin = Object.values(shorts).reduce((sum, pos) =>
        sum + (pos && typeof pos === 'object' && pos.shares > 0 ? (pos.margin || 0) : 0), 0);

      if (portfolioEquity <= 0 || existingShortMargin + marginRequired > portfolioEquity) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Short limit reached. Total short positions cannot exceed your portfolio value.'
        );
      }

      // Anti-manipulation: Short rate limiting (8-hour cooldown after 3rd short)
      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
      const MAX_SHORTS_BEFORE_COOLDOWN = 3;
      const shortHistory = userData.shortHistory?.[ticker] || [];
      const recentShorts = shortHistory.filter(ts => now - ts < EIGHT_HOURS_MS);

      if (recentShorts.length >= MAX_SHORTS_BEFORE_COOLDOWN) {
        const oldestRecent = Math.min(...recentShorts);
        const unlocksAt = oldestRecent + EIGHT_HOURS_MS;
        const remainingMs = unlocksAt - now;
        let hours = Math.floor(remainingMs / 3600000);
        let minutes = Math.ceil((remainingMs % 3600000) / 60000);

        // Handle rollover if minutes = 60
        if (minutes === 60) {
          hours += 1;
          minutes = 0;
        }

        throw new functions.https.HttpsError(
          'failed-precondition',
          `Short limit reached. You can short $${ticker} again in ${hours}h ${minutes}m.`
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

    // IP-based multi-account abuse detection
    const ip = context.rawRequest?.ip || 'unknown';
    if (ip !== 'unknown' && (action === 'buy' || action === 'short')) {
      const MAX_ACCOUNTS_PER_IP = 4;
      const ONE_HOUR = 3600000;
      const sanitizedIp = ip.replace(/[.:/]/g, '_');
      const ipRef = db.collection('ipTracking').doc(sanitizedIp);

      try {
        const ipDoc = await ipRef.get();
        const accounts = {};

        if (ipDoc.exists) {
          const data = ipDoc.data();
          // Keep only accounts active in the last hour
          for (const [accUid, ts] of Object.entries(data.accounts || {})) {
            const tsMs = typeof ts === 'number' ? ts : (ts.toMillis ? ts.toMillis() : ts);
            if (now - tsMs < ONE_HOUR) {
              accounts[accUid] = tsMs;
            }
          }
        }

        // Add current user
        accounts[uid] = now;

        const uniqueCount = Object.keys(accounts).length;

        // Update tracking doc
        await ipRef.set({ accounts, lastUpdated: now });

        // Block if too many unique accounts from same IP
        if (uniqueCount > MAX_ACCOUNTS_PER_IP) {
          console.warn(`IP ABUSE: ${ip} has ${uniqueCount} accounts trading in last hour`);

          await db.collection('admin').doc('suspicious_activity').set({
            [`ip_${sanitizedIp}`]: {
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              accountCount: uniqueCount,
              accounts: Object.keys(accounts),
              reason: 'Multi-account trading from same IP'
            }
          }, { merge: true });

          try {
            await sendDiscordMessage(`**Multi-Account Abuse Detected**\nIP: ${ip}\nAccounts in last hour: ${uniqueCount}\nBlocked user: ${uid}`);
          } catch (err) {
            console.error('Failed to send Discord alert:', err);
          }

          throw new functions.https.HttpsError(
            'permission-denied',
            'Trading temporarily restricted. Too many accounts from this network.'
          );
        }
      } catch (ipError) {
        // Don't block trading if IP tracking fails - just log it
        if (ipError instanceof functions.https.HttpsError) throw ipError;
        console.error('IP tracking error:', ipError);
      }
    }

    // All validations passed
    const result = {
      valid: true,
      currentPrice,
      serverTimestamp: now,
      cash,
      holdings: holdings[ticker] || 0,
      tradesInLastHour // Send trade count for UI warnings
    };

    // Warn on 2nd short that 3rd will trigger cooldown
    if (action === 'short') {
      const EIGHT_HOURS_MS = 8 * 60 * 60 * 1000;
      const shortHistory = userData.shortHistory?.[ticker] || [];
      const recentShorts = shortHistory.filter(ts => now - ts < EIGHT_HOURS_MS);
      if (recentShorts.length === 2) {
        result.shortWarning = `Next short on $${ticker} will trigger an 8-hour cooldown.`;
      }
    }

    return result;

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
 * SECURITY FIX: Server-side trade execution with dailyImpact enforcement
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

  // Validate inputs - require whole numbers, finite, bounded
  if (!ticker || !action || !amount || !Number.isFinite(amount) || !Number.isInteger(amount) || amount < 1 || amount > 10000) {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Invalid trade parameters. Shares must be a whole number between 1 and 10,000.'
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

  // Anti-manipulation: Block shorting if user has a pending SELL limit order on same ticker
  if (action === 'short') {
    const pendingSells = await db.collection('limitOrders')
      .where('userId', '==', uid)
      .where('ticker', '==', ticker)
      .where('status', '==', 'PENDING')
      .where('type', '==', 'SELL')
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

    // Execute trade in atomic transaction
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
      const marketData = marketDoc.data();

      // Check emergency admin halt
      if (marketData.marketHalted) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          marketData.haltReason || 'Market is currently halted.'
        );
      }

      const prices = marketData.prices || {};
      const currentPrice = prices[ticker];

      // Whitelist check — only allow trading valid characters
      const validTicker = CHARACTERS.some(c => c.ticker === ticker);
      if (!validTicker) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
      }

      if (!currentPrice) {
        throw new functions.https.HttpsError('not-found', `Price for ${ticker} not found.`);
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
      const dailyImpact = userData.dailyImpact || {};
      const userDailyImpact = dailyImpact[todayDate] || {};
      const tickerDailyImpact = userDailyImpact[ticker] || 0;

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
      }

      // Calculate price impact
      const MIN_PRICE = 0.01;
      let priceImpact = 0;
      let newPrice = currentPrice;
      let executionPrice = currentPrice;
      let totalCost = 0;
      let newCash = cash;
      let newHoldings = { ...holdings };
      // Sanitize shorts to prevent undefined fields from crashing Firestore writes
      let newShorts = {};
      for (const [t, pos] of Object.entries(shorts)) {
        if (pos && pos.shares > 0) {
          newShorts[t] = {
            shares: pos.shares,
            costBasis: pos.costBasis || pos.entryPrice || 0,
            margin: pos.margin || 0,
            openedAt: pos.openedAt || admin.firestore.Timestamp.now(),
            system: pos.system
          };
        }
      }
      let newMarginUsed = marginUsed;

      // BUY LOGIC
      if (action === 'buy') {
        // Calculate price impact
        priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(amount / BASE_LIQUIDITY);
        const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
        priceImpact = Math.min(priceImpact, maxImpact);

        newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
        executionPrice = newPrice * (1 + BID_ASK_SPREAD / 2); // Ask price
        totalCost = executionPrice * amount;

        // Check dailyImpact — if limit reached, trade still executes but with zero price impact
        let impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        if (tickerDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
          priceImpact = 0;
          impactPercent = 0;
          newPrice = currentPrice;
          executionPrice = currentPrice * (1 + BID_ASK_SPREAD / 2);
          totalCost = executionPrice * amount;
        }

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

        // Update dailyImpact
        userDailyImpact[ticker] = tickerDailyImpact + impactPercent;

      // SELL LOGIC
      } else if (action === 'sell') {
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

        // Calculate price impact (negative for sell)
        priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(amount / BASE_LIQUIDITY);
        const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
        priceImpact = Math.min(priceImpact, maxImpact);

        newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
        executionPrice = Math.max(MIN_PRICE, newPrice * (1 - BID_ASK_SPREAD / 2)); // Bid price
        totalCost = executionPrice * amount;

        // Check dailyImpact — if limit reached, trade still executes but with zero price impact
        let impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        if (tickerDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
          priceImpact = 0;
          impactPercent = 0;
          newPrice = currentPrice;
          executionPrice = Math.max(MIN_PRICE, currentPrice * (1 - BID_ASK_SPREAD / 2));
          totalCost = executionPrice * amount;
        }

        // Execute sell
        newCash = cash + totalCost;
        newHoldings[ticker] = currentHoldings - amount;
        if (newHoldings[ticker] === 0) {
          delete newHoldings[ticker];
        }

        // Update dailyImpact
        userDailyImpact[ticker] = tickerDailyImpact + impactPercent;

      // SHORT LOGIC
      } else if (action === 'short') {
        // Validate margin requirement
        if (cash < 0) {
          throw new functions.https.HttpsError('failed-precondition', 'Cannot open new positions while in debt.');
        }

        const marginRequired = currentPrice * amount * 0.5; // 50% margin

        // v2: Must have enough cash for the margin deposit
        if (cash < marginRequired) {
          throw new functions.https.HttpsError('failed-precondition', 'Insufficient cash for short margin deposit.');
        }

        // Calculate portfolio equity (net worth) to cap total short leverage
        // This prevents the leverage spiral where each short inflates cash
        let portfolioEquity = cash;
        Object.entries(holdings).forEach(([t, s]) => {
          if (s > 0) portfolioEquity += (prices[t] || 0) * s;
        });
        Object.entries(shorts).forEach(([t, pos]) => {
          if (pos && pos.shares > 0) {
            if (pos.system === 'v2') {
              portfolioEquity += (pos.margin || 0) + ((pos.costBasis || 0) - (prices[t] || 0)) * pos.shares;
            } else {
              portfolioEquity += (pos.margin || 0) - ((prices[t] || 0) * pos.shares);
            }
          }
        });

        // Total short margin (existing + new) can't exceed portfolio equity
        const existingShortMargin = Object.values(shorts).reduce((sum, pos) =>
          sum + (pos && pos.shares > 0 ? (pos.margin || 0) : 0), 0);

        if (portfolioEquity <= 0 || existingShortMargin + marginRequired > portfolioEquity) {
          throw new functions.https.HttpsError('failed-precondition', 'Short limit reached. Total short positions cannot exceed your portfolio value.');
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

        // Calculate price impact (negative for short)
        priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(amount / BASE_LIQUIDITY);
        const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
        priceImpact = Math.min(priceImpact, maxImpact);

        newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
        executionPrice = Math.max(MIN_PRICE, newPrice * (1 - BID_ASK_SPREAD / 2)); // Bid price
        totalCost = executionPrice * amount;

        // Check dailyImpact — if limit reached, trade still executes but with zero price impact
        let impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        if (tickerDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
          priceImpact = 0;
          impactPercent = 0;
          newPrice = currentPrice;
          executionPrice = Math.max(MIN_PRICE, currentPrice * (1 - BID_ASK_SPREAD / 2));
          totalCost = executionPrice * amount;
        }

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

        // Update dailyImpact
        userDailyImpact[ticker] = tickerDailyImpact + impactPercent;

      // COVER LOGIC
      } else if (action === 'cover') {
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

        // Calculate price impact (positive for cover)
        priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(amount / BASE_LIQUIDITY);
        const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
        priceImpact = Math.min(priceImpact, maxImpact);

        newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
        executionPrice = newPrice * (1 + BID_ASK_SPREAD / 2); // Ask price
        totalCost = executionPrice * amount;

        // Check dailyImpact — if limit reached, trade still executes but with zero price impact
        let impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        if (tickerDailyImpact + impactPercent > MAX_DAILY_IMPACT) {
          priceImpact = 0;
          impactPercent = 0;
          newPrice = currentPrice;
          executionPrice = currentPrice * (1 + BID_ASK_SPREAD / 2);
          totalCost = executionPrice * amount;
        }

        // Calculate margin to return (based on entry price, not current price)
        const costBasis = shortPosition.costBasis || shortPosition.entryPrice || executionPrice;
        const totalPositionMargin = shortPosition.margin || (costBasis * shortPosition.shares * 0.5);
        const marginToReturn = shortPosition.shares > 0 ? (totalPositionMargin / shortPosition.shares) * amount : 0;

        // Execute cover
        if (shortPosition.system === 'v2') {
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
          system: shortPosition.system
        };
        if (newShorts[ticker].shares <= 0) {
          delete newShorts[ticker];
        }

        // Update dailyImpact
        userDailyImpact[ticker] = tickerDailyImpact + impactPercent;
      }

      // Apply trailing effects to related characters
      const CHARACTER_MAP = CHARACTERS.reduce((map, char) => {
        map[char.ticker] = char;
        return map;
      }, {});

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

      // Track trailing effects in dailyImpact so users can't bypass the 10% limit
      // by trading one ticker and getting free impact on related tickers
      Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
        if (updatedTicker === ticker) return; // Already tracked above
        const originalPrice = prices[updatedTicker];
        if (originalPrice && originalPrice > 0) {
          const trailingImpactPercent = Math.abs(updatedPrice - originalPrice) / originalPrice;
          userDailyImpact[updatedTicker] = (userDailyImpact[updatedTicker] || 0) + trailingImpactPercent;
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

      // Update user data
      dailyImpact[todayDate] = userDailyImpact;

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

      const updates = {
        cash: newCash,
        holdings: newHoldings,
        shorts: newShorts,
        marginUsed: newMarginUsed,
        dailyImpact,
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
        txLogEntry.marginRequired = currentPrice * amount * 0.5;
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

      // Compute achievement context inside transaction (we have the data here)
      let achievementCtx = { tradeValue: totalCost };
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
      }
      if (action === 'cover') {
        const shortCostBasis = shorts[ticker]?.costBasis || shorts[ticker]?.entryPrice || 0;
        const coverProfitPercent = shortCostBasis > 0 ? ((shortCostBasis - executionPrice) / shortCostBasis) * 100 : 0;
        achievementCtx.isColdBlooded = coverProfitPercent >= 20;
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
        remainingDailyImpact: MAX_DAILY_IMPACT - userDailyImpact[ticker],
        shortWarning,
        achievementCtx
      };
    });

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

        // NPC Lover: track cumulative profit from non-crew characters
        const achievementUpdate = {};
        if (ctx.npcProfit > 0) {
          achievementUpdate.npcProfit = admin.firestore.FieldValue.increment(ctx.npcProfit);
          const currentNpcProfit = (userDoc.data().npcProfit || 0) + ctx.npcProfit;
          if (currentNpcProfit >= 1000 && !currentAchievements.includes('NPC_LOVER')) newAchievements.push('NPC_LOVER');
        }

        // Unifier of Seoul: revoke if user sold their last share of any stock
        let revokeUnifier = ctx.soldLastShare && currentAchievements.includes('UNIFIER');

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

        // Revoke Unifier separately (can't arrayRemove + arrayUnion same field)
        if (revokeUnifier) {
          await db.collection('users').doc(uid).update({
            achievements: admin.firestore.FieldValue.arrayRemove('UNIFIER'),
            'achievementDates.UNIFIER': admin.firestore.FieldValue.delete()
          });
          result.revokedAchievements = ['UNIFIER'];
        }
      }
    } catch (achErr) {
      console.error('Achievement check after trade failed:', achErr);
    }

    // Remove internal context from response
    delete result.achievementCtx;
    return result;

  } catch (error) {
    // Re-throw HttpsErrors as-is
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Trade execution error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Trade execution failed: ' + error.message
    );
  }
});

/**
 * Daily Checkin - Server-side cash reward with streak tracking
 * Prevents direct cash manipulation via security rules
 */
exports.dailyCheckin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { ladderTopUp } = data; // Boolean flag for first-time ladder initialization

  try {
    return await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }

      const userData = userDoc.data();
      const now = new Date();
      const today = now.toISOString().split('T')[0];

      // Handle both string (old format) and Timestamp (new format)
      let lastCheckinDate = null;
      if (userData.lastCheckin) {
        if (typeof userData.lastCheckin === 'string') {
          // Old format: "Mon Jan 27 2025" from toDateString()
          // Convert to YYYY-MM-DD for comparison
          const parsedDate = new Date(userData.lastCheckin);
          if (!isNaN(parsedDate.getTime())) {
            lastCheckinDate = parsedDate.toISOString().split('T')[0];
          }
        } else if (typeof userData.lastCheckin.toDate === 'function') {
          // New format: Firestore Timestamp
          lastCheckinDate = userData.lastCheckin.toDate().toISOString().split('T')[0];
        } else if (userData.lastCheckin.seconds) {
          // Fallback: Plain timestamp object with seconds
          lastCheckinDate = new Date(userData.lastCheckin.seconds * 1000).toISOString().split('T')[0];
        }
      }

      // Check if already checked in today
      if (lastCheckinDate === today) {
        throw new functions.https.HttpsError('failed-precondition', 'Already checked in today.');
      }

      // Calculate streak
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split('T')[0];

      const currentStreak = userData.checkinStreak || 0;
      const newStreak = lastCheckinDate === yesterdayDate ? currentStreak + 1 : 1;

      // Flat $300 daily check-in reward
      const checkinReward = 300;

      // Compute week ID for weekly missions
      const weekStartDate = new Date(now);
      weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay() + 1);
      if (weekStartDate > now) weekStartDate.setDate(weekStartDate.getDate() - 7);
      const checkinWeekId = weekStartDate.toISOString().split('T')[0];

      // Update user document
      const updates = {
        cash: (userData.cash || 0) + checkinReward,
        lastCheckin: admin.firestore.Timestamp.now(),
        checkinStreak: newStreak,
        totalCheckins: (userData.totalCheckins || 0) + 1,
        // Mission tracking (server-side)
        [`dailyMissions.${today}.checkedIn`]: true,
        [`weeklyMissions.${checkinWeekId}.checkinDays.${today}`]: true
      };

      // Ladder game: $500 start for new players, top up to $100 if below for existing
      const ladderRef = db.collection('ladderGameUsers').doc(uid);
      const ladderDoc = await transaction.get(ladderRef);
      let ladderTopUpAmount = 0;

      if (!ladderDoc.exists) {
        // New player — initialize with $500
        ladderTopUpAmount = 500;
        updates.ladderGameInitialized = true;
        transaction.set(ladderRef, {
          uid,
          displayName: userData.displayName || 'Anonymous',
          balance: 500,
          totalDeposited: 0,
          totalWon: 0,
          totalLost: 0,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          currentStreak: 0,
          bestStreak: 0,
          lastPlayed: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp()
        });
      } else {
        // Existing player — top up to $100 if below
        const ladderBalance = ladderDoc.data().balance || 0;
        if (ladderBalance < 100) {
          ladderTopUpAmount = 100 - ladderBalance;
          transaction.update(ladderRef, { balance: 100 });
        }
      }

      // Append check-in to transaction log
      const existingLog = userData.transactionLog || [];
      const checkinEntry = {
        type: 'CHECKIN',
        timestamp: Date.now(),
        bonus: checkinReward,
        cashBefore: userData.cash || 0,
        cashAfter: (userData.cash || 0) + checkinReward
      };
      updates.transactionLog = [...existingLog, checkinEntry].slice(-100);

      transaction.update(userRef, updates);

      return {
        success: true,
        reward: checkinReward,
        newStreak,
        ladderTopUpAmount,
        totalCheckins: updates.totalCheckins
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    console.error('Daily checkin error:', error);
    throw new functions.https.HttpsError('internal', 'Checkin failed: ' + error.message);
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
  if (!amount || !Number.isFinite(amount) || amount <= 0) {
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
        highBetGames: 0,
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
      if (amount >= 50) userData.highBetGames = (userData.highBetGames || 0) + 1;
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

      // Send Discord notification for big wins
      if (won && (amount >= 5000 || userData.currentStreak >= 5)) {
        try {
          const embed = {
            color: 0xFFD700, // Gold
            title: '🎰 Ladder Game Big Win!',
            description: `**${username}** just ${userData.currentStreak >= 5 ? 'hit a hot streak' : 'made a huge bet'}!`,
            fields: [
              {
                name: 'Bet Amount',
                value: `$${amount.toLocaleString()}`,
                inline: true
              },
              {
                name: 'Payout',
                value: `$${payout.toLocaleString()}`,
                inline: true
              },
              {
                name: 'Current Streak',
                value: `${userData.currentStreak} win${userData.currentStreak === 1 ? '' : 's'}`,
                inline: true
              },
              {
                name: 'New Balance',
                value: `$${userData.balance.toLocaleString()}`,
                inline: true
              }
            ],
            timestamp: new Date().toISOString()
          };

          // Send asynchronously without blocking the transaction
          sendDiscordMessage(null, [embed]).catch(err => {
            console.error('Failed to send ladder game Discord notification:', err);
          });
        } catch (discordError) {
          console.error('Error preparing ladder Discord notification:', discordError);
        }
      }

      // Check ladder game achievements
      const currentAchievements = mainUser?.achievements || [];
      const ladderNewAchievements = [];
      const netProfit = userData.totalWon - userData.totalLost;
      if (netProfit >= 2500 && !currentAchievements.includes('COMPULSIVE_GAMBLER')) ladderNewAchievements.push('COMPULSIVE_GAMBLER');
      if ((userData.highBetGames || 0) >= 100 && !currentAchievements.includes('ADDICTED')) ladderNewAchievements.push('ADDICTED');

      if (ladderNewAchievements.length > 0) {
        const achUpdate = {
          achievements: admin.firestore.FieldValue.arrayUnion(...ladderNewAchievements)
        };
        for (const achId of ladderNewAchievements) {
          achUpdate[`achievementDates.${achId}`] = Date.now();
        }
        transaction.update(mainUserRef, achUpdate);
      }

      return {
        rungs,
        result,
        won,
        payout,
        newBalance: userData.balance,
        currentStreak: userData.currentStreak,
        newAchievements: ladderNewAchievements
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

  if (!amount || !Number.isFinite(amount) || amount <= 0) {
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

// Discord OAuth Authentication
exports.discordAuth = functions.https.onRequest(async (req, res) => {
  // Enable CORS
  res.set('Access-Control-Allow-Origin', 'https://stockism.app');

  const code = req.query.code;

  if (!code) {
    return res.status(400).send('Missing authorization code');
  }

  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = 'https://us-central1-stockism-abb28.cloudfunctions.net/discordAuth';

    // Exchange code for access token
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      }),
      {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
      }
    );

    const accessToken = tokenResponse.data.access_token;

    // Get Discord user info
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const discordUser = userResponse.data;
    const discordId = discordUser.id;
    const username = discordUser.username;
    const email = discordUser.email;

    // Create or get Firebase user
    let firebaseUid;
    try {
      const existingUser = await admin.auth().getUserByEmail(email);
      firebaseUid = existingUser.uid;
    } catch (error) {
      // User doesn't exist, create new one
      const newUser = await admin.auth().createUser({
        email: email,
        displayName: username,
        photoURL: discordUser.avatar
          ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
          : null
      });
      firebaseUid = newUser.uid;

      // Create user document in Firestore
      await db.collection('users').doc(firebaseUid).set({
        username: username,
        discordId: discordId,
        cash: STARTING_CASH,
        holdings: {},
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }

    // Create custom Firebase token
    const customToken = await admin.auth().createCustomToken(firebaseUid);

    // Redirect to app with token
    return res.redirect(`https://stockism.app/?discord_token=${customToken}`);

  } catch (error) {
    console.error('Discord auth error:', error);
    return res.status(500).send('Authentication failed');
  }
});

// Helper: Archive price history for a specific ticker (or all if null)
async function doArchivePriceHistory(ticker = null) {
  const MAX_HISTORY_SIZE = 1000;
  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();

  if (!marketSnap.exists) {
    return { success: false, error: 'Market document not found' };
  }

  const marketData = marketSnap.data();
  const priceHistory = marketData.priceHistory || {};
  const tickersToArchive = ticker ? [ticker] : Object.keys(priceHistory);
  let archivedCount = 0;

  for (const t of tickersToArchive) {
    const history = priceHistory[t] || [];

    if (history.length > MAX_HISTORY_SIZE) {
      const toArchive = history.slice(0, history.length - MAX_HISTORY_SIZE);
      const toKeep = history.slice(history.length - MAX_HISTORY_SIZE);

      const archiveRef = marketRef.collection('price_history').doc(t);
      const archiveSnap = await archiveRef.get();
      const existingArchive = archiveSnap.exists ? archiveSnap.data().history || [] : [];

      await archiveRef.set({
        history: [...existingArchive, ...toArchive].sort((a, b) => a.timestamp - b.timestamp),
        lastUpdated: admin.firestore.FieldValue.serverTimestamp()
      });

      await marketRef.update({
        [`priceHistory.${t}`]: toKeep
      });

      archivedCount++;
      console.log(`Archived ${toArchive.length} entries for ${t}, kept ${toKeep.length} recent entries`);
    }
  }

  return { success: true, archivedTickers: archivedCount, message: `Archived ${archivedCount} tickers` };
}

// Helper: Clean up old alertedThresholds
async function doCleanupAlertedThresholds() {
  const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();

  if (!marketSnap.exists) {
    return { success: false, error: 'Market document not found' };
  }

  const marketData = marketSnap.data();
  const alertedThresholds = marketData.alertedThresholds || {};
  const now = Date.now();
  const updates = {};
  let cleanedCount = 0;

  for (const [key, timestamp] of Object.entries(alertedThresholds)) {
    if (now - timestamp > MAX_AGE_MS) {
      updates[`alertedThresholds.${key}`] = admin.firestore.FieldValue.delete();
      cleanedCount++;
    }
  }

  if (cleanedCount > 0) {
    await marketRef.update(updates);
    console.log(`Cleaned up ${cleanedCount} old alertedThresholds entries`);
  }

  return { success: true, cleanedCount, message: `Cleaned up ${cleanedCount} old threshold alerts` };
}

// Archive price history when it gets too large (prevents 1MB document limit)
exports.archivePriceHistory = functions.https.onCall(async (data, context) => {
  // Admin-only: prevents unauthorized users from modifying market data
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  try {
    return await doArchivePriceHistory(data.ticker || null);
  } catch (error) {
    console.error('Archive error:', error);
    return { success: false, error: error.message };
  }
});

// Clean up old alertedThresholds (Discord alert cooldowns don't need long-term storage)
exports.cleanupAlertedThresholds = functions.https.onCall(async (data, context) => {
  // Admin-only: prevents unauthorized cleanup of alert state
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  try {
    return await doCleanupAlertedThresholds();
  } catch (error) {
    console.error('Cleanup error:', error);
    return { success: false, error: error.message };
  }
});

// Scheduled function: Auto-archive every 6 hours
exports.scheduledArchiving = functions.pubsub
  .schedule('every 6 hours')
  .timeZone('America/New_York')
  .onRun(async (context) => {
    console.log('Running scheduled archiving...');

    try {
      const archiveResult = await doArchivePriceHistory();
      console.log('Archive result:', archiveResult);
    } catch (error) {
      console.error('Scheduled archive failed:', error);
    }

    try {
      const cleanupResult = await doCleanupAlertedThresholds();
      console.log('Cleanup result:', cleanupResult);
    } catch (error) {
      console.error('Scheduled cleanup failed:', error);
    }

    return null;
  });

/**
 * Sync All Portfolio Values
 * Runs every 6 hours to recalculate and update all users' portfolio values
 * Ensures leaderboards and rankings reflect current market prices
 */
exports.syncAllPortfolios = functions.pubsub
  .schedule('every 6 hours')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      console.log('Starting portfolio sync for all users...');
      const startTime = Date.now();

      // Get current market prices
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return { success: false, error: 'Market data missing' };
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};

      // Get all users
      const usersSnapshot = await db.collection('users').get();
      console.log(`Found ${usersSnapshot.size} users to sync`);

      let syncedCount = 0;
      let errorCount = 0;
      const batch = db.batch();
      let batchCount = 0;

      for (const userDoc of usersSnapshot.docs) {
        try {
          const userData = userDoc.data();
          const userId = userDoc.id;

          // Calculate holdings value
          const holdings = userData.holdings || {};
          const holdingsValue = Object.entries(holdings).reduce((sum, [ticker, shares]) => {
            if (!shares || shares <= 0) return sum;
            const currentPrice = prices[ticker] || 0;
            return sum + (shares * currentPrice);
          }, 0);

          // Calculate shorts value
          const shorts = userData.shorts || {};
          const shortsValue = Object.entries(shorts).reduce((sum, [ticker, position]) => {
            if (!position || position.shares <= 0) return sum;
            const entryPrice = Number(position.costBasis || position.entryPrice) || 0;
            const currentPrice = prices[ticker] || entryPrice;
            const collateral = Number(position.margin) || 0;
            let value;
            if (position.system === 'v2') {
              // v2: margin + unrealized P&L (no proceeds in cash)
              value = collateral + (entryPrice - currentPrice) * position.shares;
            } else {
              // Legacy: margin collateral - cost to buy back shares
              value = collateral - (currentPrice * position.shares);
            }
            return sum + (isNaN(value) ? 0 : value);
          }, 0);

          // Calculate total portfolio value
          const cash = userData.cash || 0;
          const portfolioValue = Math.round((cash + holdingsValue + shortsValue) * 100) / 100;

          // Charge margin interest if due (piggybacks on 6-hour sync)
          const MARGIN_INTEREST_RATE = 0.005; // 0.5% daily
          const ONE_DAY_MS = 24 * 60 * 60 * 1000;
          let marginInterest = 0;
          const marginUsed = userData.marginUsed || 0;
          if (userData.marginEnabled && marginUsed > 0) {
            const lastCharge = userData.lastMarginInterestCharge || 0;
            if (startTime - lastCharge >= ONE_DAY_MS) {
              marginInterest = marginUsed * MARGIN_INTEREST_RATE;
            }
          }

          // Only update if different from stored value (avoid unnecessary writes)
          const storedValue = userData.portfolioValue || 0;
          const isDifferent = Math.abs(portfolioValue - storedValue) > 0.01 || marginInterest > 0;

          if (isDifferent) {
            const userRef = db.collection('users').doc(userId);
            const updateFields = {
              portfolioValue: portfolioValue,
              lastSyncedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            if (marginInterest > 0) {
              updateFields.marginUsed = marginUsed + marginInterest;
              updateFields.lastMarginInterestCharge = startTime;
            }
            batch.update(userRef, updateFields);
            batchCount++;
            syncedCount++;

            // Commit batch every 500 operations (Firestore limit)
            if (batchCount >= 500) {
              await batch.commit();
              console.log(`Committed batch of ${batchCount} updates`);
              batchCount = 0;
            }
          }
        } catch (error) {
          console.error(`Error syncing user ${userDoc.id}:`, error);
          errorCount++;
        }
      }

      // Commit remaining updates
      if (batchCount > 0) {
        await batch.commit();
        console.log(`Committed final batch of ${batchCount} updates`);
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const result = {
        success: true,
        totalUsers: usersSnapshot.size,
        synced: syncedCount,
        skipped: usersSnapshot.size - syncedCount - errorCount,
        errors: errorCount,
        elapsedSeconds: elapsed
      };

      console.log('Portfolio sync complete:', result);
      return result;

    } catch (error) {
      console.error('Portfolio sync failed:', error);
      return { success: false, error: error.message };
    }
  });

/**
 * Create a Limit Order (server-side validation)
 * Replaces direct client addDoc() to enforce business logic
 */
exports.createLimitOrder = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Block during weekly halt
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Market closed for chapter review. Trading resumes at 21:00 UTC.'
    );
  }

  const uid = context.auth.uid;
  const { ticker, type, shares, limitPrice, allowPartialFills } = data;

  // Validate ticker against character whitelist
  if (!ticker || !CHARACTERS.some(c => c.ticker === ticker)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }

  // Validate order type
  if (!type || !['BUY', 'SELL', 'SHORT', 'COVER'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid order type.');
  }

  // Validate shares (must be finite positive integer, max 10000)
  if (!shares || !Number.isFinite(shares) || !Number.isInteger(shares) || shares <= 0 || shares > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid share quantity.');
  }

  // Validate limit price (must be finite positive number, max 10000)
  if (!limitPrice || !Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid limit price.');
  }

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found.');
  }

  const userData = userDoc.data();

  // Check if user is banned
  if (userData.isBanned) {
    throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
  }

  // Check if user is bankrupt or in debt
  if (userData.isBankrupt) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot create orders while bankrupt.');
  }
  if ((userData.cash || 0) < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot create orders while in debt.');
  }

  // Fetch pending orders early (needed for validation checks below)
  const pendingOrders = await db.collection('limitOrders')
    .where('userId', '==', uid)
    .where('status', '==', 'PENDING')
    .get();

  if (pendingOrders.size >= 20) {
    throw new functions.https.HttpsError('resource-exhausted', 'Maximum 20 pending orders allowed.');
  }

  // Validate holdings for SELL orders (account for shares reserved by pending sells)
  if (type === 'SELL') {
    const currentHoldings = userData.holdings?.[ticker] || 0;
    if (currentHoldings < shares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient holdings to sell.');
    }
    const pendingSellShares = pendingOrders.docs
      .filter(doc => {
        const o = doc.data();
        return o.ticker === ticker && o.type === 'SELL';
      })
      .reduce((sum, doc) => sum + doc.data().shares, 0);
    if (currentHoldings < shares + pendingSellShares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient holdings (some shares reserved by pending orders).');
    }
  }

  // Validate short positions for COVER orders
  if (type === 'COVER') {
    const shortShares = userData.shorts?.[ticker]?.shares || 0;
    if (shortShares < shares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient short shares to cover.');
    }
  }

  // Anti-manipulation: Block SELL limit if user has an active short on same ticker
  if (type === 'SELL') {
    const shortShares = userData.shorts?.[ticker]?.shares || 0;
    if (shortShares > 0) {
      throw new functions.https.HttpsError('failed-precondition',
        'Cannot place a sell order while you have an active short on this stock.');
    }
  }

  // Block duplicate limit orders on same ticker + type
  const existingOrderOnTicker = pendingOrders.docs.some(doc => {
    const o = doc.data();
    return o.ticker === ticker && o.type === type;
  });
  if (existingOrderOnTicker) {
    throw new functions.https.HttpsError('already-exists',
      `You already have a pending ${type} order on ${ticker}. Cancel it first.`);
  }

  // Create the order
  const expiresAt = Date.now() + (30 * 24 * 60 * 60 * 1000); // 30 days
  const orderRef = await db.collection('limitOrders').add({
    userId: uid,
    ticker,
    type,
    shares,
    limitPrice,
    allowPartialFills: !!allowPartialFills,
    status: 'PENDING',
    filledShares: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, orderId: orderRef.id };
});

/**
 * Check and Execute Limit Orders
 * Runs every 2 minutes to check if any pending limit orders should execute
 */
exports.checkLimitOrders = functions.pubsub
  .schedule('every 2 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    // Skip during weekly halt — don't execute pending orders
    if (isWeeklyTradingHalt()) {
      console.log('Skipping limit order check — weekly trading halt active');
      return { success: true, skipped: true, reason: 'weekly_halt' };
    }

    try {
      console.log('Checking limit orders...');
      const startTime = Date.now();

      // Get current market prices
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return { success: false, error: 'Market data missing' };
      }

      const marketData = marketSnap.data();

      // Also skip if admin emergency halt is active
      if (marketData.marketHalted) {
        console.log('Skipping limit order check — emergency halt active');
        return { success: true, skipped: true, reason: 'emergency_halt' };
      }

      const prices = marketData.prices || {};

      // Get all pending limit orders
      const ordersSnapshot = await db.collection('limitOrders')
        .where('status', '==', 'PENDING')
        .get();

      console.log(`Found ${ordersSnapshot.size} pending limit orders`);

      let executed = 0;
      let canceled = 0;
      let expired = 0;
      const now = Date.now();

      // Per-ticker execution cap: max 3 orders per ticker per cycle
      const ORDERS_PER_TICKER_PER_CYCLE = 3;
      const tickerExecutionCount = {};

      for (const orderDoc of ordersSnapshot.docs) {
        try {
          const order = orderDoc.data();
          const orderId = orderDoc.id;

          // Check expiration (30 days)
          if (order.expiresAt && now > order.expiresAt) {
            await db.collection('limitOrders').doc(orderId).update({
              status: 'EXPIRED',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Expired order ${orderId}`);
            expired++;
            continue;
          }

          // Cancel orders for bankrupt/indebted users
          const orderUserDoc = await db.collection('users').doc(order.userId).get();
          if (orderUserDoc.exists) {
            const orderUserData = orderUserDoc.data();
            if (orderUserData.isBankrupt || (orderUserData.cash || 0) < 0) {
              await db.collection('limitOrders').doc(orderId).update({
                status: 'CANCELLED',
                cancelReason: 'User bankrupt or in debt',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              console.log(`Cancelled order ${orderId}: user bankrupt/in debt`);
              canceled++;
              continue;
            }
          }

          const currentPrice = prices[order.ticker];
          if (!currentPrice) {
            console.log(`No price data for ${order.ticker}, skipping order ${orderId}`);
            continue;
          }

          // Check if order should execute
          let shouldExecute = false;
          if (order.type === 'BUY' && currentPrice <= order.limitPrice) {
            shouldExecute = true;
          } else if (order.type === 'SELL' && currentPrice >= order.limitPrice) {
            shouldExecute = true;
          }

          if (!shouldExecute) {
            continue;
          }

          // Per-ticker throttle: max 3 orders per ticker per cycle
          const tickerCount = tickerExecutionCount[order.ticker] || 0;
          if (tickerCount >= ORDERS_PER_TICKER_PER_CYCLE) {
            console.log(`Throttled order ${orderId}: ${order.ticker} already had ${tickerCount} executions this cycle`);
            continue; // Will be picked up in the next 2-minute cycle
          }

          console.log(`Order ${orderId} should execute: ${order.type} ${order.shares} ${order.ticker} @ $${order.limitPrice} (current: $${currentPrice})`);

          // Execute trade in transaction to prevent race conditions
          const userRef = db.collection('users').doc(order.userId);

          try {
            await db.runTransaction(async (transaction) => {
              const userSnap = await transaction.get(userRef);
              const freshMarketSnap = await transaction.get(marketRef);

              if (!userSnap.exists) {
                throw new Error('User not found');
              }
              if (!freshMarketSnap.exists) {
                throw new Error('Market data not found');
              }

              const userData = userSnap.data();
              const freshPrices = freshMarketSnap.data().prices || {};
              const freshPrice = freshPrices[order.ticker] || currentPrice;

              // Re-validate limit condition with fresh price
              if (order.type === 'BUY' && freshPrice > order.limitPrice) {
                throw new Error('Price no longer meets limit condition');
              }
              if (order.type === 'SELL' && freshPrice < order.limitPrice) {
                throw new Error('Price no longer meets limit condition');
              }

              // Check if user is bankrupt/in debt (could have changed since order was created)
              if (userData.isBankrupt || (userData.cash || 0) < 0) {
                throw new Error('User is bankrupt or in debt');
              }

              // Validate user has sufficient funds/shares
              if (order.type === 'BUY') {
                const totalCost = freshPrice * order.shares;
                if (userData.cash < totalCost) {
                  if (order.allowPartialFills) {
                    const affordableShares = freshPrice > 0 ? Math.floor(userData.cash / freshPrice) : 0;
                    if (affordableShares > 0) {
                      order.shares = affordableShares;
                      console.log(`Partial fill: can only afford ${affordableShares} shares`);
                    } else {
                      throw new Error('Insufficient cash');
                    }
                  } else {
                    throw new Error('Insufficient cash');
                  }
                }
              } else if (order.type === 'SELL') {
                const userShares = userData.holdings?.[order.ticker] || 0;
                if (userShares < order.shares) {
                  if (order.allowPartialFills) {
                    if (userShares > 0) {
                      order.shares = userShares;
                      console.log(`Partial fill: only have ${userShares} shares`);
                    } else {
                      throw new Error('Insufficient shares');
                    }
                  } else {
                    throw new Error('Insufficient shares');
                  }
                }
              }

              // Calculate price impact (same formula as executeTrade)
              // Limit orders are exempt from daily impact cap — they represent
              // genuine market pressure (e.g. selling during a squeeze)
              const priceImpact = freshPrice * BASE_IMPACT * Math.sqrt(order.shares / BASE_LIQUIDITY);
              const maxImpact = freshPrice * MAX_PRICE_CHANGE_PERCENT;
              const effectiveImpact = Math.min(priceImpact, maxImpact);

              // Execute the trade
              if (order.type === 'BUY') {
                // Price goes UP on buy
                const newMarketPrice = Math.round((freshPrice + effectiveImpact) * 100) / 100;
                const askPrice = newMarketPrice * (1 + BID_ASK_SPREAD / 2);
                const totalCost = askPrice * order.shares;

                // Re-validate with actual cost
                if (userData.cash < totalCost) {
                  throw new Error('Insufficient cash after price impact');
                }

                const currentHoldings = userData.holdings?.[order.ticker] || 0;
                const currentCostBasis = userData.costBasis?.[order.ticker] || 0;
                const newHoldings = currentHoldings + order.shares;
                const newCostBasis = currentHoldings > 0
                  ? (newHoldings > 0 ? ((currentCostBasis * currentHoldings) + (askPrice * order.shares)) / newHoldings : askPrice)
                  : askPrice;

                transaction.update(userRef, {
                  cash: admin.firestore.FieldValue.increment(-totalCost),
                  [`holdings.${order.ticker}`]: newHoldings,
                  [`costBasis.${order.ticker}`]: Math.round(newCostBasis * 100) / 100,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1)
                });

                // Apply price impact to market (only if there's actual impact)
                if (effectiveImpact > 0) {
                  transaction.update(marketRef, {
                    [`prices.${order.ticker}`]: newMarketPrice,
                    [`priceHistory.${order.ticker}`]: admin.firestore.FieldValue.arrayUnion({
                      timestamp: Date.now(),
                      price: newMarketPrice
                    })
                  });
                }

                console.log(`Executed BUY: ${order.shares} ${order.ticker} @ $${askPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              } else if (order.type === 'SELL') {
                // Price goes DOWN on sell
                const newMarketPrice = Math.max(0.01, Math.round((freshPrice - effectiveImpact) * 100) / 100);
                const bidPrice = newMarketPrice * (1 - BID_ASK_SPREAD / 2);
                const totalRevenue = bidPrice * order.shares;

                const currentHoldings = userData.holdings?.[order.ticker] || 0;
                const newHoldings = currentHoldings - order.shares;

                const updates = {
                  cash: admin.firestore.FieldValue.increment(totalRevenue),
                  [`holdings.${order.ticker}`]: newHoldings,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1)
                };

                if (newHoldings <= 0) {
                  updates[`holdings.${order.ticker}`] = admin.firestore.FieldValue.delete();
                  updates[`costBasis.${order.ticker}`] = admin.firestore.FieldValue.delete();
                  updates[`lowestWhileHolding.${order.ticker}`] = admin.firestore.FieldValue.delete();
                }

                transaction.update(userRef, updates);

                // Apply price impact to market (only if there's actual impact)
                if (effectiveImpact > 0) {
                  transaction.update(marketRef, {
                    [`prices.${order.ticker}`]: newMarketPrice,
                    [`priceHistory.${order.ticker}`]: admin.firestore.FieldValue.arrayUnion({
                      timestamp: Date.now(),
                      price: newMarketPrice
                    })
                  });
                }

                console.log(`Executed SELL: ${order.shares} ${order.ticker} @ $${bidPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              }
            });
          } catch (transactionError) {
            // Transaction failed - cancel the order
            console.log(`Transaction failed for order ${orderId}: ${transactionError.message}`);
            await db.collection('limitOrders').doc(orderId).update({
              status: 'CANCELED',
              cancelReason: transactionError.message,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            canceled++;
            continue;
          }

          // Track per-ticker execution count for throttling
          tickerExecutionCount[order.ticker] = (tickerExecutionCount[order.ticker] || 0) + 1;

          // Update order status
          const isPartialFill = order.allowPartialFills && (
            (order.type === 'BUY' && order.shares < orderDoc.data().shares) ||
            (order.type === 'SELL' && order.shares < orderDoc.data().shares)
          );

          await db.collection('limitOrders').doc(orderId).update({
            status: isPartialFill ? 'PARTIALLY_FILLED' : 'FILLED',
            filledShares: order.shares,
            executedPrice: currentPrice,
            executedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          executed++;

        } catch (error) {
          console.error(`Error processing order ${orderDoc.id}:`, error);
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const result = {
        success: true,
        totalOrders: ordersSnapshot.size,
        executed,
        canceled,
        expired,
        elapsedSeconds: elapsed
      };

      console.log('Limit order check complete:', result);
      return result;

    } catch (error) {
      console.error('Limit order check failed:', error);
      return { success: false, error: error.message };
    }
  });

// ============================================
// SECURE OPERATIONS - Moved from client-side
// These operations modify protected fields (cash, holdings, shorts, marginUsed)
// and must go through Cloud Functions to prevent exploits
// ============================================

/**
 * Claim mission reward (daily or weekly)
 */
exports.claimMissionReward = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { missionId, type } = data;

  if (!missionId || !type || !['daily', 'weekly'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid mission data.');
  }

  const userRef = db.collection('users').doc(uid);

  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(marketRef)
    ]);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    const prices = marketDoc.exists ? (marketDoc.data().prices || {}) : {};

    // Get today's date and week ID
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    if (weekStart > now) weekStart.setDate(weekStart.getDate() - 7);
    const weekId = weekStart.toISOString().split('T')[0];

    // Check if already claimed
    if (type === 'daily') {
      const claimed = userData.dailyMissions?.[today]?.claimed?.[missionId];
      if (claimed) throw new functions.https.HttpsError('already-exists', 'Already claimed.');
    } else {
      const claimed = userData.weeklyMissions?.[weekId]?.claimed?.[missionId];
      if (claimed) throw new functions.https.HttpsError('already-exists', 'Already claimed.');
    }

    // Use server-defined reward amount (ignoring client-provided reward entirely)
    const definedReward = MISSION_REWARDS[missionId];
    if (!definedReward) {
      throw new functions.https.HttpsError('invalid-argument', 'Unknown mission.');
    }
    const reward = definedReward;

    // Verify mission is actually completed server-side
    if (type === 'daily') {
      const dailyProgress = userData.dailyMissions?.[today] || {};
      const checker = DAILY_MISSION_CHECKS[missionId];
      if (!checker) {
        throw new functions.https.HttpsError('invalid-argument', 'Unknown daily mission.');
      }
      if (!checker(dailyProgress, userData, prices)) {
        throw new functions.https.HttpsError('failed-precondition', 'Mission not completed yet.');
      }
    } else {
      const weeklyProgress = userData.weeklyMissions?.[weekId] || {};
      const checker = WEEKLY_MISSION_CHECKS[missionId];
      if (!checker) {
        throw new functions.https.HttpsError('invalid-argument', 'Unknown weekly mission.');
      }
      if (!checker(weeklyProgress, userData, prices)) {
        throw new functions.https.HttpsError('failed-precondition', 'Mission not completed yet.');
      }
    }

    const newTotal = (userData.totalMissionsCompleted || 0) + 1;
    const updates = {
      cash: (userData.cash || 0) + reward,
      totalMissionsCompleted: newTotal
    };

    if (type === 'daily') {
      updates[`dailyMissions.${today}.claimed.${missionId}`] = true;
    } else {
      updates[`weeklyMissions.${weekId}.claimed.${missionId}`] = true;
    }

    // Check mission achievements
    const achievements = userData.achievements || [];
    if (newTotal >= 100 && !achievements.includes('MISSION_100')) {
      updates.achievements = admin.firestore.FieldValue.arrayUnion('MISSION_100');
    } else if (newTotal >= 50 && !achievements.includes('MISSION_50')) {
      updates.achievements = admin.firestore.FieldValue.arrayUnion('MISSION_50');
    } else if (newTotal >= 10 && !achievements.includes('MISSION_10')) {
      updates.achievements = admin.firestore.FieldValue.arrayUnion('MISSION_10');
    }

    transaction.update(userRef, updates);
    return { success: true, reward, newTotal };
  });
});

/**
 * Purchase a pin or extra pin slot from the shop
 */
exports.purchasePin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { action, pinId, slotType } = data;

  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();

    if (action === 'buyPin') {
      const PIN_CATALOG = {
        alpha_tester: { price: 1 },
        jay_j_high: { price: 750 },
        jace_j_high: { price: 750 },
        vasco_j_high: { price: 2000, requiredCheckinStreak: 5 },
        zack_j_high: { price: 2000, requiredCheckinStreak: 5 },
        daniel_j_high: { price: 5000, requiredCheckinStreak: 7 }
      };
      const pinInfo = PIN_CATALOG[pinId];
      if (!pinInfo) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid pin.');
      }
      const validCost = pinInfo.price;
      if ((userData.cash || 0) < validCost) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
      }
      if (pinInfo.requiredCheckinStreak && (userData.checkinStreak || 0) < pinInfo.requiredCheckinStreak) {
        throw new functions.https.HttpsError('failed-precondition', `Requires ${pinInfo.requiredCheckinStreak}-day check-in streak.`);
      }
      const owned = userData.ownedShopPins || [];
      if (owned.includes(pinId)) {
        throw new functions.https.HttpsError('already-exists', 'Already owned.');
      }
      transaction.update(userRef, {
        ownedShopPins: admin.firestore.FieldValue.arrayUnion(pinId),
        cash: (userData.cash || 0) - validCost
      });
      return { success: true, cost: validCost };

    } else if (action === 'buySlot') {
      // Slot costs: achievement = $5000, shop = $7500
      const slotCosts = { achievement: 5000, shop: 7500 };
      const validCost = slotCosts[slotType];
      if (!validCost) throw new functions.https.HttpsError('invalid-argument', 'Invalid slot type.');
      if ((userData.cash || 0) < validCost) {
        throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
      }
      const field = slotType === 'achievement' ? 'extraAchievementSlot' : 'extraShopSlot';
      if (userData[field]) {
        throw new functions.https.HttpsError('already-exists', 'Slot already purchased.');
      }
      transaction.update(userRef, {
        [field]: true,
        cash: (userData.cash || 0) - validCost
      });
      return { success: true, cost: validCost };

    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid action.');
    }
  });
});

/**
 * Place a prediction bet
 */
exports.placeBet = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { predictionId, option, amount } = data;

  if (!predictionId || !option || !amount || !Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid bet data.');
  }

  const userRef = db.collection('users').doc(uid);
  const predictionsRef = db.collection('predictions').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, predictionsDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(predictionsRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!predictionsDoc.exists) throw new functions.https.HttpsError('not-found', 'Predictions not found.');

    const userData = userDoc.data();
    const predictionsData = predictionsDoc.data();
    const predictionsList = predictionsData.list || [];

    // Find the prediction
    const predictionIndex = predictionsList.findIndex(p => p.id === predictionId);
    if (predictionIndex === -1) throw new functions.https.HttpsError('not-found', 'Prediction not found.');

    const prediction = predictionsList[predictionIndex];
    if (prediction.resolved || (prediction.endsAt && prediction.endsAt < Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'Betting has ended.');
    }

    // Check cash
    if ((userData.cash || 0) < amount) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    // Check bet limit (can't bet more than total invested)
    const holdings = userData.holdings || {};
    const totalInvested = Object.values(holdings).reduce((sum, s) => sum + s, 0);
    if (totalInvested <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Must invest in stocks before betting.');
    }

    // Check existing bet on different option
    const existingBet = userData.bets?.[predictionId];
    if (existingBet && existingBet.option !== option) {
      throw new functions.https.HttpsError('failed-precondition', 'Already bet on a different option.');
    }

    // Update prediction pools
    const updatedList = [...predictionsList];
    const updatedPrediction = { ...updatedList[predictionIndex] };
    const newPools = { ...(updatedPrediction.pools || {}) };
    newPools[option] = (newPools[option] || 0) + amount;
    updatedPrediction.pools = newPools;
    updatedList[predictionIndex] = updatedPrediction;

    const newBetAmount = (existingBet?.amount || 0) + amount;
    const today = new Date().toISOString().split('T')[0];

    transaction.update(predictionsRef, { list: updatedList });
    transaction.update(userRef, {
      cash: (userData.cash || 0) - amount,
      [`bets.${predictionId}`]: {
        option,
        amount: newBetAmount,
        placedAt: Date.now(),
        question: prediction.question
      },
      [`dailyMissions.${today}.placedBet`]: true
    });

    return { success: true, newBetAmount };
  });
});

/**
 * Claim prediction payout (winning or losing)
 */
exports.claimPredictionPayout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { predictionId } = data;

  if (!predictionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing prediction ID.');
  }

  const userRef = db.collection('users').doc(uid);
  const predictionsRef = db.collection('predictions').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, predictionsDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(predictionsRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!predictionsDoc.exists) throw new functions.https.HttpsError('not-found', 'Predictions not found.');

    const userData = userDoc.data();
    const predictionsData = predictionsDoc.data();
    const predictionsList = predictionsData.list || [];

    const prediction = predictionsList.find(p => p.id === predictionId);
    if (!prediction) throw new functions.https.HttpsError('not-found', 'Prediction not found.');
    if (!prediction.resolved) throw new functions.https.HttpsError('failed-precondition', 'Not resolved yet.');

    const userBet = userData.bets?.[predictionId];
    if (!userBet) throw new functions.https.HttpsError('not-found', 'No bet found.');
    if (userBet.paid) throw new functions.https.HttpsError('already-exists', 'Already paid out.');

    const updates = {};

    if (userBet.option === prediction.outcome) {
      // Winner - calculate payout
      const options = prediction.options || ['Yes', 'No'];
      const pools = prediction.pools || {};
      const winningPool = pools[prediction.outcome] || 0;
      const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);

      let payout = userBet.amount;
      if (winningPool > 0 && totalPool > 0) {
        const userShare = userBet.amount / winningPool;
        payout = userShare * totalPool;
      }

      const newPredictionWins = (userData.predictionWins || 0) + 1;
      updates.cash = (userData.cash || 0) + payout;
      updates[`bets.${predictionId}.paid`] = true;
      updates[`bets.${predictionId}.payout`] = payout;
      updates.predictionWins = newPredictionWins;

      // Check achievements
      const achievements = userData.achievements || [];
      if (newPredictionWins >= 10 && !achievements.includes('PROPHET')) {
        updates.achievements = admin.firestore.FieldValue.arrayUnion('PROPHET');
      } else if (newPredictionWins >= 3 && !achievements.includes('ORACLE')) {
        updates.achievements = admin.firestore.FieldValue.arrayUnion('ORACLE');
      }

      transaction.update(userRef, updates);
      return { success: true, won: true, payout, newPredictionWins };
    } else {
      // Loser - mark as processed
      transaction.update(userRef, {
        [`bets.${predictionId}.paid`]: true,
        [`bets.${predictionId}.payout`]: 0
      });
      return { success: true, won: false, payout: 0 };
    }
  });
});

/**
 * Buy IPO shares
 */
exports.buyIPOShares = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Block during weekly halt
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Market closed for chapter review. Trading resumes at 21:00 UTC.'
    );
  }

  const uid = context.auth.uid;
  const { ticker, quantity } = data;

  if (!ticker || !quantity || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0 || quantity > 10) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid IPO purchase data.');
  }

  const validTicker = CHARACTERS.some(c => c.ticker === ticker);
  if (!validTicker) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }

  const userRef = db.collection('users').doc(uid);
  const ipoRef = db.collection('market').doc('ipos');
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, ipoDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(ipoRef),
      transaction.get(marketRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!ipoDoc.exists) throw new functions.https.HttpsError('not-found', 'IPO data not found.');

    const userData = userDoc.data();
    const ipoData = ipoDoc.data();
    const ipoList = ipoData.list || [];

    const ipo = ipoList.find(i => i.ticker === ticker);
    if (!ipo) throw new functions.https.HttpsError('not-found', 'IPO not found.');

    // Validate IPO is active
    const now = Date.now();
    if (ipo.status !== 'active' || !ipo.ipoStartTime || now < ipo.ipoStartTime || now > ipo.ipoEndTime) {
      throw new functions.https.HttpsError('failed-precondition', 'IPO is not active.');
    }

    // Check shares remaining
    const sharesRemaining = ipo.sharesRemaining || 0;
    if (quantity > sharesRemaining) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough shares available.');
    }

    // Check per-user limit (10 max)
    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > 10) {
      throw new functions.https.HttpsError('failed-precondition', 'Exceeds per-user IPO limit (10).');
    }

    // Check cash
    const totalCost = ipo.basePrice * quantity;
    if ((userData.cash || 0) < totalCost) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    // Calculate new cost basis
    const currentHoldings = userData.holdings?.[ticker] || 0;
    const currentCostBasis = userData.costBasis?.[ticker] || ipo.basePrice;
    const newHoldings = currentHoldings + quantity;
    const newCostBasis = currentHoldings > 0
      ? (newHoldings > 0 ? ((currentCostBasis * currentHoldings) + (ipo.basePrice * quantity)) / newHoldings : ipo.basePrice)
      : ipo.basePrice;

    // Update user
    transaction.update(userRef, {
      cash: (userData.cash || 0) - totalCost,
      [`holdings.${ticker}`]: newHoldings,
      [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
      [`ipoPurchases.${ticker}`]: userIPOPurchases + quantity,
      [`lastBuyTime.${ticker}`]: now,
      totalTrades: (userData.totalTrades || 0) + 1
    });

    // Update IPO shares remaining
    const updatedList = ipoList.map(i =>
      i.ticker === ticker ? { ...i, sharesRemaining: sharesRemaining - quantity } : i
    );
    transaction.update(ipoRef, { list: updatedList });

    // Initialize price if not set
    if (marketDoc.exists) {
      const marketData = marketDoc.data();
      if (!marketData.prices?.[ticker]) {
        transaction.update(marketRef, {
          [`prices.${ticker}`]: ipo.basePrice,
          [`volumes.${ticker}`]: quantity
        });
      }
    }

    return { success: true, totalCost, newHoldings };
  });
});

/**
 * Repay margin debt
 */
exports.repayMargin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { amount } = data;

  if (!amount || !Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid repay amount.');
  }

  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    const marginUsed = userData.marginUsed || 0;

    if (marginUsed <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'No margin debt.');
    }
    if ((userData.cash || 0) < amount) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    const repayAmount = Math.min(amount, marginUsed);
    const newMarginUsed = marginUsed - repayAmount;

    transaction.update(userRef, {
      cash: (userData.cash || 0) - repayAmount,
      marginUsed: newMarginUsed < 0.01 ? 0 : Math.round(newMarginUsed * 100) / 100,
      marginCallAt: null
    });

    return { success: true, repaid: repayAmount, remaining: newMarginUsed < 0.01 ? 0 : newMarginUsed };
  });
});

/**
 * Bankruptcy bailout - reset to $500
 */
exports.bailout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    if ((userData.cash || 0) >= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Not in debt.');
    }

    // Enforce 24-hour cooldown between bailouts
    if (userData.lastBailout && (Date.now() - userData.lastBailout) < 86400000) {
      throw new functions.https.HttpsError('failed-precondition', 'Bailout available once per 24 hours.');
    }

    const currentCrew = userData.crew;
    const crewHistory = userData.crewHistory || [];
    const updatedHistory = currentCrew && !crewHistory.includes(currentCrew)
      ? [...crewHistory, currentCrew]
      : crewHistory;

    transaction.update(userRef, {
      cash: 500,
      holdings: {},
      shorts: {},
      costBasis: {},
      portfolioValue: 500,
      marginEnabled: false,
      marginUsed: 0,
      bankruptAt: null,
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      crewHistory: updatedHistory,
      lastBailout: Date.now(),
      shortHistory: {},
      lowestWhileHolding: {},
      dailyImpact: {}
    });

    return { success: true, hadCrew: !!currentCrew };
  });
});

/**
 * Leave crew with 15% penalty
 */
exports.leaveCrew = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(marketRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    if (!userData.crew) {
      throw new functions.https.HttpsError('failed-precondition', 'Not in a crew.');
    }
    if ((userData.cash || 0) < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot leave crew while in debt.');
    }

    const prices = marketDoc.exists ? (marketDoc.data().prices || {}) : {};
    const penaltyRate = 0.15;

    // 15% cash penalty
    const newCash = Math.floor((userData.cash || 0) * (1 - penaltyRate));

    // 15% holdings penalty (floor to never take more than 15%)
    const newHoldings = {};
    let holdingsValueTaken = 0;
    Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
      if (shares > 0) {
        const sharesToTake = Math.floor(shares * penaltyRate);
        const sharesToKeep = shares - sharesToTake;
        newHoldings[ticker] = sharesToKeep;
        holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
      }
    });

    const totalTaken = ((userData.cash || 0) - newCash) + holdingsValueTaken;
    const newPortfolioValue = (userData.portfolioValue || 0) - totalTaken;

    transaction.update(userRef, {
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      cash: newCash,
      holdings: newHoldings,
      portfolioValue: Math.max(0, newPortfolioValue),
      lastCrewChange: Date.now()
    });

    return { success: true, totalTaken, crewLeft: userData.crew };
  });
});

/**
 * Toggle margin trading (enable/disable)
 */
exports.toggleMargin = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { enable } = data;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();

    if (enable) {
      // Check eligibility: $2000 min cash
      const isAdmin = uid === ADMIN_UID;
      if (!isAdmin && (userData.cash || 0) < 2000) {
        throw new functions.https.HttpsError('failed-precondition', 'Need $2,000 minimum cash.');
      }
      transaction.update(userRef, {
        marginEnabled: true,
        marginUsed: 0,
        marginEnabledAt: Date.now()
      });
    } else {
      // Check no outstanding margin
      if ((userData.marginUsed || 0) >= 0.01) {
        throw new functions.https.HttpsError('failed-precondition', 'Repay all margin debt first.');
      }
      transaction.update(userRef, {
        marginEnabled: false,
        marginUsed: 0
      });
    }

    return { success: true, marginEnabled: enable };
  });
});

/**
 * Charge daily margin interest
 */
exports.chargeMarginInterest = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const MARGIN_INTEREST_RATE = 0.005; // 0.5% daily
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    const marginUsed = userData.marginUsed || 0;

    if (marginUsed <= 0 || !userData.marginEnabled) {
      return { success: true, charged: 0 };
    }

    const lastCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    const oneDayMs = 24 * 60 * 60 * 1000;

    if (now - lastCharge < oneDayMs) {
      return { success: true, charged: 0, reason: 'Already charged today' };
    }

    const interest = marginUsed * MARGIN_INTEREST_RATE;
    transaction.update(userRef, {
      marginUsed: marginUsed + interest,
      lastMarginInterestCharge: now
    });

    return { success: true, charged: interest };
  });
});

/**
 * Server-side short margin call checker
 * Runs every 5 minutes - checks all users with active shorts
 * If equity ratio drops below 25%, force-covers the position
 * Uses 50% dampened price impact to prevent cascading short squeezes
 */
exports.checkShortMarginCalls = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping short margin calls — weekly trading halt active');
      return null;
    }

    const startTime = Date.now();
    console.log('Checking short margin calls...');

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return null;
      }

      const marketData = marketSnap.data();
      if (marketData.marketHalted) {
        console.log('Skipping short margin calls — emergency halt active');
        return null;
      }
      const prices = marketData.prices || {};

      // Query all users - filter for shorts client-side since Firestore
      // can't query on map key existence efficiently
      const usersSnap = await db.collection('users').get();

      let liquidatedCount = 0;
      let checkedCount = 0;
      let throttledCount = 0;
      const MARGIN_CALL_THRESHOLD = 0.25; // 25% equity ratio
      const DAMPENING_FACTOR = 0.5; // 50% reduced price impact for forced liquidations
      const COVERS_PER_TICKER_PER_CYCLE = 3; // Max forced covers per ticker per 5-min cycle
      const tickerCoverCount = {};

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const shorts = userData.shorts || {};
        const shortEntries = Object.entries(shorts).filter(
          ([, pos]) => pos && pos.shares > 0
        );

        if (shortEntries.length === 0) continue;
        checkedCount++;

        for (const [ticker, position] of shortEntries) {
          const currentPrice = prices[ticker];
          if (!currentPrice) continue;

          // Throttle: max 3 forced covers per ticker per cycle to prevent cascading spikes
          if ((tickerCoverCount[ticker] || 0) >= COVERS_PER_TICKER_PER_CYCLE) {
            throttledCount++;
            continue; // Will be picked up in next 5-minute cycle
          }

          const costBasis = position.costBasis || position.entryPrice || currentPrice;
          const marginDeposited = position.margin || (costBasis * position.shares * 0.5);

          // Calculate equity: margin deposited minus unrealized loss
          const unrealizedLoss = (currentPrice - costBasis) * position.shares;
          const equity = marginDeposited - unrealizedLoss;
          const positionValue = currentPrice * position.shares;
          const equityRatio = positionValue > 0 ? equity / positionValue : 0;

          if (equityRatio < MARGIN_CALL_THRESHOLD) {
            // Force-cover this position
            try {
              await db.runTransaction(async (transaction) => {
                // Re-read latest data inside transaction
                const freshUserDoc = await transaction.get(db.collection('users').doc(userDoc.id));
                const freshMarketDoc = await transaction.get(marketRef);

                if (!freshUserDoc.exists || !freshMarketDoc.exists) return;

                const freshUserData = freshUserDoc.data();
                const freshShorts = freshUserData.shorts || {};
                const freshPosition = freshShorts[ticker];

                if (!freshPosition || freshPosition.shares <= 0) return;

                const freshPrices = freshMarketDoc.data().prices || {};
                const freshPrice = freshPrices[ticker];
                if (!freshPrice) return;

                // Re-check equity ratio with fresh data
                const freshCostBasis = freshPosition.costBasis || freshPosition.entryPrice || freshPrice;
                const freshMargin = freshPosition.margin || (freshCostBasis * freshPosition.shares * 0.5);
                const freshLoss = (freshPrice - freshCostBasis) * freshPosition.shares;
                const freshEquity = freshMargin - freshLoss;
                const freshPositionValue = freshPrice * freshPosition.shares;
                const freshEquityRatio = freshPositionValue > 0 ? freshEquity / freshPositionValue : 0;

                if (freshEquityRatio >= MARGIN_CALL_THRESHOLD) return; // No longer underwater

                // Calculate dampened price impact for forced cover (50% reduced)
                const priceImpact = freshPrice * BASE_IMPACT * Math.sqrt(freshPosition.shares / BASE_LIQUIDITY);
                const dampenedImpact = priceImpact * DAMPENING_FACTOR;
                const maxImpact = freshPrice * MAX_PRICE_CHANGE_PERCENT;
                const cappedImpact = Math.min(dampenedImpact, maxImpact);
                const newPrice = Math.round((freshPrice + cappedImpact) * 100) / 100;

                // Calculate cover cost and margin return
                const coverPrice = newPrice;
                let cashChange;
                if (freshPosition.system === 'v2') {
                  // v2: margin back + profit/loss
                  const shortProfit = (freshCostBasis - coverPrice) * freshPosition.shares;
                  cashChange = freshMargin + shortProfit;
                } else {
                  // Legacy: pay cover cost, get margin back (proceeds already in cash)
                  const coverCost = coverPrice * freshPosition.shares;
                  cashChange = freshMargin - coverCost;
                }

                // Update user: clear short, adjust cash
                const newCash = Math.round(((freshUserData.cash || 0) + cashChange) * 100) / 100;
                // Sanitize shorts to prevent undefined fields from crashing Firestore writes
                const updatedShorts = {};
                for (const [t, pos] of Object.entries(freshShorts)) {
                  if (t !== ticker && pos && pos.shares > 0) {
                    updatedShorts[t] = {
                      shares: pos.shares,
                      costBasis: pos.costBasis || pos.entryPrice || 0,
                      margin: pos.margin || 0,
                      openedAt: pos.openedAt || admin.firestore.Timestamp.now(),
                      system: pos.system
                    };
                  }
                }

                const userUpdates = {
                  shorts: updatedShorts,
                  cash: newCash
                };

                if (newCash < 0) {
                  userUpdates.isBankrupt = true;
                  userUpdates.bankruptAt = Date.now();
                }

                transaction.update(db.collection('users').doc(userDoc.id), userUpdates);

                // Update market price (dampened)
                transaction.update(marketRef, {
                  [`prices.${ticker}`]: newPrice,
                  [`priceHistory.${ticker}`]: admin.firestore.FieldValue.arrayUnion({
                    timestamp: Date.now(),
                    price: newPrice
                  })
                });

                // Log the liquidation trade
                const tradeRef = db.collection('trades').doc();
                transaction.set(tradeRef, {
                  uid: userDoc.id,
                  ticker,
                  action: 'margin_call_cover',
                  amount: freshPosition.shares,
                  price: coverPrice,
                  totalValue: coverPrice * freshPosition.shares,
                  cashBefore: freshUserData.cash || 0,
                  cashAfter: newCash,
                  timestamp: admin.firestore.FieldValue.serverTimestamp(),
                  automated: true
                });

                console.log(`Liquidated ${userDoc.id}'s short on ${ticker}: ${freshPosition.shares} shares at ${coverPrice}, cashChange: ${cashChange.toFixed(2)}`);
              });

              liquidatedCount++;
              tickerCoverCount[ticker] = (tickerCoverCount[ticker] || 0) + 1;
            } catch (error) {
              console.error(`Failed to liquidate ${userDoc.id}'s ${ticker} short:`, error);
            }
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Margin call check complete: ${checkedCount} users checked, ${liquidatedCount} positions liquidated, ${throttledCount} throttled in ${elapsed}s`);
      return { checked: checkedCount, liquidated: liquidatedCount, throttled: throttledCount, elapsed };

    } catch (error) {
      console.error('Margin call check failed:', error);
      return null;
    }
  });

/**
 * Server-side portfolio sync
 * Updates portfolioValue, portfolioHistory, peakPortfolioValue, and achievements
 * Called by clients instead of writing these fields directly (blocked by security rules)
 */
exports.syncPortfolio = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  const [userDoc, marketDoc] = await Promise.all([
    userRef.get(),
    marketRef.get()
  ]);

  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  if (!marketDoc.exists) throw new functions.https.HttpsError('not-found', 'Market data not found.');

  const userData = userDoc.data();
  const prices = marketDoc.data().prices || {};
  const now = Date.now();

  // Rate limit: once per 30 seconds per user
  const lastSynced = userData.lastSynced || 0;
  if (now - lastSynced < 30000) {
    return {
      portfolioValue: userData.portfolioValue || 0,
      peakPortfolioValue: userData.peakPortfolioValue || 0,
      newAchievements: [],
      historyUpdated: false,
      rateLimited: true
    };
  }

  // Hourly rate limit: max 60 syncs per hour
  const syncCount = userData.syncCountHour || 0;
  const syncHourStart = userData.syncHourStart || 0;
  const oneHour = 60 * 60 * 1000;
  if (now - syncHourStart < oneHour && syncCount >= 60) {
    return {
      portfolioValue: userData.portfolioValue || 0,
      peakPortfolioValue: userData.peakPortfolioValue || 0,
      newAchievements: [],
      historyUpdated: false,
      rateLimited: true
    };
  }

  // Calculate portfolio value
  const holdingsValue = Object.entries(userData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);

  const shortsValue = Object.entries(userData.shorts || {})
    .reduce((sum, [ticker, position]) => {
      if (!position || typeof position !== 'object') return sum;
      const shares = position.shares || 0;
      if (shares <= 0) return sum;
      const costBasis = position.costBasis || position.entryPrice || 0;
      const currentPrice = prices[ticker] || costBasis;
      const margin = position.margin || (costBasis * shares * 0.5);
      if (position.system === 'v2') {
        // v2: margin + unrealized P&L (no proceeds in cash)
        return sum + margin + (costBasis - currentPrice) * shares;
      }
      // Legacy: margin collateral - cost to buy back shares
      return sum + margin - (currentPrice * shares);
    }, 0);

  const portfolioValue = Math.round(((userData.cash || 0) + holdingsValue + shortsValue) * 100) / 100;

  const updateData = {
    portfolioValue,
    lastSynced: now,
    // Track hourly sync count
    syncCountHour: (now - syncHourStart >= oneHour) ? 1 : syncCount + 1,
    syncHourStart: (now - syncHourStart >= oneHour) ? now : syncHourStart
  };

  // Initialize weekly mission startPortfolioValue if not set
  const syncNow = new Date();
  const syncWeekStart = new Date(syncNow);
  syncWeekStart.setDate(syncWeekStart.getDate() - syncWeekStart.getDay() + 1);
  if (syncWeekStart > syncNow) syncWeekStart.setDate(syncWeekStart.getDate() - 7);
  const syncWeekId = syncWeekStart.toISOString().split('T')[0];
  const weeklyData = userData.weeklyMissions?.[syncWeekId];
  if (!weeklyData || weeklyData.startPortfolioValue === undefined) {
    updateData[`weeklyMissions.${syncWeekId}.startPortfolioValue`] = portfolioValue;
  }

  // Track lowest price while holding for Diamond Hands achievement
  const holdings = userData.holdings || {};
  const lowestWhileHolding = userData.lowestWhileHolding || {};
  for (const [ticker, shares] of Object.entries(holdings)) {
    if (shares > 0 && prices[ticker]) {
      const currentPrice = prices[ticker];
      const currentLowest = lowestWhileHolding[ticker];
      if (currentLowest === undefined || currentPrice < currentLowest) {
        updateData[`lowestWhileHolding.${ticker}`] = Math.round(currentPrice * 100) / 100;
      }
    }
  }

  // Update peak portfolio value
  const peakPortfolioValue = Math.max(userData.peakPortfolioValue || 0, portfolioValue);
  if (peakPortfolioValue > (userData.peakPortfolioValue || 0)) {
    updateData.peakPortfolioValue = peakPortfolioValue;
  }

  // Update portfolio history (rate-limited to every 10 minutes)
  const currentHistory = userData.portfolioHistory || [];
  const lastRecord = currentHistory[currentHistory.length - 1];
  const tenMinutes = 10 * 60 * 1000;

  const valueChanged = lastRecord && lastRecord.value > 0 && Math.abs(portfolioValue - lastRecord.value) / lastRecord.value > 0.01;
  const timeElapsed = !lastRecord || (now - lastRecord.timestamp) > tenMinutes;

  if (!lastRecord || timeElapsed || valueChanged) {
    updateData.portfolioHistory = [...currentHistory, { timestamp: now, value: portfolioValue }].slice(-500);
  }

  // Check achievements
  const currentAchievements = userData.achievements || [];
  const newAchievements = [];
  const holdingsCount = Object.values(userData.holdings || {}).filter(shares => shares > 0).length;
  const totalTrades = userData.totalTrades || 0;

  if (totalTrades >= 1 && !currentAchievements.includes('FIRST_BLOOD')) newAchievements.push('FIRST_BLOOD');
  if (totalTrades >= 20 && !currentAchievements.includes('TRADER_20')) newAchievements.push('TRADER_20');
  if (totalTrades >= 100 && !currentAchievements.includes('TRADER_100')) newAchievements.push('TRADER_100');
  if (portfolioValue >= 2500 && !currentAchievements.includes('BROKE_2K')) newAchievements.push('BROKE_2K');
  if (portfolioValue >= 5000 && !currentAchievements.includes('BROKE_5K')) newAchievements.push('BROKE_5K');
  if (portfolioValue >= 10000 && !currentAchievements.includes('BROKE_10K')) newAchievements.push('BROKE_10K');
  if (portfolioValue >= 25000 && !currentAchievements.includes('BROKE_25K')) newAchievements.push('BROKE_25K');
  if (portfolioValue >= 50000 && !currentAchievements.includes('BROKE_50K')) newAchievements.push('BROKE_50K');
  if (portfolioValue >= 100000 && !currentAchievements.includes('BROKE_100K')) newAchievements.push('BROKE_100K');
  if (portfolioValue >= 250000 && !currentAchievements.includes('BROKE_250K')) newAchievements.push('BROKE_250K');
  if (portfolioValue >= 500000 && !currentAchievements.includes('BROKE_500K')) newAchievements.push('BROKE_500K');
  if (portfolioValue >= 1000000 && !currentAchievements.includes('BROKE_1M')) newAchievements.push('BROKE_1M');
  if (holdingsCount >= 5 && !currentAchievements.includes('DIVERSIFIED')) newAchievements.push('DIVERSIFIED');

  // Unifier of Seoul: own at least 1 share of every tradeable stock (revocable)
  const totalCharacters = Object.keys(prices).length;
  let revokeUnifier = false;
  if (holdingsCount >= totalCharacters && totalCharacters > 0) {
    if (!currentAchievements.includes('UNIFIER')) newAchievements.push('UNIFIER');
  } else if (currentAchievements.includes('UNIFIER')) {
    revokeUnifier = true;
  }

  // NPC Lover: check if accumulated profit reached $1,000
  if ((userData.npcProfit || 0) >= 1000 && !currentAchievements.includes('NPC_LOVER')) newAchievements.push('NPC_LOVER');

  // Check leaderboard achievements (server-side, no client trust needed)
  const MIN_PORTFOLIO_FOR_LEADERBOARD = 5000;
  if (portfolioValue >= MIN_PORTFOLIO_FOR_LEADERBOARD && !currentAchievements.includes('TOP_1')) {
    try {
      const topSnap = await db.collection('users')
        .orderBy('portfolioValue', 'desc')
        .limit(10)
        .get();

      const topUsers = [];
      topSnap.forEach(doc => {
        const d = doc.data();
        if (!d.isBot && (d.portfolioValue || 0) >= MIN_PORTFOLIO_FOR_LEADERBOARD) {
          topUsers.push(doc.id);
        }
      });

      const userPosition = topUsers.indexOf(uid);
      if (userPosition !== -1) {
        const rank = userPosition + 1;
        if (rank <= 10 && !currentAchievements.includes('TOP_10')) newAchievements.push('TOP_10');
        if (rank <= 3 && !currentAchievements.includes('TOP_3')) newAchievements.push('TOP_3');
        if (rank === 1 && !currentAchievements.includes('TOP_1')) newAchievements.push('TOP_1');
      }
    } catch (err) {
      console.error('Leaderboard achievement check failed:', err);
    }
  }

  // Check checkin achievements (server-side)
  const totalCheckins = userData.totalCheckins || 0;
  if (totalCheckins >= 7 && !currentAchievements.includes('DEDICATED_7')) newAchievements.push('DEDICATED_7');
  if (totalCheckins >= 14 && !currentAchievements.includes('DEDICATED_14')) newAchievements.push('DEDICATED_14');
  if (totalCheckins >= 30 && !currentAchievements.includes('DEDICATED_30')) newAchievements.push('DEDICATED_30');
  if (totalCheckins >= 100 && !currentAchievements.includes('DEDICATED_100')) newAchievements.push('DEDICATED_100');

  if (newAchievements.length > 0) {
    updateData.achievements = admin.firestore.FieldValue.arrayUnion(...newAchievements);
    // Track when each achievement was earned
    for (const achId of newAchievements) {
      updateData[`achievementDates.${achId}`] = Date.now();
    }
  }

  // Check bankruptcy
  if (portfolioValue <= 100 && !userData.isBankrupt && userData.displayName) {
    updateData.isBankrupt = true;
  }

  await userRef.update(updateData);

  // Revoke Unifier separately (can't arrayRemove + arrayUnion same field in one update)
  if (revokeUnifier) {
    await userRef.update({
      achievements: admin.firestore.FieldValue.arrayRemove('UNIFIER'),
      'achievementDates.UNIFIER': admin.firestore.FieldValue.delete()
    });
  }

  return {
    portfolioValue,
    peakPortfolioValue,
    newAchievements,
    historyUpdated: !!updateData.portfolioHistory
  };
});

/**
 * Check Margin Lending - Scheduled every 5 minutes
 * Monitors users with margin debt and auto-liquidates if equity drops too low
 * Replaces broken client-side margin monitoring (blocked by security rules)
 */
exports.checkMarginLending = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping margin lending check — weekly trading halt active');
      return null;
    }

    const startTime = Date.now();
    console.log('Checking margin lending positions...');

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return null;
      }

      const marketSnapData = marketSnap.data();
      if (marketSnapData.marketHalted) {
        console.log('Skipping margin lending check — emergency halt active');
        return null;
      }
      const prices = marketSnapData.prices || {};

      // Query users with margin enabled
      const usersSnap = await db.collection('users')
        .where('marginEnabled', '==', true)
        .get();

      let liquidatedCount = 0;
      let marginCallCount = 0;
      let checkedCount = 0;

      const MARGIN_CALL_THRESHOLD = 0.30;
      const MARGIN_LIQUIDATION_THRESHOLD = 0.25;
      const MARGIN_CALL_GRACE_PERIOD = 24 * 60 * 60 * 1000; // 24 hours

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const marginUsed = userData.marginUsed || 0;
        if (marginUsed <= 0) continue;
        checkedCount++;

        const cash = userData.cash || 0;
        const holdings = userData.holdings || {};

        // Calculate holdings value
        let holdingsValue = 0;
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            holdingsValue += (prices[ticker] || 0) * shares;
          }
        });

        const grossValue = cash + holdingsValue;
        const portfolioValue = grossValue - marginUsed;
        const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 0;

        const now = Date.now();

        if (equityRatio <= MARGIN_LIQUIDATION_THRESHOLD) {
          // AUTO-LIQUIDATION
          try {
            await db.runTransaction(async (transaction) => {
              const freshUserDoc = await transaction.get(db.collection('users').doc(userDoc.id));
              if (!freshUserDoc.exists) return;

              const freshData = freshUserDoc.data();
              const freshMarginUsed = freshData.marginUsed || 0;
              if (freshMarginUsed <= 0) return;

              const freshHoldings = freshData.holdings || {};
              let totalRecovered = 0;
              const updateData = {};

              // Sell ALL positions with 5% slippage
              Object.entries(freshHoldings).forEach(([ticker, shares]) => {
                if (shares > 0) {
                  const sellValue = (prices[ticker] || 0) * shares * 0.95;
                  totalRecovered += sellValue;
                  updateData[`holdings.${ticker}`] = 0;
                  updateData[`costBasis.${ticker}`] = 0;
                }
              });

              const freshCash = freshData.cash || 0;
              const totalAvailable = freshCash + totalRecovered;
              const finalCash = Math.round((totalAvailable - freshMarginUsed) * 100) / 100;

              updateData.cash = finalCash;
              updateData.marginUsed = 0;
              updateData.marginCallAt = null;
              updateData.lastLiquidation = now;
              updateData.marginEnabled = false;

              if (finalCash < 0) {
                updateData.isBankrupt = true;
                updateData.bankruptAt = now;
              }

              transaction.update(db.collection('users').doc(userDoc.id), updateData);

              // Log liquidation trade
              const tradeRef = db.collection('trades').doc();
              transaction.set(tradeRef, {
                uid: userDoc.id,
                action: 'margin_liquidation',
                totalValue: totalRecovered,
                marginDebt: freshMarginUsed,
                cashBefore: freshCash,
                cashAfter: finalCash,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                automated: true
              });

              console.log(`Liquidated margin for ${userDoc.id}: recovered ${totalRecovered.toFixed(2)}, final cash ${finalCash.toFixed(2)}`);
            });

            liquidatedCount++;

            // Send Discord alert
            try {
              await sendDiscordMessage(null, [{
                title: '💥 Margin Liquidation',
                description: 'A trader was just **LIQUIDATED** by the margin system',
                color: 0xFF0000,
                timestamp: new Date().toISOString()
              }]);
            } catch (e) {}

          } catch (error) {
            console.error(`Failed to liquidate margin for ${userDoc.id}:`, error);
          }

        } else if (equityRatio <= MARGIN_CALL_THRESHOLD) {
          // MARGIN CALL
          const marginCallAt = userData.marginCallAt || 0;

          if (!marginCallAt) {
            // First margin call - set grace period
            await db.collection('users').doc(userDoc.id).update({
              marginCallAt: now
            });
            marginCallCount++;
          } else if (now >= marginCallAt + MARGIN_CALL_GRACE_PERIOD) {
            // Grace period expired - will liquidate on next check (equity will still be low)
            console.log(`Grace period expired for ${userDoc.id}, will liquidate on next cycle`);
          }

        } else if (userData.marginCallAt) {
          // Recovered from margin call
          await db.collection('users').doc(userDoc.id).update({
            marginCallAt: null
          });
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Margin lending check: ${checkedCount} checked, ${liquidatedCount} liquidated, ${marginCallCount} new margin calls in ${elapsed}s`);
      return { checked: checkedCount, liquidated: liquidatedCount, marginCalls: marginCallCount };

    } catch (error) {
      console.error('Margin lending check failed:', error);
      return null;
    }
  });

/**
 * Switch Crew - Callable function
 * Handles crew joining/switching with 15% penalty for switches
 * Replaces broken client-side crew switching (blocked by security rules)
 */
exports.switchCrew = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { crewId, isSwitch } = data;

  if (!crewId || typeof crewId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid crew ID.');
  }

  if (!CREW_MEMBERS[crewId]) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid crew.');
  }

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(marketRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();

    // Block if in debt
    if ((userData.cash || 0) < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot join a crew while in debt.');
    }

    // Check exile history
    const crewHistory = userData.crewHistory || [];
    if (crewHistory.includes(crewId)) {
      throw new functions.https.HttpsError('failed-precondition', 'You have been permanently exiled from this crew.');
    }

    // Check 24-hour cooldown
    const lastChange = userData.lastCrewChange || 0;
    const hoursSinceChange = (Date.now() - lastChange) / (1000 * 60 * 60);
    if (hoursSinceChange < 24) {
      throw new functions.https.HttpsError('failed-precondition', `Crew change cooldown. Try again in ${Math.ceil(24 - hoursSinceChange)}h.`);
    }

    const now = Date.now();
    const updateData = {
      crew: crewId,
      crewJoinedAt: now,
      crewHistory: admin.firestore.FieldValue.arrayUnion(crewId)
    };

    let totalTaken = 0;

    // Apply 15% penalty if switching crews
    if (isSwitch && userData.crew) {
      const prices = marketDoc.exists ? (marketDoc.data().prices || {}) : {};
      const penaltyRate = 0.15;

      const newCash = Math.floor((userData.cash || 0) * (1 - penaltyRate));
      const cashTaken = (userData.cash || 0) - newCash;

      const newHoldings = {};
      let holdingsValueTaken = 0;

      Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
        if (shares > 0) {
          const sharesToTake = Math.floor(shares * penaltyRate);
          const sharesToKeep = shares - sharesToTake;
          newHoldings[ticker] = sharesToKeep;
          holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
        }
      });

      totalTaken = cashTaken + holdingsValueTaken;
      const newPortfolioValue = Math.max(0, (userData.portfolioValue || 0) - totalTaken);

      updateData.cash = newCash;
      updateData.holdings = newHoldings;
      updateData.portfolioValue = newPortfolioValue;
      updateData.lastCrewChange = now;
    }

    transaction.update(userRef, updateData);

    return { success: true, totalTaken, isSwitch: !!(isSwitch && userData.crew) };
  });
});

/**
 * Process IPO Price Jumps - Scheduled every 5 minutes
 * Checks for ended IPOs that haven't had their price jump applied
 * Replaces client-side IPO price jump (only worked when admin was online)
 */
exports.processIPOPriceJumps = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping IPO price jumps — weekly trading halt active');
      return null;
    }

    try {
      // Check emergency halt
      const marketSnap = await db.collection('market').doc('current').get();
      if (marketSnap.exists && marketSnap.data().marketHalted) {
        console.log('Skipping IPO price jumps — emergency halt active');
        return null;
      }

      const ipoRef = db.collection('market').doc('ipos');
      const ipoSnap = await ipoRef.get();

      if (!ipoSnap.exists) return null;

      const ipoData = ipoSnap.data();
      const ipos = ipoData.list || [];
      const now = Date.now();
      const IPO_PRICE_JUMP = 0.30;
      const IPO_TOTAL_SHARES = 150;

      let processedCount = 0;
      let updatedList = [...ipos];

      for (let i = 0; i < ipos.length; i++) {
        const ipo = ipos[i];
        if (now >= ipo.ipoEndsAt && !ipo.priceJumped) {
          // IPO ended - apply 30% price jump
          const marketRef = db.collection('market').doc('current');
          const newPrice = Math.round(ipo.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;

          await marketRef.update({
            [`prices.${ipo.ticker}`]: newPrice,
            [`priceHistory.${ipo.ticker}`]: admin.firestore.FieldValue.arrayUnion({
              timestamp: now,
              price: newPrice
            }),
            launchedTickers: admin.firestore.FieldValue.arrayUnion(ipo.ticker)
          });

          updatedList[i] = { ...ipo, priceJumped: true };
          processedCount++;
          console.log(`IPO price jump applied for ${ipo.ticker}: $${newPrice}`);

          // Send Discord notification
          try {
            const sharesSold = IPO_TOTAL_SHARES - (ipo.sharesRemaining || 0);
            await sendDiscordMessage(null, [{
              title: '🎉 IPO Closed',
              description: `**${ipo.ticker}** IPO has ended! Price jumped to $${newPrice.toFixed(2)}`,
              color: 0x00FF00,
              fields: [
                { name: 'Shares Sold', value: `${sharesSold}/${IPO_TOTAL_SHARES}`, inline: true },
                { name: 'New Price', value: `$${newPrice.toFixed(2)}`, inline: true }
              ],
              timestamp: new Date().toISOString()
            }]);
          } catch (e) {}
        }
      }

      if (processedCount > 0) {
        await ipoRef.update({ list: updatedList });
        console.log(`Processed ${processedCount} IPO price jumps`);
      }

      return { processed: processedCount };
    } catch (error) {
      console.error('IPO price jump check failed:', error);
      return null;
    }
  });

/**
 * Remove an achievement from a user (admin only)
 * Used to clean up achievements awarded due to glitches
 */
exports.removeAchievement = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, achievementId } = data;
  if (!userId || !achievementId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId and achievementId required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  await userRef.update({
    achievements: admin.firestore.FieldValue.arrayRemove(achievementId),
    displayedAchievementPins: admin.firestore.FieldValue.arrayRemove(achievementId),
    [`achievementDates.${achievementId}`]: admin.firestore.FieldValue.delete()
  });

  return { success: true, removed: achievementId, userId };
});

/**
 * Admin reinstate a bankrupt user - gives them $1000 cash without wiping crew/holdings
 */
exports.reinstateUser = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const userData = userSnap.data();
  const cashBoost = Math.max(0, 1000 - (userData.cash || 0));

  await userRef.update({
    isBankrupt: false,
    cash: admin.firestore.FieldValue.increment(cashBoost),
    reinstatedAt: Date.now(),
    reinstatedBy: 'admin'
  });

  return { success: true, userId, cashAdded: cashBoost };
});

exports.adminSetCash = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, cash } = data;
  if (!userId || typeof cash !== 'number' || isNaN(cash) || cash < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and cash (>= 0) required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const prevCash = userSnap.data().cash;
  await userRef.update({ cash: Math.round(cash * 100) / 100 });

  return { success: true, userId, previousCash: prevCash, newCash: cash };
});

/**
 * Repair accounts damaged by the Jiho/Doo price spike.
 * Modes: scan (find victims), repair (fix one user), repairAll (fix all)
 */
exports.repairSpikeVictims = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { mode, userId, victims: victimsInput, userIds } = data;
  const SPIKE_TICKERS = ['JIHO', 'DOO'];

  // --- DIAGNOSE MODE ---
  if (mode === 'diagnose') {
    if (!userIds || !Array.isArray(userIds)) {
      throw new functions.https.HttpsError('invalid-argument', 'userIds array required');
    }

    const results = [];
    for (const uid of userIds) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) {
        results.push({ userId: uid, error: 'not found' });
        continue;
      }
      const userData = userSnap.data();

      // Get all trades for this user
      const tradesSnap = await db.collection('trades')
        .where('uid', '==', uid)
        .get();

      const trades = [];
      tradesSnap.forEach(doc => {
        const t = doc.data();
        const ts = t.timestamp?._seconds
          ? t.timestamp._seconds * 1000
          : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
        trades.push({
          id: doc.id,
          action: t.action,
          ticker: t.ticker,
          amount: t.amount,
          price: t.price,
          totalValue: t.totalValue,
          pnl: t.pnl,
          cashBefore: t.cashBefore,
          cashAfter: t.cashAfter,
          automated: t.automated || false,
          timestamp: ts
        });
      });

      trades.sort((a, b) => b.timestamp - a.timestamp);

      results.push({
        userId: uid,
        displayName: userData.displayName || 'Unknown',
        cash: userData.cash || 0,
        isBankrupt: userData.isBankrupt || false,
        bankruptAt: userData.bankruptAt || null,
        lastBailout: userData.lastBailout || null,
        holdings: userData.holdings || {},
        shorts: userData.shorts || {},
        costBasis: userData.costBasis || {},
        marginEnabled: userData.marginEnabled || false,
        marginUsed: userData.marginUsed || 0,
        portfolioValue: userData.portfolioValue || 0,
        totalTrades: trades.length,
        recentTrades: trades.slice(0, 50) // Last 50 trades
      });
    }

    return { results };
  }

  // --- SCAN MODE ---
  if (mode === 'scan') {
    // Broad scan: find ALL users who are bankrupt, have negative cash, or have
    // empty shorts (position closed without trade log). Excludes bots.
    const usersSnap = await db.collection('users').get();
    const victims = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      if (userData.isBot) continue;

      const uid = userDoc.id;
      const cash = userData.cash || 0;
      const isBankrupt = userData.isBankrupt || false;
      const holdings = userData.holdings || {};
      const shorts = userData.shorts || {};
      const hasHoldings = Object.values(holdings).some(v => v > 0);
      const hasShorts = Object.values(shorts).some(v => v && (typeof v === 'object' ? v.shares > 0 : v > 0));

      // Flag users who are: bankrupt, negative cash, or $0 with nothing
      const isDamaged = isBankrupt || cash < 0;
      if (!isDamaged) continue;

      // Get their trades for context
      const tradesSnap = await db.collection('trades')
        .where('uid', '==', uid)
        .get();

      const trades = [];
      tradesSnap.forEach(doc => {
        const t = doc.data();
        const ts = t.timestamp?._seconds
          ? t.timestamp._seconds * 1000
          : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
        trades.push({ ...t, _ts: ts, id: doc.id });
      });
      trades.sort((a, b) => a._ts - b._ts);

      // Find margin_call_cover trades on spike tickers
      const spikeTrades = trades.filter(t =>
        t.action === 'margin_call_cover' && SPIKE_TICKERS.includes(t.ticker)
      );

      // Find the last SHORT open on spike tickers (for users like Bbb with no cover trade)
      const spikeShortOpens = trades.filter(t =>
        (t.action === 'SHORT' || t.action === 'short' || t.action === 'SHORT_OPEN') &&
        SPIKE_TICKERS.includes(t.ticker)
      );

      // Determine corrected cash
      let correctedCash = null;
      let reason = '';

      if (spikeTrades.length > 0 && spikeShortOpens.length > 0) {
        // Has margin_call_cover AND short opens on spike tickers
        // Restore to cash BEFORE their first spike-ticker short (undo the whole sequence)
        correctedCash = spikeShortOpens[0].cashBefore;
        reason = 'margin_call_cover on ' + [...new Set(spikeTrades.map(t => t.ticker))].join('/');
      } else if (spikeTrades.length > 0) {
        // Has margin_call_cover but no short open found — use cashBefore of first cover
        correctedCash = spikeTrades[0].cashBefore;
        reason = 'margin_call_cover (no short open found)';
      } else if (spikeShortOpens.length > 0 && cash < 0) {
        // Shorted spike tickers, no cover trade logged, but negative cash
        // Restore to cash BEFORE the first spike short (margin should come back since position is gone)
        correctedCash = spikeShortOpens[0].cashBefore;
        reason = 'short closed without trade log (' + [...new Set(spikeShortOpens.map(t => t.ticker))].join('/') + ')';
      } else if (trades.length === 0 && cash <= 0) {
        // No trades at all, zero/negative cash — empty or broken account
        correctedCash = STARTING_CASH;
        reason = 'empty account (no trades)';
      }

      // Check if they took bailout
      const tookBailout = !!(userData.lastBailout);

      // For bailout users, try to reconstruct holdings from trade history
      let holdingsToRestore = null;
      let costBasisToRestore = null;

      if (tookBailout && trades.length > 0) {
        const replayHoldings = {};
        const replayCostBasis = {};

        // Replay all buy/sell trades (entire history, since bailout wiped everything)
        for (const t of trades) {
          const ticker = t.ticker;
          if (!ticker) continue;
          // Stop replaying if we hit the bailout or damage point
          if (t.action === 'margin_call_cover' && SPIKE_TICKERS.includes(ticker)) break;

          if (t.action === 'BUY' || t.action === 'buy') {
            const prevShares = replayHoldings[ticker] || 0;
            const prevCost = replayCostBasis[ticker] || 0;
            const newShares = prevShares + (t.amount || 0);
            if (newShares > 0) {
              replayCostBasis[ticker] = ((prevCost * prevShares) + (t.price * (t.amount || 0))) / newShares;
            }
            replayHoldings[ticker] = newShares;
          } else if (t.action === 'SELL' || t.action === 'sell') {
            replayHoldings[ticker] = Math.max(0, (replayHoldings[ticker] || 0) - (t.amount || 0));
            if (replayHoldings[ticker] === 0) delete replayCostBasis[ticker];
          }
        }

        // Clean up zero holdings
        for (const [ticker, shares] of Object.entries(replayHoldings)) {
          if (shares <= 0) {
            delete replayHoldings[ticker];
            delete replayCostBasis[ticker];
          }
        }

        if (Object.keys(replayHoldings).length > 0) {
          holdingsToRestore = replayHoldings;
          costBasisToRestore = replayCostBasis;
        }
      }

      // Get last 10 trades for display
      const recentTrades = trades.slice(-10).reverse().map(t => ({
        action: t.action,
        ticker: t.ticker,
        shares: t.amount,
        price: t.price,
        pnl: t.pnl,
        cashBefore: t.cashBefore,
        cashAfter: t.cashAfter,
        timestamp: t._ts
      }));

      victims.push({
        userId: uid,
        displayName: userData.displayName || 'Unknown',
        currentCash: cash,
        correctedCash,
        isBankrupt,
        bankruptAt: userData.bankruptAt || null,
        tookBailout,
        holdingsToRestore,
        costBasisToRestore,
        holdingsCount: holdingsToRestore ? Object.keys(holdingsToRestore).length : 0,
        hasHoldings,
        hasShorts,
        reason,
        totalTrades: trades.length,
        trades: recentTrades
      });
    }

    // Sort: most negative cash first
    victims.sort((a, b) => (a.currentCash || 0) - (b.currentCash || 0));

    return { victims };
  }

  // --- REPAIR MODE (single user) ---
  if (mode === 'repair') {
    if (!userId) {
      throw new functions.https.HttpsError('invalid-argument', 'userId required for repair mode');
    }

    // Find the victim data from victimsInput or re-scan
    let victim = victimsInput;
    if (!victim) {
      throw new functions.https.HttpsError('invalid-argument', 'victim data required');
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const updates = {
      cash: Math.round(victim.correctedCash * 100) / 100,
      isBankrupt: false
    };

    // Clear bankruptcy timestamp
    const userData = userSnap.data();
    if (userData.bankruptAt) {
      updates.bankruptAt = admin.firestore.FieldValue.delete();
    }

    // Restore holdings for bailout users
    if (victim.tookBailout && victim.holdingsToRestore) {
      updates.holdings = victim.holdingsToRestore;
      if (victim.costBasisToRestore) {
        updates.costBasis = victim.costBasisToRestore;
      }
    }

    // Add repair log
    updates._repairLog = admin.firestore.FieldValue.arrayUnion({
      type: 'spike_repair',
      repairedAt: Date.now(),
      repairedBy: context.auth.uid,
      previousCash: userData.cash,
      correctedCash: victim.correctedCash,
      tookBailout: victim.tookBailout,
      holdingsRestored: victim.holdingsToRestore ? Object.keys(victim.holdingsToRestore).length : 0
    });

    await userRef.update(updates);

    return { success: true, userId, correctedCash: victim.correctedCash };
  }

  // --- REPAIR ALL MODE ---
  if (mode === 'repairAll') {
    if (!victimsInput || !Array.isArray(victimsInput)) {
      throw new functions.https.HttpsError('invalid-argument', 'victims array required');
    }

    const results = [];
    for (const victim of victimsInput) {
      try {
        const userRef = db.collection('users').doc(victim.userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          results.push({ userId: victim.userId, success: false, error: 'not found' });
          continue;
        }

        const userData = userSnap.data();
        const updates = {
          cash: Math.round(victim.correctedCash * 100) / 100,
          isBankrupt: false
        };

        if (userData.bankruptAt) {
          updates.bankruptAt = admin.firestore.FieldValue.delete();
        }

        if (victim.tookBailout && victim.holdingsToRestore) {
          updates.holdings = victim.holdingsToRestore;
          if (victim.costBasisToRestore) {
            updates.costBasis = victim.costBasisToRestore;
          }
        }

        updates._repairLog = admin.firestore.FieldValue.arrayUnion({
          type: 'spike_repair',
          repairedAt: Date.now(),
          repairedBy: context.auth.uid,
          previousCash: userData.cash,
          correctedCash: victim.correctedCash,
          tookBailout: victim.tookBailout,
          holdingsRestored: victim.holdingsToRestore ? Object.keys(victim.holdingsToRestore).length : 0
        });

        await userRef.update(updates);
        results.push({ userId: victim.userId, success: true });
      } catch (err) {
        results.push({ userId: victim.userId, success: false, error: err.message });
      }
    }

    return { results };
  }

  throw new functions.https.HttpsError('invalid-argument', 'Invalid mode. Use scan, repair, or repairAll');
});

