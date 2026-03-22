const functions = require('firebase-functions');
const admin = require('firebase-admin');
const axios = require('axios');
const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');

admin.initializeApp();
const db = admin.firestore();

// Import bot trader
const { botTrader } = require('./botTrader');

// Import character data for trailing effects
const { CHARACTERS } = require('./characters');

// Leaderboard in-memory cache (persists across invocations on same instance)
const leaderboardCache = {};
const LEADERBOARD_CACHE_TTL = 60000; // 60 seconds

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
const MAX_TRADES_PER_TICKER_24H = 10; // Max trades per action per ticker per rolling 24h
const BASE_IMPACT = 0.012;
const BASE_LIQUIDITY = 100;
const BID_ASK_SPREAD = 0.002;
const ETF_BID_ASK_SPREAD = 0.001;
const MAX_PRICE_CHANGE_PERCENT = 0.05;

// Cumulative marginal impact: makes splitting trades give same impact as bulk
// impact = price * 0.012 * (sqrt((cumBefore + new) / 100) - sqrt(cumBefore / 100))
const calculateMarginalImpact = (currentPrice, newShares, cumulativeSharesBefore) => {
  const rawMarginal = currentPrice * BASE_IMPACT * (
    Math.sqrt((cumulativeSharesBefore + newShares) / BASE_LIQUIDITY) -
    Math.sqrt(cumulativeSharesBefore / BASE_LIQUIDITY)
  );
  const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
  return Math.min(rawMarginal, maxImpact);
};

// Prune entries older than 24h, return summary
const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const pruneAndSumTradeHistory = (entries, now) => {
  const cutoff = now - TWENTY_FOUR_HOURS_MS;
  const recent = (entries || []).filter(e => e.ts > cutoff);
  const totalShares = recent.reduce((sum, e) => sum + (e.shares || 0), 0);
  const totalImpact = recent.reduce((sum, e) => sum + (e.impact || 0), 0);
  return { recent, totalShares, totalImpact, count: recent.length };
};

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

// ============================================
// NOTIFICATION HELPER
// ============================================
// Writes a notification doc to users/{uid}/notifications subcollection
// Fire-and-forget — errors are logged but don't block the caller
const writeNotification = async (uid, { type, title, message, data = {} }) => {
  try {
    await db.collection('users').doc(uid).collection('notifications').add({
      type,       // 'trade', 'alert', 'achievement', 'margin', 'system'
      title,
      message,
      read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      data        // { ticker?, price?, orderId?, achievementId? }
    });
  } catch (err) {
    console.error(`Failed to write notification for ${uid}:`, err.message);
  }
};

// Writes a feed doc to the global feed collection (fire-and-forget)
const writeFeedEntry = async ({ type, userId, displayName, crew, message, ticker, action, amount, price, achievementId }) => {
  try {
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 day TTL
    await db.collection('feed').add({
      type,         // 'trade', 'achievement', 'mission_complete'
      userId,
      displayName,
      crew: crew || null,
      ticker: ticker || null,
      action: action || null,
      amount: amount || null,
      price: price || null,
      achievementId: achievementId || null,
      message,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      expiresAt
    });
  } catch (err) {
    console.error('Failed to write feed entry:', err.message);
  }
};

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
 * Reusable ban check — throws if user is banned.
 * Call right after fetching userData in any user-facing function.
 */
