'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { LEADERBOARD_CACHE_TTL, ADMIN_UID, FOURTEEN_DAYS_MS, THIRTY_DAYS_MS, PUBLIC_PROFILE_SPARKLINE_MAX_POINTS } = require('../constants');

// In-memory cache — persists across invocations on same instance
const leaderboardCache = {};

// Fields the leaderboard actually displays — projected with .select() so we
// never pull heavy unused maps (holdings is needed for holdingsCount).
const LEADERBOARD_FIELDS = [
  'displayName', 'portfolioValue', 'crew', 'isCrewHead', 'crewHeadColor',
  'holdings', 'displayCrewPin', 'displayedAchievementPins', 'achievements',
  'displayedShopPins', 'previousDisplayName', 'nameChangedAt',
  'activeCosmetics', 'isPublic', 'isBot', 'portfolioSnapshot7d',
];

// Caller's rank via count aggregations (~1 read per 1000 counted) instead of
// reading one doc per higher-ranked user. Bots are subtracted with a second
// count so ranks match the bot-free leaderboard.
const countRankAbove = async (value, crew) => {
  let above = db.collection('users').where('portfolioValue', '>', value);
  let botsAbove = db.collection('users').where('isBot', '==', true).where('portfolioValue', '>', value);
  if (crew) {
    above = above.where('crew', '==', crew);
    botsAbove = botsAbove.where('crew', '==', crew);
  }
  const [aboveSnap, botsSnap] = await Promise.all([above.count().get(), botsAbove.count().get()]);
  return Math.max(0, aboveSnap.data().count - botsSnap.data().count) + 1;
};

