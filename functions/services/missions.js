'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CREW_MEMBERS, MISSION_REWARDS } = require('../constants');
const { writeNotification, writeFeedEntry, checkBanned } = require('../helpers');

// Server-side mission completion verification
// Maps mission IDs to their completion check logic
const DAILY_MISSION_CHECKS = {
  BUY_CREW_MEMBER: (dp) => !!dp.boughtCrewMember,
  HOLD_CREW_SHARES: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const total = CREW_MEMBERS[crew].reduce((s, t) => s + ((userData.holdings || {})[t] || 0), 0);
    return total >= 20;
  },
  MAKE_TRADES: (dp) => (dp.tradesCount || 0) >= 5,
  BUY_ANY_STOCK: (dp) => !!dp.boughtAny,
  SELL_ANY_STOCK: (dp) => !!dp.soldAny,
  HOLD_LARGE_POSITION: (dp, userData) => {
    const vals = Object.values(userData.holdings || {});
    return vals.length > 0 && Math.max(...vals) >= 50;
  },
  TRADE_VOLUME: (dp) => (dp.tradeVolume || 0) >= 500,
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
    return maxHolding >= 35;
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
  CREW_ACCUMULATOR: (dp) => (dp.crewSharesBought || 0) >= 20
};

const WEEKLY_MISSION_CHECKS = {
  MARKET_WHALE: (wp) => (wp.tradeValue || 0) >= 20000,
  VOLUME_KING: (wp) => (wp.tradeVolume || 0) >= 200,
  TRADING_MACHINE: (wp) => (wp.tradeCount || 0) >= 40,
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
    return total >= 75;
  },
  FULL_CREW_OWNERSHIP: (wp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const members = CREW_MEMBERS[crew];
    return members.length > 0 && members.every(t => ((userData.holdings || {})[t] || 0) >= 8);
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
    return startValue > 0 && (userData.portfolioValue || 0) - startValue >= 3500;
  },
  SHARE_MOGUL: (wp) => (wp.tradeVolume || 0) >= 400,
  TRADE_MASTER: (wp) => (wp.tradeCount || 0) >= 75,
  HEAVY_BAGS: (wp, userData) => {
    const total = Object.values(userData.holdings || {}).reduce((s, v) => s + (v > 0 ? v : 0), 0);
    return total >= 300;
  },
  PENNY_COLLECTOR: (wp, userData, prices) => {
    let pennyShares = 0;
    Object.entries(userData.holdings || {}).forEach(([t, s]) => {
      if (s > 0 && ((prices || {})[t] || 0) < 25) pennyShares += s;
    });
    return pennyShares >= 80;
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
    return startValue > 0 && (userData.portfolioValue || 0) - startValue >= 8000;
  }
};

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
 * Costs $50, once per week, locked if any rewards claimed
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

    // Check has $50
    const cash = userData.cash || 0;
    if (cash < 50) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough cash. Need $50.');
    }

    // Generate random seed offset
    const rerollSeed = Math.floor(Math.random() * 100000) + 1;

    const updates = {
      cash: cash - 50,
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
      const bestStreak = Math.max(userData.maxCheckinStreak || 0, userData.checkinStreak || 0);
      if (pinInfo.requiredCheckinStreak && bestStreak < pinInfo.requiredCheckinStreak) {
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