function checkBanned(userData) {
  if (userData?.isBanned) {
    throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
  }
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

  // Watched IP check — block alt accounts from watched IPs
  let autoLinkData = null;
  const signupIp = context.rawRequest?.ip || 'unknown';
  if (signupIp !== 'unknown') {
    const sanitizedSignupIp = signupIp.replace(/[.:/]/g, '_');
    try {
      const watchedIpDoc = await db.collection('watchedIPs').doc(sanitizedSignupIp).get();
      if (watchedIpDoc.exists) {
        const watchedIpData = watchedIpDoc.data();
        const watchedUserDoc = await db.collection('watchedUsers').doc(watchedIpData.watchedUserId).get();

        if (watchedUserDoc.exists && watchedUserDoc.data().isActive) {
          const watchedData = watchedUserDoc.data();
          const maxAccounts = watchedData.maxAccountsPerIP || 1;
          const linkedAccounts = watchedData.linkedAccounts || [];

          // Count total linked accounts
          const activeAccounts = linkedAccounts.length;

          if (activeAccounts >= maxAccounts) {
            // Block account creation
            await db.collection('watchlist_alerts').add({
              type: 'account_blocked',
              watchedUID: watchedIpData.watchedUserId,
              relatedUID: uid,
              ip: signupIp,
              action: 'blocked',
              details: `Blocked signup "${trimmed}" — ${activeAccounts} active accounts already exist from watched IP`,
              timestamp: admin.firestore.FieldValue.serverTimestamp()
            });

            throw new functions.https.HttpsError(
              'permission-denied',
              'Account creation temporarily restricted from this network.'
            );
          } else {
            // Under limit — flag for auto-link after transaction succeeds
            autoLinkData = {
              watchedUserId: watchedIpData.watchedUserId,
              watchedDisplayName: watchedData.displayName || watchedIpData.watchedUserId,
              sanitizedSignupIp,
              signupIp,
              activeAccounts,
              maxAccounts
            };
          }
        }
      }
    } catch (ipCheckError) {
      if (ipCheckError instanceof functions.https.HttpsError) throw ipCheckError;
      console.error('Watched IP check error during signup:', ipCheckError);
    }
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
        isBankrupt: false,
        onboardingComplete: false
      });
    });

    // Auto-link to watched user after successful account creation
    if (autoLinkData) {
      try {
        // Re-check for duplicates before linking (prevents duplicate entries from concurrent requests)
        const watchedSnap = await db.collection('watchedUsers').doc(autoLinkData.watchedUserId).get();
        const alreadyLinked = watchedSnap.exists && (watchedSnap.data().linkedAccounts || []).some(a => a.uid === uid);

        if (!alreadyLinked) {
          const newLinked = {
            uid,
            displayName: trimmed,
            linkedVia: 'ip',
            ip: autoLinkData.signupIp,
            linkedAt: Date.now()
          };

          await db.collection('watchedUsers').doc(autoLinkData.watchedUserId).update({
            linkedAccounts: admin.firestore.FieldValue.arrayUnion(newLinked),
            [`knownIPs.${autoLinkData.sanitizedSignupIp}.lastSeen`]: Date.now(),
            [`knownIPs.${autoLinkData.sanitizedSignupIp}.accounts`]: admin.firestore.FieldValue.arrayUnion(uid)
          });

          await db.collection('watchlist_alerts').add({
            type: 'account_linked',
            watchedUID: autoLinkData.watchedUserId,
            relatedUID: uid,
            ip: autoLinkData.signupIp,
            action: 'linked',
            details: `Auto-linked new account "${trimmed}" from watched IP`,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

        }
      } catch (linkError) {
        console.error('Auto-link after signup failed:', linkError);
      }
    }

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

    // Record signup IP in ipTracking
    if (signupIp !== 'unknown') {
      try {
        const sanitizedIp = signupIp.replace(/[.:/]/g, '_');
        await db.collection('ipTracking').doc(sanitizedIp).set({
          accounts: { [uid]: Date.now() },
          lastUpdated: Date.now()
        }, { merge: true });
      } catch (e) {
        console.error('Failed to record signup IP:', e);
      }
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
async function sendDiscordMessage(content, embeds = null, channelType = 'default', components = null) {
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
    if (components) {
      payload.components = components;
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
    console.log(`Discord message sent successfully to channel ${channelId} (${channelType})`);
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
    const { crew, sortBy = 'value' } = data || {};
    const cacheKey = crew ? (sortBy === 'weeklyGain' ? `weeklyGain_${crew}` : crew) : (sortBy === 'weeklyGain' ? 'weeklyGain' : 'global');

    // Check server-side cache
    let leaderboard;
    const cached = leaderboardCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp) < LEADERBOARD_CACHE_TTL) {
      leaderboard = cached.data;
    } else {
      if (sortBy === 'weeklyGain') {
        let query = db.collection('users');
        if (crew) {
          query = query.where('crew', '==', crew);
        }
        // Get a reasonable set to calculate gains from
        query = query.orderBy('portfolioValue', 'desc').limit(200);

        const snapshot = await query.get();
        const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

        const allUsers = [];
        snapshot.forEach(doc => {
          const userData = doc.data();
          if (userData.isBot) return;

          const currentValue = userData.portfolioValue || 0;
          let valueSevenDaysAgo = currentValue; // default if no history

          if (userData.portfolioHistory && Array.isArray(userData.portfolioHistory)) {
            // Find the entry closest to 7 days ago (first entry >= oneWeekAgo, or last entry before it)
            let found = false;
            for (let i = 0; i < userData.portfolioHistory.length; i++) {
              if (userData.portfolioHistory[i].timestamp >= oneWeekAgo) {
                valueSevenDaysAgo = userData.portfolioHistory[i].value;
                found = true;
                break;
              }
            }
            if (!found && userData.portfolioHistory.length > 0) {
              // All entries are older than a week, use the most recent one
              valueSevenDaysAgo = userData.portfolioHistory[userData.portfolioHistory.length - 1].value;
            }
          }

          const weeklyGain = currentValue - valueSevenDaysAgo;
          const weeklyGainPercent = valueSevenDaysAgo > 0 ? ((weeklyGain / valueSevenDaysAgo) * 100) : 0;

          const holdingsCount = userData.holdings
            ? Object.keys(userData.holdings).filter(k => userData.holdings[k] > 0).length
            : 0;

          allUsers.push({
            userId: doc.id,
            displayName: userData.displayName || 'Anonymous',
            portfolioValue: currentValue,
            crew: userData.crew || null,
            isCrewHead: userData.isCrewHead || false,
            crewHeadColor: userData.crewHeadColor || null,
            holdingsCount,
            displayCrewPin: userData.displayCrewPin || null,
            displayedAchievementPins: userData.displayedAchievementPins || [],
            achievements: userData.achievements || [],
            displayedShopPins: userData.displayedShopPins || [],
            weeklyGain,
            weeklyGainPercent: Math.round(weeklyGainPercent * 100) / 100
          });
        });

        // Sort by weekly gain descending
        allUsers.sort((a, b) => b.weeklyGain - a.weeklyGain);
        leaderboard = allUsers.slice(0, 50);
      } else {
        // Build query - use composite index for crew filtering
        let query = db.collection('users');

        if (crew) {
          query = query.where('crew', '==', crew);
        }

        query = query.orderBy('portfolioValue', 'desc').limit(100);

        const snapshot = await query.get();

        // Filter out bots and return only safe fields
        leaderboard = [];
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
      }

      // Cache the result
      leaderboardCache[cacheKey] = { data: leaderboard, timestamp: Date.now() };
    }

    // Find caller's rank if authenticated (always per-request)
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
 * Daily Market Summary - Runs daily at 21:00 UTC
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
 * Save pre-halt prices snapshot every Thursday at 13:55 UTC (5 min before halt)
 */
exports.savePreHaltPrices = functions.pubsub
  .schedule('55 13 * * 4')
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
exports.chapterReviewRecap = functions.pubsub
  .schedule('5 21 * * 4')
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

      // Compute changes per ticker (excluding ETFs)
      const gainers = [];
      const losers = [];
      let unchangedCount = 0;

      for (const [ticker, afterPrice] of Object.entries(afterPrices)) {
        if (etfTickers.has(ticker)) continue;
        const beforePrice = beforePrices[ticker];
        if (beforePrice == null) continue;

        const pctChange = beforePrice > 0
          ? ((afterPrice - beforePrice) / beforePrice) * 100
          : 0;

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

  const { ticker, characterName, ipoPrice, postIpoPrice, startsAt, endsAt, totalShares, maxPerUser } = data;

  const startsImmediately = !startsAt || startsAt <= Date.now() + 60000;

  const embed = {
    color: 0x00D4FF,
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
        value: `$${postIpoPrice.toFixed(2)} (+15%)`,
        inline: true
      },
      {
        name: 'Shares Available',
        value: `${totalShares || 150} total (max ${maxPerUser || 10}/person)`,
        inline: false
      },
      {
        name: startsImmediately ? 'IPO Ends' : 'IPO Opens',
        value: startsImmediately ? `<t:${Math.floor(endsAt / 1000)}:R>` : `<t:${Math.floor(startsAt / 1000)}:R>`,
        inline: false
      }
    ],
    footer: {
      text: startsImmediately ? 'IPO is LIVE now - first come, first served!' : 'IPO window coming soon - Get in early!'
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
 * Weekly Leaderboard - Runs Mondays at 01:00 UTC
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
 * Weekly Crew Rankings - Runs Mondays at 01:30 UTC
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
    checkBanned(userData);
    const marketData = marketDoc.data();
    const prices = marketData.prices || {};
    const currentPrice = prices[ticker];

    if (!currentPrice) {
      throw new functions.https.HttpsError('not-found', `Price for ${ticker} not found.`);
    }

    // CRITICAL: Enforce 3-second cooldown using server timestamp
    const now = admin.firestore.Timestamp.now().toMillis();
    const todayDate = new Date().toISOString().split('T')[0];
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

      // ANTI-MANIPULATION: 5-minute burst limit (max 3 per ticker per 5 min)
      const FIVE_MIN_MS = 5 * 60 * 1000;
      const fiveMinAgo = new Date(now - FIVE_MIN_MS);
      const burstTradesSnap = await db.collection('trades')
        .where('uid', '==', uid)
        .where('ticker', '==', ticker)
        .where('timestamp', '>', fiveMinAgo)
        .get();
      const burstCount = burstTradesSnap.docs.filter(d => d.data().action === action).length;

      if (burstCount >= 3) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Slow down: Max 3 ${action === 'buy' ? 'buys' : 'shorts'} per ticker every 5 minutes.`
        );
      }
    }

    // ANTI-MANIPULATION: 10-second same-ticker cooldown (buy/short only)
    if (action === 'buy' || action === 'short') {
      const TICKER_COOLDOWN_MS = 10000;
      const lastTickerTradeTime = userData.lastTickerTradeTime?.[ticker];
      if (lastTickerTradeTime) {
        const lastTickerMs = lastTickerTradeTime.toMillis ? lastTickerTradeTime.toMillis() : lastTickerTradeTime;
        const timeSinceTickerTrade = now - lastTickerMs;
        if (timeSinceTickerTrade < TICKER_COOLDOWN_MS) {
          const remainingMs = TICKER_COOLDOWN_MS - timeSinceTickerTrade;
          throw new functions.https.HttpsError('failed-precondition',
            `Same-stock cooldown: ${Math.ceil(remainingMs / 1000)}s remaining`);
        }
      }
    }

    // ANTI-MANIPULATION: Check 24h trade count per action per ticker
    {
      const tradeHistory = userData.tickerTradeHistory?.[ticker]?.[action] || [];
      const { count } = pruneAndSumTradeHistory(tradeHistory, now);
      if (count >= MAX_TRADES_PER_TICKER_24H) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} ${action}s on ${ticker}. This resets on a rolling 24h basis.`
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
      const MAX_PRICE_CHANGE_PERCENT = 0.05;
      const spread = character.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;

      let priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(amount / BASE_LIQUIDITY);
      const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
      priceImpact = Math.min(priceImpact, maxImpact);

      const newMidPrice = currentPrice + priceImpact;
      const askPrice = newMidPrice * (1 + spread / 2);
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
          if ((pos.system || 'v2') === 'v2') {
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
      let maxAccountsForIp = 4; // Global default
      const ONE_HOUR = 3600000;
      const sanitizedIp = ip.replace(/[.:/]/g, '_');
      const ipRef = db.collection('ipTracking').doc(sanitizedIp);

      try {
        // Check if this IP is watched (single fast read)
        const watchedIpDoc = await db.collection('watchedIPs').doc(sanitizedIp).get();
        let watchedUserId = null;

        if (watchedIpDoc.exists) {
          const watchedIpData = watchedIpDoc.data();
          watchedUserId = watchedIpData.watchedUserId;
          maxAccountsForIp = watchedIpData.maxAccountsPerIP || 1;

          // Auto-link: if trading from a watched IP with an unknown account
          const watchedUserDoc = await db.collection('watchedUsers').doc(watchedUserId).get();
          if (watchedUserDoc.exists && watchedUserDoc.data().isActive) {
            const watchedData = watchedUserDoc.data();
            const knownUIDs = (watchedData.linkedAccounts || []).map(a => a.uid);
            knownUIDs.push(watchedUserId); // Include the primary

            if (!knownUIDs.includes(uid)) {
              // Unknown account on watched IP — auto-link it
              const newLinked = {
                uid,
                displayName: userData.displayName || uid,
                linkedVia: 'ip',
                ip,
                linkedAt: Date.now()
              };

              await db.collection('watchedUsers').doc(watchedUserId).update({
                linkedAccounts: admin.firestore.FieldValue.arrayUnion(newLinked),
                [`knownIPs.${sanitizedIp}.lastSeen`]: Date.now(),
                [`knownIPs.${sanitizedIp}.accounts`]: admin.firestore.FieldValue.arrayUnion(uid)
              });

              await db.collection('watchlist_alerts').add({
                type: 'account_linked',
                watchedUID: watchedUserId,
                relatedUID: uid,
                ip,
                action: 'linked',
                details: `Auto-linked "${userData.displayName || uid}" — traded from watched IP`,
                timestamp: admin.firestore.FieldValue.serverTimestamp()
              });

            }

            // Track new IPs for known watched users/linked accounts
            if (knownUIDs.includes(uid)) {
              const knownIPs = watchedData.knownIPs || {};
              if (!knownIPs[sanitizedIp]) {
                // New IP for a known watched account
                await db.collection('watchedUsers').doc(watchedUserId).update({
                  [`knownIPs.${sanitizedIp}`]: {
                    firstSeen: Date.now(),
                    lastSeen: Date.now(),
                    accounts: [uid]
                  }
                });

                await db.collection('watchlist_alerts').add({
                  type: 'new_ip_detected',
                  watchedUID: watchedUserId,
                  relatedUID: uid,
                  ip,
                  action: 'flagged',
                  details: `Known watched account "${userData.displayName || uid}" seen on new IP`,
                  timestamp: admin.firestore.FieldValue.serverTimestamp()
                });

                // Also add this IP to watchedIPs for future lookups
                await db.collection('watchedIPs').doc(sanitizedIp).set({
                  watchedUserId,
                  maxAccountsPerIP: watchedData.maxAccountsPerIP || 1,
                  addedAt: admin.firestore.FieldValue.serverTimestamp()
                });
              } else {
                // Update lastSeen
                await db.collection('watchedUsers').doc(watchedUserId).update({
                  [`knownIPs.${sanitizedIp}.lastSeen`]: Date.now(),
                  [`knownIPs.${sanitizedIp}.accounts`]: admin.firestore.FieldValue.arrayUnion(uid)
                });
              }
            }
          }
        }

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
        if (uniqueCount > maxAccountsForIp) {
          console.warn(`IP ABUSE: ${ip} has ${uniqueCount} accounts trading in last hour (limit: ${maxAccountsForIp})`);

          await db.collection('admin').doc('suspicious_activity').set({
            [`ip_${sanitizedIp}`]: {
              timestamp: admin.firestore.FieldValue.serverTimestamp(),
              accountCount: uniqueCount,
              accounts: Object.keys(accounts),
              reason: watchedUserId ? 'Watched IP multi-account trading' : 'Multi-account trading from same IP'
            }
          }, { merge: true });

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
 * SECURITY FIX: Server-side trade execution with anti-manipulation enforcement
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

  // Anti-manipulation: Block shorting if user has a pending SELL or STOP_LOSS limit order on same ticker
  if (action === 'short') {
    const pendingSells = await db.collection('limitOrders')
      .where('userId', '==', uid)
      .where('ticker', '==', ticker)
      .where('status', '==', 'PENDING')
      .where('type', 'in', ['SELL', 'STOP_LOSS'])
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

    // Execute trade in atomic transaction (maxAttempts:1 prevents phantom retries
    // where the first attempt commits but a retry sees post-trade state and fails)
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
      checkBanned(userData);
      const marketData = marketDoc.data();

      // Check emergency admin halt
      if (marketData.marketHalted) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          marketData.haltReason || 'Market is currently halted.'
        );
      }

      // Check circuit breaker halt on this ticker
      const haltedTickers = marketData.haltedTickers || {};
      if (haltedTickers[ticker]) {
        const halt = haltedTickers[ticker];
        if (halt.resumeAt && Date.now() < halt.resumeAt) {
          const resumeIn = Math.ceil((halt.resumeAt - Date.now()) / 60000);
          throw new functions.https.HttpsError(
            'failed-precondition',
            `$${ticker} trading is halted (circuit breaker). Resumes in ~${resumeIn} min. ${halt.reason || ''}`
          );
        }
      }

      const prices = marketData.prices || {};
      let currentPrice = prices[ticker];

      const character = CHARACTERS.find(c => c.ticker === ticker);
      if (!character) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
      }

      // Auto-initialize price from basePrice if missing in Firestore
      if (!currentPrice) {
        currentPrice = character.basePrice;
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
      // Read tickerTradeHistory and compute cumulative stats for this action
      const tickerTradeHistory = userData.tickerTradeHistory || {};
      const actionHistory = tickerTradeHistory[ticker]?.[action] || [];
      const { recent: recentActionTrades, totalShares: cumulativeVolume, totalImpact: cumulativeActionImpact, count: tradeCount } = pruneAndSumTradeHistory(actionHistory, now);

      // Compute total daily impact across ALL actions for this ticker (for 10% cap)
      let cumulativeDailyImpact = 0;
      const allActionsForTicker = tickerTradeHistory[ticker] || {};
      for (const act of ['buy', 'sell', 'short', 'cover']) {
        const { totalImpact } = pruneAndSumTradeHistory(allActionsForTicker[act] || [], now);
        cumulativeDailyImpact += totalImpact;
      }

      // ANTI-MANIPULATION: Read IP-level trade history (shared across all accounts on same IP)
      const ip = context.rawRequest?.ip || 'unknown';
      let ipCumulativeDailyImpact = 0;
      let ipTrackingRef = null;
      let sanitizedIp = null;
      let ipTickerTradeHistory = {};

      if (ip !== 'unknown') {
        sanitizedIp = ip.replace(/[.:/]/g, '_');
        ipTrackingRef = db.collection('ipTracking').doc(sanitizedIp);
        const ipDoc = await transaction.get(ipTrackingRef);
        if (ipDoc.exists) {
          const ipData = ipDoc.data();
          ipTickerTradeHistory = ipData.tickerTradeHistory || {};
          const ipAllActions = ipTickerTradeHistory[ticker] || {};
          for (const act of ['buy', 'sell', 'short', 'cover']) {
            const { totalImpact } = pruneAndSumTradeHistory(ipAllActions[act] || [], now);
            ipCumulativeDailyImpact += totalImpact;
          }
        }
      }

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

      // ANTI-MANIPULATION: 10-second same-ticker cooldown (buy/short only)
      if (action === 'buy' || action === 'short') {
        const TICKER_COOLDOWN_MS = 10000;
        const lastTickerTradeTime = userData.lastTickerTradeTime?.[ticker];
        if (lastTickerTradeTime) {
          const lastTickerMs = lastTickerTradeTime.toMillis ? lastTickerTradeTime.toMillis() : lastTickerTradeTime;
          const timeSinceTickerTrade = now - lastTickerMs;
          if (timeSinceTickerTrade < TICKER_COOLDOWN_MS) {
            const remainingMs = TICKER_COOLDOWN_MS - timeSinceTickerTrade;
            throw new functions.https.HttpsError('failed-precondition',
              `Same-stock cooldown: ${Math.ceil(remainingMs / 1000)}s remaining`);
          }
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

        // ANTI-MANIPULATION: 5-minute burst limit (max 3 per ticker per 5 min)
        const FIVE_MIN_MS = 5 * 60 * 1000;
        const fiveMinAgo = new Date(now - FIVE_MIN_MS);
        const burstTradesSnap = await db.collection('trades')
          .where('uid', '==', uid)
          .where('ticker', '==', ticker)
          .where('timestamp', '>', fiveMinAgo)
          .get();
        const burstCount = burstTradesSnap.docs.filter(d => d.data().action === action).length;

        if (burstCount >= 3) {
          throw new functions.https.HttpsError(
            'failed-precondition',
            `Slow down: Max 3 ${action === 'buy' ? 'buys' : 'shorts'} per ticker every 5 minutes.`
          );
        }
      }

      // Calculate price impact
      const MIN_PRICE = 0.01;
      let priceImpact = 0;
      let newPrice = currentPrice;
      let executionPrice = currentPrice;
      let totalCost = 0;
      let hitMaxImpact = false;
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
            system: pos.system || 'v2'
          };
        }
      }
      let newMarginUsed = marginUsed;
      const effectiveSpread = character.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;

      // BUY LOGIC
      if (action === 'buy') {
        // Enforce 10-trade cap
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} buys on ${ticker}. This resets on a rolling 24h basis.`);
        }

        // Calculate marginal price impact (cumulative volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume);
        const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
        hitMaxImpact = priceImpact >= maxImpact;

        // Check daily 10% impact cap
        const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
        if (effectiveDailyImpact + impactPercent > MAX_DAILY_IMPACT && effectiveDailyImpact >= MAX_DAILY_IMPACT) {
          throw new functions.https.HttpsError('failed-precondition',
            `Daily trading limit reached for ${ticker}. No more buys today.`);
        }

        newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
        executionPrice = newPrice * (1 + effectiveSpread / 2); // Ask price
        totalCost = executionPrice * amount;

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

      // SELL LOGIC
      } else if (action === 'sell') {
        // Enforce 10-trade cap for sells
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} sells on ${ticker}. This resets on a rolling 24h basis.`);
        }

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

        // Calculate marginal price impact (cumulative sell volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume);

        newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
        executionPrice = Math.max(MIN_PRICE, newPrice * (1 - effectiveSpread / 2)); // Bid price
        totalCost = executionPrice * amount;

        // Execute sell
        newCash = cash + totalCost;
        newHoldings[ticker] = currentHoldings - amount;
        if (newHoldings[ticker] === 0) {
          delete newHoldings[ticker];
        }

      // SHORT LOGIC
      } else if (action === 'short') {
        // Enforce 10-trade cap
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} shorts on ${ticker}. This resets on a rolling 24h basis.`);
        }

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
        let portfolioEquity = cash;
        Object.entries(holdings).forEach(([t, s]) => {
          if (s > 0) portfolioEquity += (prices[t] || 0) * s;
        });
        Object.entries(shorts).forEach(([t, pos]) => {
          if (pos && pos.shares > 0) {
            if ((pos.system || 'v2') === 'v2') {
              portfolioEquity += (pos.margin || 0) + ((pos.costBasis || 0) - (prices[t] || 0)) * pos.shares;
            } else {
              portfolioEquity += (pos.margin || 0) - ((prices[t] || 0) * pos.shares);
            }
          }
        });

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

        // Calculate marginal price impact (cumulative volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume);

        // Check daily 10% impact cap
        const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
        const effectiveDailyImpact = Math.max(cumulativeDailyImpact, ipCumulativeDailyImpact);
        if (effectiveDailyImpact + impactPercent > MAX_DAILY_IMPACT && effectiveDailyImpact >= MAX_DAILY_IMPACT) {
          throw new functions.https.HttpsError('failed-precondition',
            `Daily trading limit reached for ${ticker}. No more shorts today.`);
        }

        newPrice = Math.max(MIN_PRICE, Math.round((currentPrice - priceImpact) * 100) / 100);
        executionPrice = Math.max(MIN_PRICE, newPrice * (1 - effectiveSpread / 2)); // Bid price
        totalCost = executionPrice * amount;

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

      // COVER LOGIC
      } else if (action === 'cover') {
        // Enforce 10-trade cap for covers
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) {
          throw new functions.https.HttpsError('failed-precondition',
            `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} covers on ${ticker}. This resets on a rolling 24h basis.`);
        }

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

        // Calculate marginal price impact (cumulative cover volume-based)
        priceImpact = calculateMarginalImpact(currentPrice, amount, cumulativeVolume);

        newPrice = Math.round((currentPrice + priceImpact) * 100) / 100;
        executionPrice = newPrice * (1 + effectiveSpread / 2); // Ask price
        totalCost = executionPrice * amount;

        // Calculate margin to return (based on entry price, not current price)
        const costBasis = shortPosition.costBasis || shortPosition.entryPrice || executionPrice;
        const totalPositionMargin = shortPosition.margin || (costBasis * shortPosition.shares * 0.5);
        const marginToReturn = shortPosition.shares > 0 ? (totalPositionMargin / shortPosition.shares) * amount : 0;

        // Execute cover
        if ((shortPosition.system || 'v2') === 'v2') {
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
          system: shortPosition.system || 'v2'
        };
        if (newShorts[ticker].shares <= 0) {
          delete newShorts[ticker];
        }

        // Covers tracked in tickerTradeHistory for 10-trade limit
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

      // Stock → ETF reverse propagation: when a non-ETF stock changes price,
      // update any parent ETFs proportionally using their trailing coefficients.
      // Build reverse lookup: stockTicker → [{etfTicker, coefficient}]
      const reverseETFMap = {};
      CHARACTERS.filter(c => c.isETF && c.trailingFactors).forEach(etf => {
        etf.trailingFactors.forEach(({ ticker: stockTicker, coefficient }) => {
          if (!reverseETFMap[stockTicker]) reverseETFMap[stockTicker] = [];
          reverseETFMap[stockTicker].push({ etfTicker: etf.ticker, coefficient });
        });
      });

      // For each changed non-ETF ticker, propagate to parent ETFs
      Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
        const updatedChar = CHARACTER_MAP[updatedTicker];
        if (updatedChar?.isETF) return; // Skip ETFs themselves

        const originalPrice = updatedTicker === ticker ? currentPrice : prices[updatedTicker];
        if (!originalPrice || originalPrice <= 0 || originalPrice === updatedPrice) return;

        const parentETFs = reverseETFMap[updatedTicker];
        if (!parentETFs) return;

        const stockChangePercent = (updatedPrice - originalPrice) / originalPrice;

        parentETFs.forEach(({ etfTicker, coefficient }) => {
          // Skip if this ETF is the ticker being directly traded (prevents feedback loop)
          if (etfTicker === ticker) return;

          const etfOldPrice = priceUpdates[etfTicker] || prices[etfTicker];
          if (!etfOldPrice || etfOldPrice <= 0) return;

          const etfChange = stockChangePercent * coefficient;
          const etfNewPrice = Math.max(MIN_PRICE, Math.round(etfOldPrice * (1 + etfChange) * 100) / 100);
          priceUpdates[etfTicker] = etfNewPrice;
          // Do NOT call applyTrailingEffects on updated ETFs (prevents ETF→stock→ETF loop)
        });
      });

      // Track trailing effects in tickerTradeHistory so users can't bypass the 10% limit
      // by trading one ticker and getting free impact on related tickers
      // Append synthetic entries (shares: 0, just impact) for affected tickers
      const trailingEntries = {}; // { ticker: { action: entry } }
      Object.entries(priceUpdates).forEach(([updatedTicker, updatedPrice]) => {
        if (updatedTicker === ticker) return; // Already tracked via main entry
        const originalPrice = prices[updatedTicker];
        if (originalPrice && originalPrice > 0) {
          const trailingImpactPercent = Math.abs(updatedPrice - originalPrice) / originalPrice;
          // Use buy direction for trailing effects (they represent buy-side pressure)
          const trailingAction = (action === 'buy' || action === 'cover') ? 'buy' : 'sell';
          trailingEntries[updatedTicker] = { action: trailingAction, entry: { ts: now, shares: 0, impact: trailingImpactPercent } };
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

      // Build updated tickerTradeHistory
      const impactPercent = currentPrice > 0 ? priceImpact / currentPrice : 0;
      const newTradeEntry = { ts: now, shares: amount, impact: impactPercent };

      // Start from existing history, prune old entries, append new
      const updatedTickerTradeHistory = {};
      for (const [t, actions] of Object.entries(tickerTradeHistory)) {
        updatedTickerTradeHistory[t] = {};
        for (const [act, entries] of Object.entries(actions)) {
          const { recent } = pruneAndSumTradeHistory(entries, now);
          updatedTickerTradeHistory[t][act] = recent;
        }
      }
      // Ensure ticker+action path exists
      if (!updatedTickerTradeHistory[ticker]) updatedTickerTradeHistory[ticker] = {};
      if (!updatedTickerTradeHistory[ticker][action]) updatedTickerTradeHistory[ticker][action] = [];
      updatedTickerTradeHistory[ticker][action] = [...(updatedTickerTradeHistory[ticker][action] || []), newTradeEntry];

      // Append trailing effect entries
      for (const [trailingTicker, { action: trailingAction, entry }] of Object.entries(trailingEntries)) {
        if (!updatedTickerTradeHistory[trailingTicker]) updatedTickerTradeHistory[trailingTicker] = {};
        if (!updatedTickerTradeHistory[trailingTicker][trailingAction]) updatedTickerTradeHistory[trailingTicker][trailingAction] = [];
        updatedTickerTradeHistory[trailingTicker][trailingAction].push(entry);
      }

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

      // Compute final trade count for this action (after appending new entry)
      const finalTradeCount = updatedTickerTradeHistory[ticker]?.[action]?.length || 0;

      const updates = {
        cash: newCash,
        holdings: newHoldings,
        shorts: newShorts,
        marginUsed: newMarginUsed,
        tickerTradeHistory: updatedTickerTradeHistory,
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

      // ANTI-MANIPULATION: Track ticker trade times for buy/short cooldown
      if (action === 'buy' || action === 'short') {
        updates[`lastTickerTradeTime.${ticker}`] = admin.firestore.Timestamp.now();
      }

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

      // ANTI-MANIPULATION: Save IP-level tickerTradeHistory
      if (ipTrackingRef && sanitizedIp) {
        // Build IP trade history: prune old, append new entry
        const updatedIpHistory = {};
        for (const [t, actions] of Object.entries(ipTickerTradeHistory)) {
          updatedIpHistory[t] = {};
          for (const [act, entries] of Object.entries(actions)) {
            const { recent } = pruneAndSumTradeHistory(entries, now);
            updatedIpHistory[t][act] = recent;
          }
        }
        if (!updatedIpHistory[ticker]) updatedIpHistory[ticker] = {};
        if (!updatedIpHistory[ticker][action]) updatedIpHistory[ticker][action] = [];
        updatedIpHistory[ticker][action].push(newTradeEntry);
        // Also append trailing entries to IP tracking
        for (const [trailingTicker, { action: trailingAction, entry }] of Object.entries(trailingEntries)) {
          if (!updatedIpHistory[trailingTicker]) updatedIpHistory[trailingTicker] = {};
          if (!updatedIpHistory[trailingTicker][trailingAction]) updatedIpHistory[trailingTicker][trailingAction] = [];
          updatedIpHistory[trailingTicker][trailingAction].push(entry);
        }
        transaction.set(ipTrackingRef, { tickerTradeHistory: updatedIpHistory }, { merge: true });
      }

      // Compute achievement context inside transaction (we have the data here)
      let achievementCtx = { tradeValue: totalCost };
      if (action === 'buy') {
        achievementCtx.isMonopoly = hitMaxImpact;
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
        // Track if user sold last share (for Unifier revocation)
        achievementCtx.soldLastShare = !(newHoldings[ticker] > 0);
        // Discount Deacon: dollar profit ending in .99
        if (costBasis > 0) {
          const dollarProfit = Math.round((executionPrice - costBasis) * amount * 100) / 100;
          if (dollarProfit > 0 && Math.round(dollarProfit * 100) % 100 === 99) {
            achievementCtx.isDiscountDeacon = true;
          }
        }
      }
      if (action === 'cover') {
        const shortCostBasis = shorts[ticker]?.costBasis || shorts[ticker]?.entryPrice || 0;
        const coverProfitPercent = shortCostBasis > 0 ? ((shortCostBasis - executionPrice) / shortCostBasis) * 100 : 0;
        achievementCtx.isColdBlooded = coverProfitPercent >= 20;
        // Discount Deacon: dollar profit ending in .99
        if (shortCostBasis > 0) {
          const dollarProfit = Math.round((shortCostBasis - executionPrice) * amount * 100) / 100;
          if (dollarProfit > 0 && Math.round(dollarProfit * 100) % 100 === 99) {
            achievementCtx.isDiscountDeacon = true;
          }
        }
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
        remainingDailyImpact: MAX_DAILY_IMPACT - (cumulativeDailyImpact + impactPercent),
        remainingTrades: MAX_TRADES_PER_TICKER_24H - finalTradeCount,
        isLastTrade: finalTradeCount >= MAX_TRADES_PER_TICKER_24H,
        dailyImpactPercent: cumulativeDailyImpact + impactPercent,
        shortWarning,
        achievementCtx
      };
    }, { maxAttempts: 1 });

    // Trade limit notifications (fire-and-forget, after transaction)
    const tradesUsed = MAX_TRADES_PER_TICKER_24H - (result.remainingTrades || 0);
    if (tradesUsed >= 7 && tradesUsed < MAX_TRADES_PER_TICKER_24H) {
      writeNotification(uid, {
        type: 'system',
        title: 'Trade Limit Warning',
        message: `You have ${tradesUsed}/${MAX_TRADES_PER_TICKER_24H} ${action}s on $${ticker} in the last 24h.`,
        data: { ticker }
      });
    } else if (tradesUsed >= MAX_TRADES_PER_TICKER_24H) {
      writeNotification(uid, {
        type: 'system',
        title: 'Trade Limit Reached',
        message: `You've hit the limit of ${MAX_TRADES_PER_TICKER_24H} ${action}s on $${ticker}. This resets on a rolling 24h basis.`,
        data: { ticker }
      });
    }

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
        if (ctx.isMonopoly && !currentAchievements.includes('MONOPOLY')) newAchievements.push('MONOPOLY');
        if (ctx.isDiscountDeacon && !currentAchievements.includes('DISCOUNT_DEACON')) newAchievements.push('DISCOUNT_DEACON');

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

    // Fire-and-forget: write trade feed entry + achievement notifications
    try {
      const userDoc2 = await db.collection('users').doc(uid).get();
      const uData = userDoc2.exists ? userDoc2.data() : {};
      const charName = CHARACTERS.find(c => c.ticker === ticker)?.name || ticker;
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
        price: result.executionPrice || 0
      });

      // Notify on new achievements
      if (result.newAchievements && result.newAchievements.length > 0) {
        for (const achId of result.newAchievements) {
          writeNotification(uid, {
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
    } catch (feedErr) {
      console.error('Feed/notification write after trade failed:', feedErr.message);
    }

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
      checkBanned(userData);
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
 * Records and validates a completed trade (legacy - may be unused)
 * Logs for auditing, detects suspicious patterns
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

  // Ban check
  const userSnap = await db.collection('users').doc(uid).get();
  if (userSnap.exists) checkBanned(userSnap.data());

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
    const gameResult = await db.runTransaction(async (transaction) => {
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
      checkBanned(mainUser);
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
        newAchievements: ladderNewAchievements,
        checkCasinoChampion: !currentAchievements.includes('CASINO_CHAMPION')
      };
    });

    // Check Casino Champion after transaction (requires additional query)
    if (gameResult.checkCasinoChampion) {
      try {
        const topSnap = await db.collection('ladderGameUsers')
          .orderBy('balance', 'desc')
          .limit(1)
          .get();
        if (!topSnap.empty && topSnap.docs[0].id === uid) {
          await db.collection('users').doc(uid).update({
            achievements: admin.firestore.FieldValue.arrayUnion('CASINO_CHAMPION'),
            'achievementDates.CASINO_CHAMPION': Date.now()
          });
          gameResult.newAchievements.push('CASINO_CHAMPION');
        }
      } catch (err) {
        console.error('Casino Champion check failed:', err);
      }
    }
    delete gameResult.checkCasinoChampion;

    return gameResult;
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
      checkBanned(mainUser);
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

    // Batch get all usernames in one call
    const userRefs = userIds.map(id => db.collection('users').doc(id));
    const userDocs = userRefs.length > 0 ? await db.getAll(...userRefs) : [];
    const userMap = {};
    userDocs.forEach(doc => { if (doc.exists) userMap[doc.id] = doc.data(); });

    for (const doc of ladderUsersSnap.docs) {
      const ladderData = doc.data();
      const userData = userMap[doc.id];
      leaderboard.push({
        userId: doc.id,
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
    const avatarURL = discordUser.avatar
      ? `https://cdn.discordapp.com/avatars/${discordId}/${discordUser.avatar}.png`
      : null;

    // Create or get Firebase user
    let firebaseUid;

    // First, check if a Firestore user already has this discordId
    const discordSnap = await db.collection('users')
      .where('discordId', '==', discordId)
      .limit(1)
      .get();

    if (!discordSnap.empty) {
      // Existing user found by discordId
      firebaseUid = discordSnap.docs[0].id;
    } else if (email) {
      // Try to find by email
      try {
        const existingUser = await admin.auth().getUserByEmail(email);
        firebaseUid = existingUser.uid;
        // Store discordId on existing user
        await db.collection('users').doc(firebaseUid).update({
          discordId: discordId,
          discordUsername: username
        });
      } catch (error) {
        // User doesn't exist, create new one with email
        const newUser = await admin.auth().createUser({
          email: email,
          displayName: username,
          photoURL: avatarURL
        });
        firebaseUid = newUser.uid;

        await db.collection('users').doc(firebaseUid).set({
          displayName: username,
          displayNameLower: username.toLowerCase(),
          discordId: discordId,
          discordUsername: username,
          cash: STARTING_CASH,
          holdings: {},
          portfolioValue: STARTING_CASH,
          portfolioHistory: [{ timestamp: Date.now(), value: STARTING_CASH }],
          lastCheckin: null,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          achievements: [],
          totalCheckins: 0,
          totalTrades: 0,
          peakPortfolioValue: STARTING_CASH,
          predictionWins: 0,
          costBasis: {},
          lendingUnlocked: false,
          isBankrupt: false,
          onboardingComplete: false
        });
      }
    } else {
      // No email from Discord — create user without email
      const newUser = await admin.auth().createUser({
        displayName: username,
        photoURL: avatarURL
      });
      firebaseUid = newUser.uid;

      await db.collection('users').doc(firebaseUid).set({
        displayName: username,
        displayNameLower: username.toLowerCase(),
        discordId: discordId,
        discordUsername: username,
        cash: STARTING_CASH,
        holdings: {},
        portfolioValue: STARTING_CASH,
        portfolioHistory: [{ timestamp: Date.now(), value: STARTING_CASH }],
        lastCheckin: null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        achievements: [],
        totalCheckins: 0,
        totalTrades: 0,
        peakPortfolioValue: STARTING_CASH,
        predictionWins: 0,
        costBasis: {},
        lendingUnlocked: false,
        isBankrupt: false,
        onboardingComplete: false
      });
    }

    // Create custom Firebase token
    const customToken = await admin.auth().createCustomToken(firebaseUid);

    // Redirect to app with token
    return res.redirect(`https://stockism.app/?discord_token=${customToken}`);

  } catch (error) {
    console.error('Discord auth error:', error);
    return res.redirect('https://stockism.app/?discord_error=true');
  }
});

// Discord Link — links Discord to an existing Stockism account (no new account created)
exports.discordLink = functions.https.onRequest(async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://stockism.app');

  const code = req.query.code;
  const state = req.query.state; // Firebase UID passed as state

  if (!code || !state) {
    return res.status(400).send('Missing authorization code or user ID');
  }

  try {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;
    const redirectUri = 'https://us-central1-stockism-abb28.cloudfunctions.net/discordLink';

    // Exchange code for access token
    const tokenResponse = await axios.post('https://discord.com/api/oauth2/token',
      new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'authorization_code',
        code: code,
        redirect_uri: redirectUri
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = tokenResponse.data.access_token;

    // Get Discord user info
    const userResponse = await axios.get('https://discord.com/api/users/@me', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    const discordId = userResponse.data.id;
    const discordUsername = userResponse.data.username;

    // Verify the Firebase UID (state) is a real user
    const userDoc = await db.collection('users').doc(state).get();
    if (!userDoc.exists) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=user_not_found');
    }

    // Check if this Discord is already linked to another account
    const existingSnap = await db.collection('users')
      .where('discordId', '==', discordId)
      .limit(1)
      .get();

    if (!existingSnap.empty && existingSnap.docs[0].id !== state) {
      return res.redirect('https://stockism.app/profile?discord_link=error&reason=already_linked');
    }

    // Link Discord to the existing account
    await db.collection('users').doc(state).update({
      discordId: discordId,
      discordUsername: discordUsername
    });

    return res.redirect('https://stockism.app/profile?discord_link=success');
  } catch (error) {
    const discordError = error.response && error.response.data
      ? JSON.stringify(error.response.data)
      : error.message || 'unknown';
    console.error('Discord link error:', discordError);
    return res.redirect(`https://stockism.app/profile?discord_link=error&reason=${encodeURIComponent(discordError)}`);
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
            if ((position.system || 'v2') === 'v2') {
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

  // Validate order type (BUY/SELL/STOP_LOSS supported — SHORT/COVER can't execute in checkLimitOrders)
  if (!type || !['BUY', 'SELL', 'STOP_LOSS'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Limit orders support BUY, SELL, and STOP_LOSS only.');
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

  // Validate holdings for SELL/STOP_LOSS orders (account for shares reserved by pending sells/stop losses)
  if (type === 'SELL' || type === 'STOP_LOSS') {
    const currentHoldings = userData.holdings?.[ticker] || 0;
    if (currentHoldings < shares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient holdings to sell.');
    }
    const pendingSellShares = pendingOrders.docs
      .filter(doc => {
        const o = doc.data();
        return o.ticker === ticker && (o.type === 'SELL' || o.type === 'STOP_LOSS');
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

  // Anti-manipulation: Block SELL/STOP_LOSS if user has an active short on same ticker
  if (type === 'SELL' || type === 'STOP_LOSS') {
    const shortShares = userData.shorts?.[ticker]?.shares || 0;
    if (shortShares > 0) {
      throw new functions.https.HttpsError('failed-precondition',
        'Cannot place a sell order while you have an active short on this stock.');
    }
  }

  // Block duplicate limit orders on same ticker + type
  // Treat SELL and STOP_LOSS as equivalent to prevent double-selling
  const sellTypes = ['SELL', 'STOP_LOSS'];
  const isSellType = sellTypes.includes(type);
  const existingOrderOnTicker = pendingOrders.docs.some(doc => {
    const o = doc.data();
    const isExistingSellType = sellTypes.includes(o.type);
    return o.ticker === ticker && (isSellType ? isExistingSellType : o.type === type);
  });
  if (existingOrderOnTicker) {
    throw new functions.https.HttpsError('already-exists',
      `You already have a pending sell or stop-loss order on ${ticker}. Cancel it first.`);
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
      const haltedTickersMap = marketData.haltedTickers || {};

      // Get all pending limit orders
      const ordersSnapshot = await db.collection('limitOrders')
        .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
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

          // Auto-cancel unsupported SHORT/COVER orders
          if (order.type === 'SHORT' || order.type === 'COVER') {
            await db.collection('limitOrders').doc(orderId).update({
              status: 'CANCELED',
              cancelReason: 'SHORT/COVER limit orders not supported',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            canceled++;
            continue;
          }

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
                status: 'CANCELED',
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

          // Skip halted tickers (circuit breaker)
          const tickerHalt = haltedTickersMap[order.ticker];
          if (tickerHalt && tickerHalt.resumeAt && Date.now() < tickerHalt.resumeAt) {
            continue;
          }

          // Check if order should execute
          let shouldExecute = false;
          if (order.type === 'BUY' && currentPrice <= order.limitPrice) {
            shouldExecute = true;
          } else if (order.type === 'SELL' && currentPrice >= order.limitPrice) {
            shouldExecute = true;
          } else if (order.type === 'STOP_LOSS' && currentPrice <= order.limitPrice) {
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
          const totalShares = order.shares;
          const alreadyFilled = order.filledShares || 0;
          const remainingShares = totalShares - alreadyFilled;
          let fillShares = remainingShares;
          let executedPrice = 0;

          try {
            await db.runTransaction(async (transaction) => {
              fillShares = remainingShares;  // Reset on every retry
              executedPrice = 0;
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
              if (order.type === 'STOP_LOSS' && freshPrice > order.limitPrice) {
                throw new Error('Price no longer meets limit condition');
              }

              // Check if user is bankrupt/in debt (could have changed since order was created)
              if (userData.isBankrupt || (userData.cash || 0) < 0) {
                throw new Error('User is bankrupt or in debt');
              }

              // STOP_LOSS executes as a sell — normalize for validation/execution
              const effectiveType = order.type === 'STOP_LOSS' ? 'SELL' : order.type;

              // Validate user has sufficient funds/shares
              if (effectiveType === 'BUY') {
                const totalCost = freshPrice * fillShares;
                if (userData.cash < totalCost) {
                  if (order.allowPartialFills) {
                    const affordableShares = freshPrice > 0 ? Math.floor(userData.cash / freshPrice) : 0;
                    if (affordableShares > 0) {
                      fillShares = affordableShares;
                      console.log(`Partial fill: can only afford ${affordableShares} shares`);
                    } else {
                      throw new Error('Insufficient cash');
                    }
                  } else {
                    throw new Error('Insufficient cash');
                  }
                }
              } else if (effectiveType === 'SELL') {
                const userShares = userData.holdings?.[order.ticker] || 0;
                if (userShares < fillShares) {
                  if (order.allowPartialFills) {
                    if (userShares > 0) {
                      fillShares = userShares;
                      console.log(`Partial fill: only have ${userShares} shares`);
                    } else {
                      throw new Error('Insufficient shares');
                    }
                  } else {
                    throw new Error('Insufficient shares');
                  }
                }
              }

              // Calculate marginal price impact using cumulative volume from tickerTradeHistory
              const limitAction = effectiveType.toLowerCase(); // 'buy' or 'sell'
              const limitTradeHistory = userData.tickerTradeHistory || {};
              const limitActionHistory = limitTradeHistory[order.ticker]?.[limitAction] || [];
              const { totalShares: limitCumVolume, count: limitTradeCount } = pruneAndSumTradeHistory(limitActionHistory, now);

              // Enforce 10-trade limit per action per ticker
              if (limitTradeCount >= MAX_TRADES_PER_TICKER_24H) {
                throw new Error(`Trade limit reached: ${MAX_TRADES_PER_TICKER_24H} ${limitAction}s on ${order.ticker} in 24h`);
              }

              const effectiveImpact = calculateMarginalImpact(freshPrice, fillShares, limitCumVolume);
              const limitImpactPercent = freshPrice > 0 ? effectiveImpact / freshPrice : 0;

              // Execute the trade
              const orderChar = CHARACTERS.find(c => c.ticker === order.ticker);
              const limitSpread = orderChar?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;

              // Build trade history entry for this limit order fill
              const limitTradeEntry = { ts: now, shares: fillShares, impact: limitImpactPercent };

              if (effectiveType === 'BUY') {
                // Price goes UP on buy
                const newMarketPrice = Math.round((freshPrice + effectiveImpact) * 100) / 100;
                const askPrice = newMarketPrice * (1 + limitSpread / 2);
                executedPrice = Math.round(askPrice * 100) / 100;
                const totalCost = askPrice * fillShares;

                // Re-validate with actual cost
                if (userData.cash < totalCost) {
                  throw new Error('Insufficient cash after price impact');
                }

                const currentHoldings = userData.holdings?.[order.ticker] || 0;
                const currentCostBasis = userData.costBasis?.[order.ticker] || 0;
                const newHoldings = currentHoldings + fillShares;
                const newCostBasis = currentHoldings > 0
                  ? (newHoldings > 0 ? ((currentCostBasis * currentHoldings) + (askPrice * fillShares)) / newHoldings : askPrice)
                  : askPrice;

                // Build updated tickerTradeHistory with new entry appended
                const updatedLimitHistory = JSON.parse(JSON.stringify(limitTradeHistory));
                if (!updatedLimitHistory[order.ticker]) updatedLimitHistory[order.ticker] = {};
                if (!updatedLimitHistory[order.ticker][limitAction]) updatedLimitHistory[order.ticker][limitAction] = [];
                // Prune old entries
                const cutoff = now - TWENTY_FOUR_HOURS_MS;
                updatedLimitHistory[order.ticker][limitAction] = updatedLimitHistory[order.ticker][limitAction].filter(e => e.ts > cutoff);
                updatedLimitHistory[order.ticker][limitAction].push(limitTradeEntry);

                transaction.update(userRef, {
                  cash: admin.firestore.FieldValue.increment(-totalCost),
                  [`holdings.${order.ticker}`]: newHoldings,
                  [`costBasis.${order.ticker}`]: Math.round(newCostBasis * 100) / 100,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1),
                  tickerTradeHistory: updatedLimitHistory
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

                console.log(`Executed BUY: ${fillShares} ${order.ticker} @ $${askPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              } else if (effectiveType === 'SELL') {
                // Price goes DOWN on sell
                const newMarketPrice = Math.max(0.01, Math.round((freshPrice - effectiveImpact) * 100) / 100);
                const bidPrice = newMarketPrice * (1 - limitSpread / 2);
                executedPrice = Math.round(bidPrice * 100) / 100;
                const totalRevenue = bidPrice * fillShares;

                const currentHoldings = userData.holdings?.[order.ticker] || 0;
                const newHoldings = currentHoldings - fillShares;

                // Build updated tickerTradeHistory with new entry appended
                const updatedLimitHistory = JSON.parse(JSON.stringify(limitTradeHistory));
                if (!updatedLimitHistory[order.ticker]) updatedLimitHistory[order.ticker] = {};
                if (!updatedLimitHistory[order.ticker][limitAction]) updatedLimitHistory[order.ticker][limitAction] = [];
                const cutoff = now - TWENTY_FOUR_HOURS_MS;
                updatedLimitHistory[order.ticker][limitAction] = updatedLimitHistory[order.ticker][limitAction].filter(e => e.ts > cutoff);
                updatedLimitHistory[order.ticker][limitAction].push(limitTradeEntry);

                const updates = {
                  cash: admin.firestore.FieldValue.increment(totalRevenue),
                  [`holdings.${order.ticker}`]: newHoldings,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1),
                  tickerTradeHistory: updatedLimitHistory
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

                console.log(`Executed ${order.type}: ${fillShares} ${order.ticker} @ $${bidPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              }
            });
          } catch (transactionError) {
            const msg = transactionError.message || '';
            const shouldCancel = [
              'User not found',
              'User is bankrupt',
              'Insufficient cash',
              'Insufficient shares',
              'Trade limit reached'
            ].some(reason => msg.includes(reason));

            if (shouldCancel) {
              console.log(`Canceling order ${orderId}: ${msg}`);
              await db.collection('limitOrders').doc(orderId).update({
                status: 'CANCELED',
                cancelReason: msg,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              canceled++;
            } else {
              console.log(`Order ${orderId} deferred (will retry): ${msg}`);
            }
            continue;
          }

          // Track per-ticker execution count for throttling
          tickerExecutionCount[order.ticker] = (tickerExecutionCount[order.ticker] || 0) + 1;

          // Update order status
          const newFilledTotal = alreadyFilled + fillShares;
          const isPartialFill = order.allowPartialFills && newFilledTotal < totalShares;

          await db.collection('limitOrders').doc(orderId).update({
            status: isPartialFill ? 'PARTIALLY_FILLED' : 'FILLED',
            filledShares: newFilledTotal,
            executedPrice: executedPrice,
            executedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          // Notify user that their limit order filled
          const effectiveType2 = order.type === 'STOP_LOSS' ? 'Stop loss' : `${order.type} limit order`;
          writeNotification(order.userId, {
            type: 'trade',
            title: `${effectiveType2} Filled`,
            message: `Your ${effectiveType2.toLowerCase()} for ${fillShares} $${order.ticker} executed at $${executedPrice.toFixed(2)}`,
            data: { ticker: order.ticker, orderId, price: executedPrice }
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
    checkBanned(userData);
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

    // Fire-and-forget feed entry for mission completion (outside transaction)
    writeFeedEntry({
      type: 'mission_complete',
      userId: uid,
      displayName: userData.displayName || 'Anonymous',
      crew: userData.crew || null,
      message: `completed a ${type} mission (+$${reward})`
    });

    return { success: true, reward, newTotal };
  });
});

/**
 * Reroll all missions (daily + weekly) for the current week
 * Costs $500, once per week, locked if any rewards claimed
 */
exports.rerollMissions = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);

    // Must have a crew
    if (!userData.crew) {
      throw new functions.https.HttpsError('failed-precondition', 'Must be in a crew.');
    }

    // Calculate week ID (same as claimMissionReward logic)
    const now = new Date();
    const today = now.toISOString().split('T')[0];
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
    if (weekStart > now) weekStart.setDate(weekStart.getDate() - 7);
    const weekId = weekStart.toISOString().split('T')[0];

    const weeklyProgress = userData.weeklyMissions?.[weekId] || {};

    // Check not already rerolled
    if (weeklyProgress.rerolled) {
      throw new functions.https.HttpsError('failed-precondition', 'Already rerolled this week.');
    }

    // Check no rewards claimed (daily or weekly)
    const dailyProgress = userData.dailyMissions?.[today] || {};
    const dailyClaimed = dailyProgress.claimed ? Object.keys(dailyProgress.claimed).length > 0 : false;
    const weeklyClaimed = weeklyProgress.claimed ? Object.keys(weeklyProgress.claimed).length > 0 : false;

    if (dailyClaimed || weeklyClaimed) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot reroll after claiming any reward.');
    }

    // Check has $500
    const cash = userData.cash || 0;
    if (cash < 500) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough cash. Need $500.');
    }

    // Generate random seed offset
    const rerollSeed = Math.floor(Math.random() * 100000) + 1;

    const updates = {
      cash: cash - 500,
      [`weeklyMissions.${weekId}.rerolled`]: true,
      [`weeklyMissions.${weekId}.rerollSeed`]: rerollSeed
    };

    transaction.update(userRef, updates);
    return { success: true, rerollSeed };
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
    checkBanned(userData);

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
    checkBanned(userData);
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

    // Check bet limit (can't bet more than total invested value)
    const holdings = userData.holdings || {};
    const costBasisData = userData.costBasis || {};
    const totalHoldingsValue = Object.entries(holdings).reduce((sum, [t, shares]) => {
      return sum + ((costBasisData[t] || 0) * shares);
    }, 0);
    const totalShortMargin = Object.values(userData.shorts || {})
      .filter(s => s && s.shares > 0)
      .reduce((sum, s) => sum + (s.margin || 0), 0);
    const totalInvested = totalHoldingsValue + totalShortMargin;

    if (totalInvested <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Must invest in stocks before betting.');
    }

    // Enforce bet limit: can't bet more than total invested or available cash
    const betLimit = Math.min(totalInvested, userData.cash || 0);
    const existingBetOnThis = userData.bets?.[predictionId]?.amount || 0;
    if (amount > betLimit - existingBetOnThis) {
      throw new functions.https.HttpsError('failed-precondition',
        `Bet exceeds limit. Max: $${Math.max(0, betLimit - existingBetOnThis).toFixed(2)}`);
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
    checkBanned(userData);
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
      const predictionAchievements = [];
      if (newPredictionWins >= 10 && !achievements.includes('PROPHET')) predictionAchievements.push('PROPHET');
      else if (newPredictionWins >= 3 && !achievements.includes('ORACLE')) predictionAchievements.push('ORACLE');

      // Underdog: win when <20% of the pool backed the winning side
      if (winningPool > 0 && totalPool > 0 && (winningPool / totalPool) < 0.20 && !achievements.includes('UNDERDOG')) {
        predictionAchievements.push('UNDERDOG');
      }

      if (predictionAchievements.length > 0) {
        updates.achievements = admin.firestore.FieldValue.arrayUnion(...predictionAchievements);
        for (const achId of predictionAchievements) {
          updates[`achievementDates.${achId}`] = Date.now();
        }
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

  if (!ticker || !quantity || !Number.isFinite(quantity) || !Number.isInteger(quantity) || quantity <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid IPO purchase data.');
  }

  const validTicker = CHARACTERS.some(c => c.ticker === ticker);
  if (!validTicker) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }

  const userRef = db.collection('users').doc(uid);
  const ipoRef = db.collection('market').doc('ipos');
  const marketRef = db.collection('market').doc('current');

  const result = await db.runTransaction(async (transaction) => {
    const [userDoc, ipoDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(ipoRef),
      transaction.get(marketRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!ipoDoc.exists) throw new functions.https.HttpsError('not-found', 'IPO data not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    const ipoData = ipoDoc.data();
    const ipoList = ipoData.list || [];

    const ipo = ipoList.find(i => i.ticker === ticker);
    if (!ipo) throw new functions.https.HttpsError('not-found', 'IPO not found.');

    const maxPerUser = ipo.maxPerUser || 10;

    // Validate quantity against per-IPO limit
    if (quantity > maxPerUser) {
      throw new functions.https.HttpsError('invalid-argument', `Max ${maxPerUser} shares per user.`);
    }

    // Validate IPO is active
    const now = Date.now();
    if (!ipo.ipoStartsAt || now < ipo.ipoStartsAt || now > ipo.ipoEndsAt) {
      throw new functions.https.HttpsError('failed-precondition', 'IPO is not active.');
    }

    // Check shares remaining
    const sharesRemaining = ipo.sharesRemaining || 0;
    if (quantity > sharesRemaining) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough shares available.');
    }

    // Check per-user limit
    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > maxPerUser) {
      throw new functions.https.HttpsError('failed-precondition', `Exceeds per-user IPO limit (${maxPerUser}).`);
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
    const newSharesRemaining = sharesRemaining - quantity;
    const soldOut = newSharesRemaining <= 0;

    const updatedList = ipoList.map(i =>
      i.ticker === ticker ? { ...i, sharesRemaining: newSharesRemaining, ...(soldOut ? { priceJumped: true } : {}) } : i
    );
    transaction.update(ipoRef, { list: updatedList });

    // If sold out, immediately apply price jump and launch into normal trading
    if (soldOut) {
      const IPO_PRICE_JUMP = 0.15;
      const newPrice = Math.round(ipo.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;
      transaction.update(marketRef, {
        [`prices.${ticker}`]: newPrice,
        [`priceHistory.${ticker}`]: admin.firestore.FieldValue.arrayUnion({
          timestamp: now,
          price: newPrice
        }),
        launchedTickers: admin.firestore.FieldValue.arrayUnion(ticker)
      });
    } else if (marketDoc.exists) {
      // Initialize price if not set
      const marketData = marketDoc.data();
      if (!marketData.prices?.[ticker]) {
        transaction.update(marketRef, {
          [`prices.${ticker}`]: ipo.basePrice,
          [`volumes.${ticker}`]: quantity
        });
      }
    }

    return { success: true, totalCost, newHoldings, soldOut, ticker: ipo.ticker, basePrice: ipo.basePrice, ipoTotalShares: ipo.totalShares || 150 };
  });

  // Send Discord alert after transaction if sold out
  if (result.soldOut) {
    try {
      const IPO_PRICE_JUMP = 0.15;
      const newPrice = Math.round(result.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;
      await sendDiscordMessage(null, [{
        title: '🎉 IPO Sold Out!',
        description: `**${result.ticker}** IPO sold out! Price jumped to $${newPrice.toFixed(2)} — now trading normally.`,
        color: 0x00FF00,
        fields: [
          { name: 'Shares Sold', value: `${result.ipoTotalShares}/${result.ipoTotalShares}`, inline: true },
          { name: 'New Price', value: `$${newPrice.toFixed(2)}`, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]);
    } catch (e) {}
  }

  return result;
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
    checkBanned(userData);
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
    checkBanned(userData);
    if ((userData.cash || 0) >= 0 && !userData.isBankrupt) {
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
      isBankrupt: false,
      bankruptAt: null,
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      crewHistory: updatedHistory,
      lastBailout: Date.now(),
      shortHistory: {},
      lowestWhileHolding: {},
      tickerTradeHistory: {}
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
    checkBanned(userData);
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
    checkBanned(userData);

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
                if ((freshPosition.system || 'v2') === 'v2') {
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
                      system: pos.system || 'v2'
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

              // Notify user about margin call liquidation
              writeNotification(userDoc.id, {
                type: 'margin',
                title: 'Margin Call - Position Liquidated',
                message: `Your short on $${ticker} (${position.shares} shares) was force-covered due to low equity.`,
                data: { ticker }
              });
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
  checkBanned(userData);
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
      if ((position.system || 'v2') === 'v2') {
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
  const launchedTickers = marketDoc.data().launchedTickers || [];
  const totalCharacters = CHARACTERS.filter(c => !c.ipoRequired || launchedTickers.includes(c.ticker)).length;
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

  // Compute and store weekly gain for Profit Champion
  const portfolioHistory = userData.portfolioHistory || [];
  const sevenDaysAgo = now - (7 * 24 * 60 * 60 * 1000);
  let valueSevenDaysAgo = portfolioValue;
  for (const entry of portfolioHistory) {
    if (entry.timestamp >= sevenDaysAgo) {
      valueSevenDaysAgo = entry.value;
      break;
    }
  }
  const weeklyGain = Math.round((portfolioValue - valueSevenDaysAgo) * 100) / 100;
  updateData.weeklyGain = weeklyGain;

  // Check Profit Champion: #1 in weekly gains
  if (weeklyGain > 0 && !currentAchievements.includes('PROFIT_CHAMPION')) {
    try {
      const topGainerSnap = await db.collection('users')
        .orderBy('weeklyGain', 'desc')
        .limit(1)
        .get();
      if (!topGainerSnap.empty) {
        const topDoc = topGainerSnap.docs[0];
        const topGain = topDoc.data().weeklyGain || 0;
        // Award if user's new gain beats the current top (or they ARE the current top)
        if (topDoc.id === uid || weeklyGain > topGain) {
          newAchievements.push('PROFIT_CHAMPION');
        }
      }
    } catch (err) {
      console.error('Profit Champion check failed:', err);
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

  // Auto-clear bankruptcy if account has recovered
  if (userData.isBankrupt && portfolioValue > 500 && (userData.cash || 0) >= 0) {
    updateData.isBankrupt = false;
    if (userData.bankruptAt) {
      updateData.bankruptAt = admin.firestore.FieldValue.delete();
    }
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

  try {
    return await db.runTransaction(async (transaction) => {
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

      const userData = userDoc.data();
      checkBanned(userData);

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

      // Apply 15% penalty if switching crews (only read market prices when needed)
      if (isSwitch && userData.crew) {
        const marketRef = db.collection('market').doc('current');
        const marketDoc = await transaction.get(marketRef);
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

  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    if (error.code === 10 || error.message?.includes('contention') || error.message?.includes('ABORTED')) {
      throw new functions.https.HttpsError(
        'aborted',
        'Crew change was busy. Please try again.'
      );
    }
    console.error('switchCrew error:', error);
    throw new functions.https.HttpsError(
      'internal',
      'Failed to join crew. Please try again.'
    );
  }
});

/**
 * Process IPO Price Jumps - Scheduled every 5 minutes
 * Checks for ended IPOs that haven't had their price jump applied
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
      const IPO_PRICE_JUMP = 0.15;

      let processedCount = 0;
      let updatedList = [...ipos];

      for (let i = 0; i < ipos.length; i++) {
        const ipo = ipos[i];
        if (now >= ipo.ipoEndsAt && !ipo.priceJumped) {
          // IPO ended - apply 15% price jump
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
            const ipoTotalShares = ipo.totalShares || 150;
            const sharesSold = ipoTotalShares - (ipo.sharesRemaining || 0);
            await sendDiscordMessage(null, [{
              title: '🎉 IPO Closed',
              description: `**${ipo.ticker}** IPO has ended! Price jumped to $${newPrice.toFixed(2)}`,
              color: 0x00FF00,
              fields: [
                { name: 'Shares Sold', value: `${sharesSold}/${ipoTotalShares}`, inline: true },
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

/**
 * Rename a ticker across all Firestore data.
 * Modes: dryRun (preview changes), execute (apply changes)
 */
exports.renameTicker = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { oldTicker, newTicker, dryRun = true } = data;

  if (!oldTicker || !newTicker || typeof oldTicker !== 'string' || typeof newTicker !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'oldTicker and newTicker are required strings');
  }

  const old = oldTicker.trim().toUpperCase();
  const nw = newTicker.trim().toUpperCase();

  if (old === nw) {
    throw new functions.https.HttpsError('invalid-argument', 'Old and new ticker are the same');
  }

  // Validate: old ticker must exist in market data, new must not
  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();
  if (!marketSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Market data not found');
  }

  const marketData = marketSnap.data();
  const prices = marketData.prices || {};
  const priceHistory = marketData.priceHistory || {};
  const volumes = marketData.volumes || {};
  const launchedTickers = marketData.launchedTickers || [];

  if (prices[old] === undefined) {
    throw new functions.https.HttpsError('invalid-argument', `Old ticker "${old}" not found in market prices`);
  }
  if (prices[nw] !== undefined) {
    throw new functions.https.HttpsError('invalid-argument', `New ticker "${nw}" already exists in market prices`);
  }

  const log = [];
  let docsToModify = 0;

  // --- 1. MARKET DATA ---
  const marketUpdates = {};
  // prices
  marketUpdates[`prices.${nw}`] = prices[old];
  marketUpdates[`prices.${old}`] = admin.firestore.FieldValue.delete();
  // priceHistory
  if (priceHistory[old]) {
    marketUpdates[`priceHistory.${nw}`] = priceHistory[old];
    marketUpdates[`priceHistory.${old}`] = admin.firestore.FieldValue.delete();
  }
  // volumes
  if (volumes[old] !== undefined) {
    marketUpdates[`volumes.${nw}`] = volumes[old];
    marketUpdates[`volumes.${old}`] = admin.firestore.FieldValue.delete();
  }
  // launchedTickers array
  if (launchedTickers.includes(old)) {
    marketUpdates.launchedTickers = launchedTickers.map(t => t === old ? nw : t);
  }
  // Handle other potential ticker-keyed maps
  if (marketData.dailyVolumes && marketData.dailyVolumes[old] !== undefined) {
    marketUpdates[`dailyVolumes.${nw}`] = marketData.dailyVolumes[old];
    marketUpdates[`dailyVolumes.${old}`] = admin.firestore.FieldValue.delete();
  }
  if (marketData.liquidity && marketData.liquidity[old] !== undefined) {
    marketUpdates[`liquidity.${nw}`] = marketData.liquidity[old];
    marketUpdates[`liquidity.${old}`] = admin.firestore.FieldValue.delete();
  }

  log.push(`market/current: rename ${old} → ${nw} in prices, priceHistory, volumes, launchedTickers`);
  docsToModify++;

  // --- 2. USER DOCS ---
  const usersSnap = await db.collection('users').get();
  const userUpdates = []; // { ref, updates }

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    const updates = {};
    let touched = false;

    // Simple ticker-keyed maps
    const simpleMaps = ['holdings', 'shorts', 'costBasis', 'lastBuyTime', 'lowestWhileHolding', 'shortHistory', 'ipoPurchases', 'lastTickerTradeTime'];
    for (const mapName of simpleMaps) {
      if (userData[mapName] && userData[mapName][old] !== undefined) {
        updates[`${mapName}.${nw}`] = userData[mapName][old];
        updates[`${mapName}.${old}`] = admin.firestore.FieldValue.delete();
        touched = true;
      }
    }

    // tickerTradeHistory: { ticker -> { action -> [entries] } }
    if (userData.tickerTradeHistory && userData.tickerTradeHistory[old] !== undefined) {
      updates[`tickerTradeHistory.${nw}`] = userData.tickerTradeHistory[old];
      updates[`tickerTradeHistory.${old}`] = admin.firestore.FieldValue.delete();
      touched = true;
    }

    if (touched) {
      userUpdates.push({ ref: userDoc.ref, updates, displayName: userData.displayName || userDoc.id });
      docsToModify++;
    }
  }

  log.push(`users: ${userUpdates.length} user docs to update`);

  // --- 3. TRADE RECORDS ---
  const tradesSnap = await db.collection('trades').where('ticker', '==', old).get();
  log.push(`trades: ${tradesSnap.size} trade records to update`);
  docsToModify += tradesSnap.size;

  // --- 4. LIMIT ORDERS ---
  const limitOrdersSnap = await db.collection('limitOrders').where('ticker', '==', old).get();
  log.push(`limitOrders: ${limitOrdersSnap.size} limit orders to update`);
  docsToModify += limitOrdersSnap.size;

  // --- 5. IP TRACKING ---
  const ipSnap = await db.collection('ipTracking').get();
  const ipUpdates = [];

  for (const ipDoc of ipSnap.docs) {
    const ipData = ipDoc.data();
    const updates = {};
    let touched = false;

    // tickerTradeHistory: { ticker -> { action -> [entries] } }
    if (ipData.tickerTradeHistory && ipData.tickerTradeHistory[old] !== undefined) {
      updates[`tickerTradeHistory.${nw}`] = ipData.tickerTradeHistory[old];
      updates[`tickerTradeHistory.${old}`] = admin.firestore.FieldValue.delete();
      touched = true;
    }

    if (touched) {
      ipUpdates.push({ ref: ipDoc.ref, updates });
      docsToModify++;
    }
  }

  log.push(`ipTracking: ${ipUpdates.length} IP docs to update`);

  // --- DRY RUN: return summary ---
  if (dryRun) {
    return {
      dryRun: true,
      oldTicker: old,
      newTicker: nw,
      totalDocsToModify: docsToModify,
      breakdown: {
        market: 1,
        users: userUpdates.length,
        trades: tradesSnap.size,
        limitOrders: limitOrdersSnap.size,
        ipTracking: ipUpdates.length
      },
      log
    };
  }

  // --- EXECUTE: halt market, apply changes, resume ---
  // Halt market
  await marketRef.update({
    marketHalted: true,
    haltReason: `Ticker rename in progress: ${old} → ${nw}`,
    haltedAt: Date.now(),
    haltedBy: context.auth.uid
  });

  try {
    // 1. Update market doc
    await marketRef.update(marketUpdates);

    // 2. Update users in batches of 500
    for (let i = 0; i < userUpdates.length; i += 500) {
      const batch = db.batch();
      const chunk = userUpdates.slice(i, i + 500);
      for (const { ref, updates } of chunk) {
        batch.update(ref, updates);
      }
      await batch.commit();
    }

    // 3. Update trades in batches of 500
    const tradeDocs = tradesSnap.docs;
    for (let i = 0; i < tradeDocs.length; i += 500) {
      const batch = db.batch();
      const chunk = tradeDocs.slice(i, i + 500);
      for (const tradeDoc of chunk) {
        batch.update(tradeDoc.ref, { ticker: nw });
      }
      await batch.commit();
    }

    // 4. Update limit orders in batches of 500
    const limitDocs = limitOrdersSnap.docs;
    for (let i = 0; i < limitDocs.length; i += 500) {
      const batch = db.batch();
      const chunk = limitDocs.slice(i, i + 500);
      for (const limitDoc of chunk) {
        batch.update(limitDoc.ref, { ticker: nw });
      }
      await batch.commit();
    }

    // 5. Update IP tracking in batches of 500
    for (let i = 0; i < ipUpdates.length; i += 500) {
      const batch = db.batch();
      const chunk = ipUpdates.slice(i, i + 500);
      for (const { ref, updates } of chunk) {
        batch.update(ref, updates);
      }
      await batch.commit();
    }

    // Resume market
    await marketRef.update({
      marketHalted: false,
      haltReason: '',
      haltedAt: null,
      haltedBy: null
    });

    return {
      dryRun: false,
      success: true,
      oldTicker: old,
      newTicker: nw,
      totalDocsModified: docsToModify,
      breakdown: {
        market: 1,
        users: userUpdates.length,
        trades: tradesSnap.size,
        limitOrders: limitOrdersSnap.size,
        ipTracking: ipUpdates.length
      },
      log
    };
  } catch (err) {
    // Resume market even on failure
    try {
      await marketRef.update({
        marketHalted: false,
        haltReason: '',
        haltedAt: null,
        haltedBy: null
      });
    } catch (_) { /* best effort */ }

    throw new functions.https.HttpsError('internal', `Rename failed mid-execution: ${err.message}. Market resumed. Manual cleanup may be needed.`);
  }
});

// ============================================
// WATCHLIST FUNCTIONS (Admin-Only)
// ============================================

/**
 * Add a user to the watchlist
 */
exports.addWatchedUser = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { userId, reason, maxAccountsPerIP } = data;

  if (!userId || typeof userId !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'User ID required.');
  }

  const maxAccounts = Number(maxAccountsPerIP) || 1;

  // Fetch user info
  const userDoc = await db.collection('users').doc(userId).get();
  const displayName = userDoc.exists ? userDoc.data().displayName : 'Unknown';

  // Collect known IPs from ipTracking
  const knownIPs = {};
  const ipTrackingSnap = await db.collection('ipTracking').get();
  for (const ipDoc of ipTrackingSnap.docs) {
    const accounts = ipDoc.data().accounts || {};
    if (accounts[userId]) {
      const rawIp = ipDoc.id;
      knownIPs[rawIp] = {
        firstSeen: Date.now(),
        lastSeen: Date.now(),
        accounts: [userId]
      };

      // Create reverse lookup
      await db.collection('watchedIPs').doc(rawIp).set({
        watchedUserId: userId,
        maxAccountsPerIP: maxAccounts,
        addedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    }
  }

  await db.collection('watchedUsers').doc(userId).set({
    displayName,
    reason: reason || '',
    maxAccountsPerIP: maxAccounts,
    linkedAccounts: [],
    knownIPs,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
    addedBy: context.auth.uid,
    isActive: true
  });

  await db.collection('watchlist_alerts').add({
    type: 'user_added',
    watchedUID: userId,
    relatedUID: null,
    ip: null,
    action: 'flagged',
    details: `Added "${displayName}" to watchlist. Reason: ${reason || 'None'}. Found ${Object.keys(knownIPs).length} known IPs.`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, displayName, knownIPCount: Object.keys(knownIPs).length };
});

/**
 * Remove (deactivate) a user from the watchlist
 */
exports.removeWatchedUser = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { userId } = data;
  if (!userId) throw new functions.https.HttpsError('invalid-argument', 'User ID required.');

  const watchedDoc = await db.collection('watchedUsers').doc(userId).get();
  if (!watchedDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not on watchlist.');
  }

  await db.collection('watchedUsers').doc(userId).update({ isActive: false });

  // Remove reverse IP lookups
  const knownIPs = watchedDoc.data().knownIPs || {};
  for (const ipId of Object.keys(knownIPs)) {
    const watchedIpDoc = await db.collection('watchedIPs').doc(ipId).get();
    if (watchedIpDoc.exists && watchedIpDoc.data().watchedUserId === userId) {
      await db.collection('watchedIPs').doc(ipId).delete();
    }
  }

  await db.collection('watchlist_alerts').add({
    type: 'user_removed',
    watchedUID: userId,
    relatedUID: null,
    ip: null,
    action: 'flagged',
    details: `Removed "${watchedDoc.data().displayName}" from watchlist`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});

/**
 * Manually link an alt account to a watched user
 */
exports.linkAltAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { watchedUserId, altAccountId } = data;
  if (!watchedUserId || !altAccountId) {
    throw new functions.https.HttpsError('invalid-argument', 'Both user IDs required.');
  }

  const watchedDoc = await db.collection('watchedUsers').doc(watchedUserId).get();
  if (!watchedDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Watched user not found.');
  }

  const altDoc = await db.collection('users').doc(altAccountId).get();
  const altName = altDoc.exists ? altDoc.data().displayName : 'Unknown';

  // Check if already linked
  const alreadyLinked = (watchedDoc.data().linkedAccounts || []).some(a => a.uid === altAccountId);
  if (alreadyLinked) {
    throw new functions.https.HttpsError('already-exists', 'This account is already linked.');
  }

  const newLinked = {
    uid: altAccountId,
    displayName: altName,
    linkedVia: 'manual',
    ip: null,
    linkedAt: Date.now()
  };

  await db.collection('watchedUsers').doc(watchedUserId).update({
    linkedAccounts: admin.firestore.FieldValue.arrayUnion(newLinked)
  });

  await db.collection('watchlist_alerts').add({
    type: 'account_linked',
    watchedUID: watchedUserId,
    relatedUID: altAccountId,
    ip: null,
    action: 'linked',
    details: `Manually linked "${altName}" as alt of "${watchedDoc.data().displayName}"`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, altName };
});

/**
 * Add an IP address to a watched user
 */
exports.addWatchedIP = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const { userId, ip } = data;
  if (!userId || !ip) {
    throw new functions.https.HttpsError('invalid-argument', 'User ID and IP required.');
  }

  const watchedDoc = await db.collection('watchedUsers').doc(userId).get();
  if (!watchedDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'Watched user not found.');
  }

  const sanitizedIp = ip.replace(/[.:/]/g, '_');
  const watchedData = watchedDoc.data();

  // Add to watched user's knownIPs
  await db.collection('watchedUsers').doc(userId).update({
    [`knownIPs.${sanitizedIp}`]: {
      firstSeen: Date.now(),
      lastSeen: Date.now(),
      accounts: [userId]
    }
  });

  // Create reverse lookup
  await db.collection('watchedIPs').doc(sanitizedIp).set({
    watchedUserId: userId,
    maxAccountsPerIP: watchedData.maxAccountsPerIP || 1,
    addedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  await db.collection('watchlist_alerts').add({
    type: 'ip_added',
    watchedUID: userId,
    relatedUID: null,
    ip,
    action: 'flagged',
    details: `Manually added IP ${ip} to "${watchedData.displayName}"`,
    timestamp: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true };
});

/**
 * Get all active watched users (admin panel)
 */
exports.getWatchlist = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }

  const watchedSnap = await db.collection('watchedUsers').where('isActive', '==', true).get();
  const watchedUsers = [];

  for (const doc of watchedSnap.docs) {
    const d = doc.data();
    watchedUsers.push({
      id: doc.id,
      displayName: d.displayName,
      reason: d.reason,
      maxAccountsPerIP: d.maxAccountsPerIP,
      linkedAccounts: d.linkedAccounts || [],
      knownIPs: d.knownIPs || {},
      addedAt: d.addedAt,
      isActive: d.isActive
    });
  }

  // Fetch recent alerts
  const alertsSnap = await db.collection('watchlist_alerts')
    .orderBy('timestamp', 'desc')
    .limit(50)
    .get();

  const alerts = alertsSnap.docs.map(doc => ({
    id: doc.id,
    ...doc.data(),
    timestamp: doc.data().timestamp?.toMillis?.() || doc.data().timestamp
  }));

  return { watchedUsers, alerts };
});

// ============================================
// PRICE ALERTS
// ============================================

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

  // Validate inputs
  if (!ticker || typeof ticker !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }
  if (!targetPrice || typeof targetPrice !== 'number' || targetPrice <= 0 || targetPrice > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid target price.');
  }
  if (!['above', 'below'].includes(direction)) {
    throw new functions.https.HttpsError('invalid-argument', 'Direction must be "above" or "below".');
  }

  // Verify ticker exists
  const character = CHARACTERS.find(c => c.ticker === ticker);
  if (!character) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown ticker.');
  }

  // Check active alerts count (max 10)
  const alertsSnap = await db.collection('users').doc(uid).collection('priceAlerts')
    .where('triggered', '==', false)
    .get();

  if (alertsSnap.size >= 10) {
    throw new functions.https.HttpsError('failed-precondition', 'Maximum 10 active price alerts.');
  }

  // Create the alert
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

      // Get all users (we check their priceAlerts subcollection)
      // For scale, we'd use a collection group query, but subcollection queries
      // require collectionGroup which needs an index. For now, iterate users.
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

// ============================================
// CIRCUIT BREAKER / AUTO MARKET HALT
// ============================================

/**
 * Check for extreme price moves and halt tickers that move >30% in 1 hour
 * Runs every 5 minutes
 */
exports.checkCircuitBreakers = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();
      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};
      const haltedTickers = marketData.haltedTickers || {};
      const now = Date.now();
      const ONE_HOUR = 60 * 60 * 1000;
      const HALT_THRESHOLD = 0.30; // 30% change triggers halt
      const HALT_DURATION = 30 * 60 * 1000; // 30 min halt

      const updates = {};
      let newHalts = 0;
      let resumed = 0;

      // Check for tickers that should resume
      for (const [ticker, halt] of Object.entries(haltedTickers)) {
        if (halt.resumeAt && now >= halt.resumeAt) {
          updates[`haltedTickers.${ticker}`] = admin.firestore.FieldValue.delete();
          resumed++;

          // Log resumption
          await db.collection('circuitBreakerLog').add({
            ticker,
            action: 'resume',
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });
        }
      }

      // Check each ticker for extreme moves
      for (const [ticker, currentPrice] of Object.entries(prices)) {
        // Skip already halted tickers
        if (haltedTickers[ticker] && (!haltedTickers[ticker].resumeAt || now < haltedTickers[ticker].resumeAt)) {
          continue;
        }

        const history = priceHistory[ticker] || [];
        if (history.length < 2) continue;

        // Find price from ~1 hour ago
        let priceOneHourAgo = null;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= now - ONE_HOUR) {
            priceOneHourAgo = history[i].price;
            break;
          }
        }

        if (!priceOneHourAgo || priceOneHourAgo <= 0) continue;

        const changePercent = (currentPrice - priceOneHourAgo) / priceOneHourAgo;

        if (Math.abs(changePercent) >= HALT_THRESHOLD) {
          const reason = changePercent > 0
            ? `Price surged ${(changePercent * 100).toFixed(1)}% in 1 hour`
            : `Price dropped ${(Math.abs(changePercent) * 100).toFixed(1)}% in 1 hour`;

          updates[`haltedTickers.${ticker}`] = {
            haltedAt: now,
            resumeAt: now + HALT_DURATION,
            reason,
            changePercent: Math.round(changePercent * 10000) / 100
          };

          newHalts++;

          // Log the halt
          await db.collection('circuitBreakerLog').add({
            ticker,
            action: 'halt',
            reason,
            changePercent: Math.round(changePercent * 10000) / 100,
            priceAtHalt: currentPrice,
            priceOneHourAgo,
            haltDuration: HALT_DURATION,
            timestamp: admin.firestore.FieldValue.serverTimestamp()
          });

          // Notify holders
          const usersSnap = await db.collection('users').get();
          for (const userDoc of usersSnap.docs) {
            const userData = userDoc.data();
            const hasPosition = (userData.holdings?.[ticker] > 0) ||
              (userData.shorts?.[ticker]?.shares > 0);
            if (hasPosition) {
              writeNotification(userDoc.id, {
                type: 'system',
                title: `Trading Halted: $${ticker}`,
                message: `$${ticker} has been halted for 30 minutes. ${reason}.`,
                data: { ticker }
              });
            }
          }
        }
      }

      if (Object.keys(updates).length > 0) {
        await marketRef.update(updates);
      }

      console.log(`Circuit breaker check: ${newHalts} new halts, ${resumed} resumed`);
      return { newHalts, resumed };
    } catch (err) {
      console.error('Circuit breaker check failed:', err);
      return null;
    }
  });

// ============================================
// DAILY FREE STOCK CLAIM (Discord Button)
// ============================================

/**
 * Weighted random pick from an array using weights.
 * values[i] has weight weights[i].
 */
function weightedRandom(values, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < values.length; i++) {
    roll -= weights[i];
    if (roll <= 0) return values[i];
  }
  return values[values.length - 1];
}

/**
 * Roll loot for the daily free stock claim.
 * Returns { picks: [{ ticker, name, shares, currentPrice }], isJackpot }
 */
async function rollDailyStock() {
  const JACKPOT_CHANCE = 0.03;
  const isJackpot = Math.random() < JACKPOT_CHANCE;

  let totalShares, varietyCount;

  if (isJackpot) {
    totalShares = Math.floor(Math.random() * 5) + 6; // 6-10
    varietyCount = Math.floor(Math.random() * 3) + 3; // 3-5
  } else {
    totalShares = weightedRandom([1, 2, 3, 4, 5], [35, 30, 20, 10, 5]);
    varietyCount = weightedRandom([1, 2, 3], [70, 25, 5]);
  }

  // Cap variety to total shares (can't have 3 different stocks with only 1 share)
  varietyCount = Math.min(varietyCount, totalShares);

  // Get tradeable stocks from market data
  const marketDoc = await db.collection('market').doc('current').get();
  const prices = marketDoc.data()?.prices || {};
  const launchedTickers = marketDoc.data()?.launchedTickers || [];

  const tradeableChars = CHARACTERS.filter(c =>
    !c.ipoRequired || launchedTickers.includes(c.ticker)
  ).filter(c => prices[c.ticker] != null);

  if (tradeableChars.length === 0) {
    return { picks: [], isJackpot: false };
  }

  // Pick random unique stocks
  const shuffled = [...tradeableChars].sort(() => Math.random() - 0.5);
  const selectedStocks = shuffled.slice(0, Math.min(varietyCount, shuffled.length));

  // Distribute shares across selected stocks
  const picks = selectedStocks.map(stock => ({
    ticker: stock.ticker,
    name: stock.name,
    shares: 0,
    currentPrice: prices[stock.ticker] || stock.basePrice
  }));

  for (let i = 0; i < totalShares; i++) {
    picks[i % picks.length].shares += 1;
  }

  return { picks, isJackpot };
}

/**
 * Daily scheduled function — posts the claim button to Discord.
 * Runs at 10 AM Eastern (14:00 UTC) every day.
 */
exports.dailyFreeStock = functions.pubsub
  .schedule('0 14 * * *')
  .timeZone('UTC')
  .onRun(async () => {
    const embed = {
      title: '🎁 Daily Free Stock Drop!',
      description: 'Click the button below to claim your free daily stock(s)!\n\n' +
        '**How it works:**\n' +
        '• You get 1-5 random shares of random characters\n' +
        '• Lucky rolls get even more variety\n' +
        '• Hit the **jackpot** (super rare!) for 6-10 shares across multiple characters\n\n' +
        '*Your Discord must be linked to your Stockism account to claim.*',
      color: 0x00D166,
      footer: { text: 'Resets daily • One claim per user' }
    };

    const components = [
      {
        type: 1, // Action Row
        components: [
          {
            type: 2, // Button
            style: 1, // Primary (blurple)
            label: '🎲 Claim Free Stock',
            custom_id: 'claim_daily_stock'
          },
          {
            type: 2, // Button
            style: 2, // Secondary (gray)
            label: '📋 View Last Claim',
            custom_id: 'view_last_claim'
          }
        ]
      }
    ];

    await sendDiscordMessage(null, [embed], '1483767343581761658', components);
    console.log('Daily free stock claim message posted to channel 1483767343581761658');
    return null;
  });

/**
 * Discord Interactions Webhook — handles button clicks for daily stock claim.
 * Must be registered as the Interactions Endpoint URL in Discord Developer Portal.
 */
exports.discordInteractions = functions.https.onRequest(async (req, res) => {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).send('Method not allowed');
  }

  // Verify Discord signature
  const publicKey = process.env.DISCORD_PUBLIC_KEY;
  if (!publicKey || publicKey === 'PASTE_YOUR_PUBLIC_KEY_HERE') {
    console.error('DISCORD_PUBLIC_KEY not configured');
    return res.status(500).send('Server misconfigured');
  }

  const signature = req.headers['x-signature-ed25519'];
  const timestamp = req.headers['x-signature-timestamp'];
  const rawBody = req.rawBody;

  if (!signature || !timestamp || !rawBody) {
    return res.status(401).send('Invalid request');
  }

  const isValid = await verifyKey(rawBody, signature, timestamp, publicKey);
  if (!isValid) {
    return res.status(401).send('Invalid signature');
  }

  const interaction = req.body;

  // Handle PING (required for endpoint verification)
  if (interaction.type === InteractionType.PING) {
    return res.json({ type: InteractionResponseType.PONG });
  }

  // Handle button clicks
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) {
    const customId = interaction.data?.custom_id;

    if (customId === 'claim_daily_stock') {
      const discordUserId = interaction.member?.user?.id || interaction.user?.id;
      const appId = interaction.application_id;
      const interactionToken = interaction.token;
      const messageId = interaction.message?.id;

      if (!discordUserId) {
        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Could not identify your Discord account.',
            flags: 64 // Ephemeral
          }
        });
      }

      // Send deferred ephemeral response immediately (avoids 3-second timeout)
      res.json({ type: 5, data: { flags: 64 } });

      // Helper to edit the deferred response via webhook
      const editOriginal = async (payload) => {
        await axios.patch(
          `https://discord.com/api/v10/webhooks/${appId}/${interactionToken}/messages/@original`,
          payload,
          { headers: { 'Content-Type': 'application/json' } }
        );
      };

      try {
        // Find user with this discordId
        const usersSnap = await db.collection('users')
          .where('discordId', '==', discordUserId)
          .limit(1)
          .get();

        if (usersSnap.empty) {
          await editOriginal({
            content: '🔗 Your Discord isn\'t linked to a Stockism account yet!\n\n' +
              '**Link now:** https://stockism.app/link-discord\n\n' +
              'Once linked, come back and click the button again — this doesn\'t count as your daily claim!',
          });
          return;
        }

        const userDoc = usersSnap.docs[0];
        const uid = userDoc.id;
        const userData = userDoc.data();

        // Check if this drop has expired (72-hour window)
        if (messageId) {
          const messageTimestamp = Number(BigInt(messageId) >> 22n) + 1420070400000;
          const ageHours = (Date.now() - messageTimestamp) / (1000 * 60 * 60);
          if (ageHours > 72) {
            await editOriginal({
              content: '⏰ This drop has expired! Daily drops are only claimable for 72 hours.',
            });
            return;
          }
        }

        // Check if already claimed from this specific message
        const claimedMessages = userData.claimedDailyStockMessages || [];
        if (messageId && claimedMessages.includes(messageId)) {
          await editOriginal({
            content: '⏰ You already claimed from this drop! Wait for the next one.',
          });
          return;
        }

        // Roll the loot
        const { picks, isJackpot } = await rollDailyStock();

        if (picks.length === 0) {
          await editOriginal({
            content: '❌ No stocks available right now. Try again later!',
          });
          return;
        }

        // Fetch current market prices for buy-side price impact
        const marketRef = db.collection('market').doc('current');
        const marketDoc = await marketRef.get();
        const prices = marketDoc.data()?.prices || {};

        // Build Firestore updates
        const updates = {
          lastDailyStockClaim: admin.firestore.FieldValue.serverTimestamp(),
          claimedDailyStockMessages: admin.firestore.FieldValue.arrayUnion(messageId),
          lastDailyStockResult: {
            picks: picks.map(p => ({
              ticker: p.ticker,
              name: p.name,
              shares: p.shares,
              currentPrice: p.currentPrice
            })),
            isJackpot,
            claimedAt: new Date().toISOString()
          }
        };

        const currentHoldings = userData.holdings || {};
        const currentCostBasis = userData.costBasis || {};

        for (const pick of picks) {
          const existingShares = currentHoldings[pick.ticker] || 0;
          const existingCost = currentCostBasis[pick.ticker] || 0;
          const newShares = existingShares + pick.shares;
          // Weighted average cost basis: free shares have $0 cost
          const newCostBasis = existingShares > 0
            ? (existingCost * existingShares) / newShares
            : 0;
          updates[`holdings.${pick.ticker}`] = newShares;
          updates[`costBasis.${pick.ticker}`] = newCostBasis;
        }

        // Apply buy-side price impact (simulates buy pressure for free shares)
        const timestamp = Date.now();
        const newPrices = { ...prices };
        const marketUpdates = {};

        for (const pick of picks) {
          const currentPrice = newPrices[pick.ticker];
          if (!currentPrice || currentPrice <= 0) continue;

          let priceImpact = currentPrice * BASE_IMPACT * Math.sqrt(pick.shares / BASE_LIQUIDITY);
          const maxImpact = currentPrice * MAX_PRICE_CHANGE_PERCENT;
          priceImpact = Math.min(priceImpact, maxImpact);

          newPrices[pick.ticker] = Math.round((currentPrice + priceImpact) * 100) / 100;

          marketUpdates[`priceHistory.${pick.ticker}`] = admin.firestore.FieldValue.arrayUnion({
            timestamp,
            price: newPrices[pick.ticker]
          });
        }

        marketUpdates.prices = newPrices;

        await db.collection('users').doc(uid).update(updates);
        await marketRef.update(marketUpdates);

        // Build response embed (using post-impact prices)
        const totalShares = picks.reduce((sum, p) => sum + p.shares, 0);
        const stockList = picks.map(p => {
          const displayPrice = newPrices[p.ticker] || p.currentPrice;
          return `**${p.name}** ($${p.ticker}) — ${p.shares} share${p.shares > 1 ? 's' : ''} (worth $${(p.shares * displayPrice).toFixed(2)})`;
        }).join('\n');

        const totalValue = picks.reduce((sum, p) => sum + (p.shares * (newPrices[p.ticker] || p.currentPrice)), 0);

        // Send web notification
        await writeNotification(uid, {
          type: 'system',
          title: isJackpot ? '🎰 Jackpot! Daily Stock Claim' : '🎁 Daily Stock Claimed',
          message: `You received ${totalShares} free share${totalShares !== 1 ? 's' : ''} worth $${totalValue.toFixed(2)}!`,
          data: {}
        });

        const embed = isJackpot
          ? {
            title: '🎰💰 JACKPOT!! 💰🎰',
            description: `You hit the **JACKPOT**! Here\'s what you got:\n\n${stockList}\n\n**Total: ${totalShares} shares worth $${totalValue.toFixed(2)}!**`,
            color: 0xFFD700,
            footer: { text: 'Incredible luck! 🍀' }
          }
          : {
            title: '🎁 Daily Stock Claimed!',
            description: `Here\'s what you got:\n\n${stockList}\n\n**Total: ${totalShares} share${totalShares > 1 ? 's' : ''} worth $${totalValue.toFixed(2)}**`,
            color: 0x00D166,
            footer: { text: 'Come back tomorrow for more!' }
          };

        await editOriginal({ embeds: [embed] });

      } catch (err) {
        console.error('Daily stock claim error:', err);
        try {
          await editOriginal({
            content: '❌ Something went wrong. Try again in a moment!',
          });
        } catch (followUpErr) {
          console.error('Failed to send error follow-up:', followUpErr.message);
        }
      }
      return;
    }

    if (customId === 'view_last_claim') {
      const discordUserId = interaction.member?.user?.id || interaction.user?.id;

      if (!discordUserId) {
        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Could not identify your Discord account.',
            flags: 64
          }
        });
      }

      try {
        const usersSnap = await db.collection('users')
          .where('discordId', '==', discordUserId)
          .limit(1)
          .get();

        if (usersSnap.empty) {
          return res.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '🔗 Your Discord isn\'t linked to a Stockism account yet!\n\n' +
                '**Link now:** https://stockism.app/link-discord',
              flags: 64
            }
          });
        }

        const userData = usersSnap.docs[0].data();
        const lastResult = userData.lastDailyStockResult;

        if (!lastResult || !lastResult.picks || lastResult.picks.length === 0) {
          return res.json({
            type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
            data: {
              content: '📋 No daily stock claims on record yet. Click **Claim Free Stock** to get your first!',
              flags: 64
            }
          });
        }

        const totalShares = lastResult.picks.reduce((sum, p) => sum + p.shares, 0);
        const stockList = lastResult.picks.map(p =>
          `**${p.name}** ($${p.ticker}) — ${p.shares} share${p.shares > 1 ? 's' : ''} (worth $${(p.shares * p.currentPrice).toFixed(2)})`
        ).join('\n');
        const totalValue = lastResult.picks.reduce((sum, p) => sum + (p.shares * p.currentPrice), 0);

        const claimedDate = lastResult.claimedAt
          ? new Date(lastResult.claimedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
          : 'Unknown date';

        const embed = lastResult.isJackpot
          ? {
            title: '🎰💰 Last Claim — JACKPOT! 💰🎰',
            description: `**Claimed:** ${claimedDate}\n\n${stockList}\n\n**Total: ${totalShares} shares worth $${totalValue.toFixed(2)}**`,
            color: 0xFFD700
          }
          : {
            title: '📋 Your Last Daily Claim',
            description: `**Claimed:** ${claimedDate}\n\n${stockList}\n\n**Total: ${totalShares} share${totalShares > 1 ? 's' : ''} worth $${totalValue.toFixed(2)}**`,
            color: 0x5865F2
          };

        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            embeds: [embed],
            flags: 64
          }
        });

      } catch (err) {
        console.error('View last claim error:', err);
        return res.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: {
            content: '❌ Something went wrong. Try again in a moment!',
            flags: 64
          }
        });
      }
    }
  }

  // Unknown interaction type — acknowledge
  return res.json({ type: InteractionResponseType.PONG });
});