exports.getLeaderboard = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  try {
    const { crew, sortBy = 'value' } = data || {};
    const cacheKey = crew ? (sortBy === 'weeklyGain' ? `weeklyGain_${crew}` : crew) : (sortBy === 'weeklyGain' ? 'weeklyGain' : 'global');
    const docRef = db.collection('leaderboard').doc(cacheKey);

    // Layer 1: in-memory cache (this warm instance). Layer 2: the shared
    // Firestore doc — written on every recompute so clients (and other
    // instances) can read the same result directly without recomputing.
    let leaderboard;
    const cached = leaderboardCache[cacheKey];
    if (cached && (Date.now() - cached.timestamp) < LEADERBOARD_CACHE_TTL) {
      leaderboard = cached.data;
    }
    if (!leaderboard) {
      const docSnap = await docRef.get();
      if (docSnap.exists && (Date.now() - (docSnap.data().generatedAt || 0)) < LEADERBOARD_CACHE_TTL) {
        leaderboard = docSnap.data().entries || [];
        leaderboardCache[cacheKey] = { data: leaderboard, timestamp: docSnap.data().generatedAt };
      }
    }
    if (!leaderboard) {
      if (sortBy === 'weeklyGain') {
        let query = db.collection('users');
        if (crew) {
          query = query.where('crew', '==', crew);
        }
        // Get a reasonable set to calculate gains from
        query = query.orderBy('portfolioValue', 'desc').limit(200).select(...LEADERBOARD_FIELDS);

        const snapshot = await query.get();
        const twoWeeksAgo = Date.now() - FOURTEEN_DAYS_MS;

        const allUsers = [];
        snapshot.forEach(doc => {
          const userData = doc.data();
          if (userData.isBot) return;

          if (!userData.portfolioSnapshot7d || userData.portfolioSnapshot7d.timestamp < twoWeeksAgo) return;

          const currentValue = userData.portfolioValue || 0;
          const valueSevenDaysAgo = userData.portfolioSnapshot7d.value;

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
            weeklyGainPercent: Math.round(weeklyGainPercent * 100) / 100,
            previousDisplayName: userData.previousDisplayName || null,
            nameChangedAt: userData.nameChangedAt || null,
            activeCosmetics: userData.activeCosmetics || null,
            isPublic: userData.isPublic || false,
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

        query = query.orderBy('portfolioValue', 'desc').limit(100).select(...LEADERBOARD_FIELDS);

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
            displayedShopPins: userData.displayedShopPins || [],
            previousDisplayName: userData.previousDisplayName || null,
            nameChangedAt: userData.nameChangedAt || null,
            activeCosmetics: userData.activeCosmetics || null,
            isPublic: userData.isPublic || false,
          });
        });
      }

      // Cache in memory and publish to the shared Firestore doc so every
      // other instance — and every client — can serve this without recomputing
      const now = Date.now();
      leaderboardCache[cacheKey] = { data: leaderboard, timestamp: now };
      try {
        await docRef.set({ entries: leaderboard, generatedAt: now, key: cacheKey });
      } catch (e) {
        console.error('leaderboard doc publish failed:', e.message);
      }
    }

    // Find caller's rank if authenticated (always per-request)
    let callerRank = null;
    if (context.auth) {
      const callerIndex = leaderboard.findIndex(entry => entry.userId === context.auth.uid);
      if (callerIndex !== -1) {
        callerRank = callerIndex + 1;
      } else if (sortBy !== 'weeklyGain') {
        // Caller is outside top 50 — count aggregation instead of reading one
        // doc per higher-ranked user (that scaled with the caller's rank)
        try {
          const callerDoc = await db.collection('users').doc(context.auth.uid).select('isBot', 'portfolioValue').get();
          if (callerDoc.exists && !callerDoc.data().isBot) {
            callerRank = await countRankAbove(callerDoc.data().portfolioValue || 0, crew);
          }
        } catch (e) {
          // Leave callerRank null if lookup fails
        }
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
 * Get public profile by username
 */
exports.getPublicProfile = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  const { username } = data || {};
  if (!username || typeof username !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Username required');
  }

  // Resolve username → uid via usernames collection, fallback to querying by displayNameLower
  let uid;
  const usernameDoc = await db.collection('usernames').doc(username.toLowerCase()).get();
  if (usernameDoc.exists) {
    uid = usernameDoc.data().uid;
  } else {
    const fallbackSnap = await db.collection('users')
      .where('displayNameLower', '==', username.toLowerCase())
      .limit(1)
      .get();
    if (fallbackSnap.empty) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    uid = fallbackSnap.docs[0].id;
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const userData = userDoc.data();

  const isOwner = context.auth?.uid === uid;
  const isCallerAdmin = context.auth?.uid === ADMIN_UID;
  if (!userData.isPublic && !isOwner && !isCallerAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'This profile is private');
  }

  const marketSnap = await db.collection('market').doc('current').get();
  const prices = marketSnap.exists ? (marketSnap.data().prices || {}) : {};

  // Compute global rank (count aggregation — cheap regardless of rank)
  let rank = null;
  try {
    rank = await countRankAbove(userData.portfolioValue || 0, null);
  } catch (e) { /* leave null */ }

  // Holdings tickers only (no share counts exposed), sorted by share count for top holdings
  const holdingsRaw = userData.holdings || {};
  const holdingTickers = Object.keys(holdingsRaw).filter(k => (holdingsRaw[k] || 0) > 0);
  const topHoldings = [...holdingTickers]
    .sort((a, b) => (holdingsRaw[b] || 0) - (holdingsRaw[a] || 0))
    .slice(0, 5);

  // Crew rank (count aggregation)
  let crewRank = null;
  if (userData.crew) {
    try {
      crewRank = await countRankAbove(userData.portfolioValue || 0, userData.crew);
    } catch (e) { /* leave null */ }
  }

  // Short positions (tickers only, no share counts)
  const shortsRaw = userData.shorts || {};
  const shortTickers = Object.keys(shortsRaw).filter(t => {
    const pos = shortsRaw[t];
    return pos && pos.shares > 0;
  });
  const totalShortValue = shortTickers.reduce((sum, t) => {
    return sum + (shortsRaw[t].shares * (prices[t] || 0));
  }, 0);

  // Portfolio history for sparkline — last 30 days, capped so a very active
  // account can't turn one profile view into thousands of doc reads.
  const histSnap = await db.collection('users').doc(uid)
    .collection('portfolioHistory')
    .where('timestamp', '>=', Date.now() - THIRTY_DAYS_MS)
    .orderBy('timestamp', 'desc')
    .limit(PUBLIC_PROFILE_SPARKLINE_MAX_POINTS)
    .get();
  const portfolioHistory = histSnap.docs.map(d => d.data()).reverse();

  // Admin-only: weekly gain + full financial data
  let adminData = null;
  if (isCallerAdmin) {
    const currentValue = userData.portfolioValue || 0;
    const valueSevenDaysAgo = userData.portfolioSnapshot7d?.value ?? currentValue;
    const weeklyGain = currentValue - valueSevenDaysAgo;
    const weeklyGainPercent = valueSevenDaysAgo > 0
      ? Math.round((weeklyGain / valueSevenDaysAgo) * 10000) / 100
      : 0;

    adminData = {
      uid,
      cash: userData.cash || 0,
      marginUsed: userData.marginUsed || 0,
      marginEnabled: userData.marginEnabled || false,
      netEquity: (userData.portfolioValue || 0) - (userData.marginUsed || 0),
      weeklyGain,
      weeklyGainPercent,
      holdings: userData.holdings || {},
      shorts: userData.shorts || {},
      isBanned: userData.isBanned || false,
      isBot: userData.isBot || false,
    };
  }

  return {
    displayName: userData.displayName || 'Anonymous',
    crew: userData.crew || null,
    isCrewHead: userData.isCrewHead || false,
    crewHeadColor: userData.crewHeadColor || null,
    activeCosmetics: userData.activeCosmetics || null,
    displayCrewPin: userData.displayCrewPin || null,
    displayedAchievementPins: userData.displayedAchievementPins || [],
    displayedShopPins: userData.displayedShopPins || [],
    portfolioValue: userData.portfolioValue || 0,
    holdingsCount: holdingTickers.length,
    rank,
    crewRank,
    holdingTickers,
    topHoldings,
    shortTickers,
    totalShortValue,
    portfolioHistory,
    adminData,
    achievements: userData.achievements || [],
    stats: {
      totalTrades: userData.totalTrades || 0,
      predictionWins: userData.predictionWins || 0,
      totalCheckins: userData.totalCheckins || 0,
      checkinStreak: userData.checkinStreak || 0,
      peakPortfolioValue: userData.peakPortfolioValue || 0,
      createdAt: userData.createdAt || null,
    },
  };
});

/**
 * Daily Market Summary - Runs daily at 21:00 UTC
 */
