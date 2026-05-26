'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { LEADERBOARD_CACHE_TTL } = require('../constants');

// In-memory cache — persists across invocations on same instance
const leaderboardCache = {};

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
            displayedShopPins: userData.displayedShopPins || [],
            previousDisplayName: userData.previousDisplayName || null,
            nameChangedAt: userData.nameChangedAt || null,
            activeCosmetics: userData.activeCosmetics || null,
            isPublic: userData.isPublic || false,
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
      } else if (sortBy !== 'weeklyGain') {
        // Caller is outside top 50 — count how many non-bot users have a higher portfolioValue
        try {
          const callerDoc = await db.collection('users').doc(context.auth.uid).select('isBot', 'portfolioValue').get();
          if (callerDoc.exists) {
            const callerData = callerDoc.data();
            if (!callerData.isBot) {
              const callerValue = callerData.portfolioValue || 0;
              let rankQuery = db.collection('users').where('portfolioValue', '>', callerValue).select('isBot');
              if (crew) rankQuery = rankQuery.where('crew', '==', crew);
              const higherSnapshot = await rankQuery.get();
              const higherCount = higherSnapshot.docs.filter(d => !d.data().isBot).length;
              callerRank = higherCount + 1;
            }
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
exports.getPublicProfile = functions.https.onCall(async (data, context) => {
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
  if (!userData.isPublic && !isOwner) {
    throw new functions.https.HttpsError('permission-denied', 'This profile is private');
  }

  const marketSnap = await db.collection('market').doc('current').get();
  const prices = marketSnap.exists ? (marketSnap.data().prices || {}) : {};

  // Compute global rank
  let rank = null;
  try {
    const rankQuery = db.collection('users').where('portfolioValue', '>', userData.portfolioValue || 0).select('isBot');
    const higherSnap = await rankQuery.get();
    const higherCount = higherSnap.docs.filter(d => !d.data().isBot).length;
    rank = higherCount + 1;
  } catch (e) { /* leave null */ }

  // Holdings tickers only (no share counts exposed), sorted by share count for top holdings
  const holdingsRaw = userData.holdings || {};
  const holdingTickers = Object.keys(holdingsRaw).filter(k => (holdingsRaw[k] || 0) > 0);
  const topHoldings = [...holdingTickers]
    .sort((a, b) => (holdingsRaw[b] || 0) - (holdingsRaw[a] || 0))
    .slice(0, 5);

  // Crew rank
  let crewRank = null;
  if (userData.crew) {
    try {
      const crewSnap = await db.collection('users')
        .where('crew', '==', userData.crew)
        .where('portfolioValue', '>', userData.portfolioValue || 0)
        .select('isBot')
        .get();
      const higherCrewCount = crewSnap.docs.filter(d => !d.data().isBot).length;
      crewRank = higherCrewCount + 1;
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

  // Portfolio history for sparkline (cap at 100 points)
  const portfolioHistory = (userData.portfolioHistory || []).slice(-100);

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