// ─── TICKER ROLLBACK DIAGNOSTIC ──────────────────────────────────────────────
exports.diagnoseTickerRollback = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { ticker, startTimestamp } = data;
  if (!ticker || !startTimestamp) {
    throw new functions.https.HttpsError('invalid-argument', 'ticker and startTimestamp required');
  }

  const startDate = new Date(startTimestamp);

  // 1. Get price at start from priceHistory
  const marketSnap = await db.collection('market').doc('data').get();
  const marketData = marketSnap.data() || {};
  const currentPrice = (marketData.prices || {})[ticker] || 0;
  const priceHistory = (marketData.priceHistory || {})[ticker] || [];

  // Find price closest to (but before) startTimestamp
  let priceAtStart = currentPrice;
  const startMs = startDate.getTime();
  let closestBefore = null;
  for (const entry of priceHistory) {
    const entryMs = entry.timestamp?._seconds
      ? entry.timestamp._seconds * 1000
      : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
        : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
    if (entryMs <= startMs && (!closestBefore || entryMs > closestBefore.ms)) {
      closestBefore = { ms: entryMs, price: entry.price };
    }
  }
  if (closestBefore) priceAtStart = closestBefore.price;

  // 2. Query all trades for this ticker after startTimestamp
  const tradesSnap = await db.collection('trades')
    .where('ticker', '==', ticker)
    .where('timestamp', '>', startDate)
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

  // 3. Group by uid
  const userMap = {};
  for (const t of trades) {
    if (!userMap[t.uid]) {
      userMap[t.uid] = { buys: [], sells: [], shorts: [], covers: [] };
    }
    const action = (t.action || '').toLowerCase();
    if (action === 'buy') {
      userMap[t.uid].buys.push(t);
    } else if (action === 'sell') {
      userMap[t.uid].sells.push(t);
    } else if (action === 'short') {
      userMap[t.uid].shorts.push(t);
    } else if (action === 'cover') {
      userMap[t.uid].covers.push(t);
    }
  }

  const uids = Object.keys(userMap);

  // Fetch user docs
  const userDocs = {};
  for (const uid of uids) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) userDocs[uid] = snap.data();
  }

  // Build per-user breakdown
  const userBreakdowns = [];
  const profiteers = []; // users with positive net cash flow

  for (const uid of uids) {
    const { buys, sells, shorts, covers } = userMap[uid];
    const userData = userDocs[uid] || {};

    const totalTrades = buys.length + sells.length + shorts.length + covers.length;

    // Skip users with no actual trades (defensive)
    if (totalTrades === 0) continue;

    const sharesBought = buys.reduce((s, t) => s + (t.amount || 0), 0);
    const cashSpent = buys.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesSold = sells.reduce((s, t) => s + (t.amount || 0), 0);
    const cashReceived = sells.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesShorted = shorts.reduce((s, t) => s + (t.amount || 0), 0);
    const cashFromShorts = shorts.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesCovered = covers.reduce((s, t) => s + (t.amount || 0), 0);
    const cashToCover = covers.reduce((s, t) => s + (t.totalValue || 0), 0);

    // Net cash: money in (sells + shorts) minus money out (buys + covers)
    const netCashFlow = (cashReceived + cashFromShorts) - (cashSpent + cashToCover);
    const currentHoldings = (userData.holdings || {})[ticker] || 0;
    const netSharesTraded = sharesBought - sharesSold;
    const giftedShares = Math.max(0, currentHoldings - netSharesTraded);

    const firstSellTs = sells.length > 0 ? Math.min(...sells.map(s => s._ts)) : null;
    const firstShortTs = shorts.length > 0 ? Math.min(...shorts.map(s => s._ts)) : null;
    // Earliest cash-generating trade (sell or short)
    const firstCashInTs = [firstSellTs, firstShortTs].filter(Boolean).length > 0
      ? Math.min(...[firstSellTs, firstShortTs].filter(Boolean))
      : null;

    const entry = {
      uid,
      displayName: userData.displayName || 'Unknown',
      isBot: userData.isBot || false,
      sharesBought,
      cashSpent: Math.round(cashSpent * 100) / 100,
      sharesSold,
      cashReceived: Math.round(cashReceived * 100) / 100,
      sharesShorted,
      cashFromShorts: Math.round(cashFromShorts * 100) / 100,
      sharesCovered,
      cashToCover: Math.round(cashToCover * 100) / 100,
      netCashFlow: Math.round(netCashFlow * 100) / 100,
      currentHoldings,
      currentCash: Math.round((userData.cash || 0) * 100) / 100,
      giftedShares,
      totalTrades,
      firstSellTs,
      firstCashInTs
    };

    userBreakdowns.push(entry);
    if (netCashFlow > 0 && firstCashInTs) {
      profiteers.push({ uid, netCashFlow, firstCashInTs, displayName: entry.displayName });
    }
  }

  // Sort by net cash flow descending
  userBreakdowns.sort((a, b) => b.netCashFlow - a.netCashFlow);

  // 4. Ripple effects — what did profiteers buy after selling ticker?
  const rippleByTicker = {};
  const userRipples = {};

  for (const p of profiteers) {
    // Get all non-ticker trades after first cash-generating trade
    const otherTradesSnap = await db.collection('trades')
      .where('uid', '==', p.uid)
      .where('timestamp', '>', new Date(p.firstCashInTs))
      .get();

    let spentOnOthers = 0;
    const byTicker = {};

    otherTradesSnap.forEach(doc => {
      const t = doc.data();
      if (t.ticker === ticker) return; // skip same ticker
      const action = (t.action || '').toLowerCase();
      if (action !== 'buy') return;
      const cost = t.totalValue || 0;
      spentOnOthers += cost;
      byTicker[t.ticker] = (byTicker[t.ticker] || 0) + cost;
    });

    // Cap at their profit from the target ticker
    const cappedSpent = Math.min(spentOnOthers, p.netCashFlow);

    if (cappedSpent > 0) {
      userRipples[p.uid] = {
        displayName: p.displayName,
        shroProfit: Math.round(p.netCashFlow * 100) / 100,
        spentOnOtherStocks: Math.round(cappedSpent * 100) / 100,
        breakdown: {}
      };

      // Scale per-ticker amounts if we capped
      const scale = spentOnOthers > 0 ? cappedSpent / spentOnOthers : 0;
      for (const [t, amount] of Object.entries(byTicker)) {
        const scaled = Math.round(amount * scale * 100) / 100;
        userRipples[p.uid].breakdown[t] = scaled;
        rippleByTicker[t] = (rippleByTicker[t] || 0) + scaled;
      }
    }
  }

  // Round ripple totals
  for (const t of Object.keys(rippleByTicker)) {
    rippleByTicker[t] = Math.round(rippleByTicker[t] * 100) / 100;
  }

  // Sort ripple by amount
  const sortedRipple = Object.entries(rippleByTicker)
    .sort((a, b) => b[1] - a[1])
    .map(([t, amount]) => ({ ticker: t, amount }));

  // 5. Summary
  const totalCashOut = userBreakdowns
    .filter(u => u.netCashFlow > 0)
    .reduce((s, u) => s + u.netCashFlow, 0);
  const totalCashIntoOthers = Object.values(rippleByTicker).reduce((s, v) => s + v, 0);

  const summary = {
    ticker,
    priceAtStart: Math.round(priceAtStart * 100) / 100,
    currentPrice: Math.round(currentPrice * 100) / 100,
    priceInflation: priceAtStart > 0
      ? Math.round(((currentPrice - priceAtStart) / priceAtStart) * 10000) / 100
      : 0,
    totalUsers: userBreakdowns.length,
    totalTrades: trades.length,
    totalCashOut: Math.round(totalCashOut * 100) / 100,
    cashIntoOtherStocks: Math.round(totalCashIntoOthers * 100) / 100,
    cashSittingAsCash: Math.round((totalCashOut - totalCashIntoOthers) * 100) / 100,
    windowStart: startDate.toISOString()
  };

  return {
    summary,
    users: userBreakdowns,
    rippleByTicker: sortedRipple,
    userRipples
  };
});

// ─── TICKER RECOVERY ────────────────────────────────────────────────────────
exports.recoverTicker = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { ticker, startTimestamp, targetPrice, dryRun } = data;
  if (!ticker || !startTimestamp || targetPrice === undefined || targetPrice === null) {
    throw new functions.https.HttpsError('invalid-argument', 'ticker, startTimestamp, and targetPrice required');
  }

  // 1. Re-run diagnostic server-side (don't trust client data)
  const startDate = new Date(startTimestamp);

  const marketSnap = await db.collection('market').doc('data').get();
  const marketData = marketSnap.data() || {};
  const currentPrice = (marketData.prices || {})[ticker] || 0;

  // Query all trades for this ticker after startTimestamp
  const tradesSnap = await db.collection('trades')
    .where('ticker', '==', ticker)
    .where('timestamp', '>', startDate)
    .get();

  const trades = [];
  tradesSnap.forEach(doc => {
    const t = doc.data();
    const ts = t.timestamp?._seconds
      ? t.timestamp._seconds * 1000
      : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
    trades.push({ ...t, _ts: ts, id: doc.id });
  });

  // Group by uid
  const userMap = {};
  for (const t of trades) {
    if (!userMap[t.uid]) {
      userMap[t.uid] = { buys: [], sells: [], shorts: [], covers: [] };
    }
    const action = (t.action || '').toLowerCase();
    if (action === 'buy') userMap[t.uid].buys.push(t);
    else if (action === 'sell') userMap[t.uid].sells.push(t);
    else if (action === 'short') userMap[t.uid].shorts.push(t);
    else if (action === 'cover') userMap[t.uid].covers.push(t);
  }

  const uids = Object.keys(userMap);

  // Fetch user docs
  const userDocs = {};
  for (const uid of uids) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) userDocs[uid] = snap.data();
  }

  // Build per-user net cash flow
  const clawbacks = [];
  const holdersAffected = [];
  let totalClawedBack = 0;
  let totalUnrecoverable = 0;

  const recoveryId = `recover_${ticker}_${Date.now()}`;

  for (const uid of uids) {
    const { buys, sells, shorts, covers } = userMap[uid];
    const userData = userDocs[uid] || {};

    // Skip bots
    if (userData.isBot) continue;

    const totalTrades = buys.length + sells.length + shorts.length + covers.length;
    if (totalTrades === 0) continue;

    const cashSpent = buys.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashReceived = sells.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashFromShorts = shorts.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashToCover = covers.reduce((s, t) => s + (t.totalValue || 0), 0);
    const netCashFlow = (cashReceived + cashFromShorts) - (cashSpent + cashToCover);

    // Track holders who will see value drop from price reset
    const currentHoldings = (userData.holdings || {})[ticker] || 0;
    if (currentHoldings > 0 && targetPrice < currentPrice) {
      const valueDrop = currentHoldings * (currentPrice - targetPrice);
      holdersAffected.push({
        uid,
        displayName: userData.displayName || 'Unknown',
        holdings: currentHoldings,
        valueDrop: Math.round(valueDrop * 100) / 100
      });
    }

    // Only claw back from profiteers
    if (netCashFlow <= 0) continue;

    // Check for existing recovery log (idempotent)
    const repairLog = userData._repairLog || [];
    if (repairLog.some(entry => entry.recoveryId === recoveryId)) continue;

    const previousCash = Math.round((userData.cash || 0) * 100) / 100;
    const clawbackAmount = Math.round(netCashFlow * 100) / 100;
    const newCash = Math.max(0, previousCash - clawbackAmount);
    const actualClawback = Math.round((previousCash - newCash) * 100) / 100;
    const wasFloored = actualClawback < clawbackAmount;

    if (wasFloored) {
      totalUnrecoverable += (clawbackAmount - actualClawback);
    }
    totalClawedBack += actualClawback;

    clawbacks.push({
      uid,
      displayName: userData.displayName || 'Unknown',
      previousCash,
      newCash,
      clawbackAmount,
      actualClawback,
      wasFloored
    });
  }

  totalClawedBack = Math.round(totalClawedBack * 100) / 100;
  totalUnrecoverable = Math.round(totalUnrecoverable * 100) / 100;

  const result = {
    dryRun: !!dryRun,
    ticker,
    priceReset: { from: Math.round(currentPrice * 100) / 100, to: targetPrice },
    clawbacks,
    holdersAffected,
    totalClawedBack,
    totalUnrecoverable
  };

  // If dry run, return preview only
  if (dryRun) return result;

  // 2. Execute writes
  const batch = db.batch();

  // Reset price
  batch.update(db.collection('market').doc('data'), {
    [`prices.${ticker}`]: targetPrice
  });

  // Claw back cash from profiteers
  for (const cb of clawbacks) {
    const userRef = db.collection('users').doc(cb.uid);
    batch.update(userRef, {
      cash: cb.newCash,
      _repairLog: admin.firestore.FieldValue.arrayUnion({
        recoveryId,
        type: 'ticker_recovery',
        ticker,
        clawbackAmount: cb.actualClawback,
        previousCash: cb.previousCash,
        newCash: cb.newCash,
        timestamp: new Date().toISOString()
      })
    });
  }

  await batch.commit();

  return result;
});

