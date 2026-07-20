'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CREW_MEMBERS } = require('../constants');
const { getDailyMissions, getCrewWeeklyMissions, getCrewMultiplier, DAILY_MISSIONS, WEEKLY_MISSIONS } = require('../crews');
const { writeNotification, writeFeedEntry, checkBanned, checkDiscordWall, touchLastActive } = require('../helpers');

// Server-side mission completion verification
// Maps mission IDs to their completion check logic
const DAILY_MISSION_CHECKS = {
  // Action-based: require something the player did today.
  BUY_CREW_MEMBER: (dp) => !!dp.boughtCrewMember,
  MAKE_TRADES: (dp) => (dp.tradesCount || 0) >= 5,
  BUY_ANY_STOCK: (dp) => !!dp.boughtAny,
  SELL_ANY_STOCK: (dp) => !!dp.soldAny,
  TRADE_VOLUME: (dp) => (dp.tradeVolume || 0) >= DAILY_MISSIONS.TRADE_VOLUME.requirement,
  RIVAL_TRADER: (dp) => !!dp.boughtRival,
  UNDERDOG_INVESTOR: (dp) => !!dp.boughtUnderdog,
  CREW_ACCUMULATOR: (dp) => (dp.crewSharesBought || 0) >= 20,
  // Composition-based: a percentage you actively maintain (fair across sizes).
  CREW_MAJORITY: (dp, userData) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const holdings = userData.holdings || {};
    const total = Object.values(holdings).reduce((s, v) => s + v, 0);
    if (total <= 0) return false;
    const crewShares = CREW_MEMBERS[crew].reduce((s, t) => s + (holdings[t] || 0), 0);
    return (crewShares / total) * 100 >= 50;
  }
};

const WEEKLY_MISSION_CHECKS = {
  // Activity-based: a week's worth of trading / consistency.
  MARKET_WHALE: (wp) => (wp.tradeValue || 0) >= WEEKLY_MISSIONS.MARKET_WHALE.requirement,
  VOLUME_KING: (wp) => (wp.tradeVolume || 0) >= WEEKLY_MISSIONS.VOLUME_KING.requirement,
  TRADING_MACHINE: (wp) => (wp.tradeCount || 0) >= WEEKLY_MISSIONS.TRADING_MACHINE.requirement,
  SHARE_MOGUL: (wp) => (wp.tradeVolume || 0) >= WEEKLY_MISSIONS.SHARE_MOGUL.requirement,
  TRADE_MASTER: (wp) => (wp.tradeCount || 0) >= WEEKLY_MISSIONS.TRADE_MASTER.requirement,
  TRADING_STREAK: (wp) => Object.keys(wp.tradingDays || {}).length >= WEEKLY_MISSIONS.TRADING_STREAK.requirement,
  DAILY_GRINDER: (wp) => Object.keys(wp.checkinDays || {}).length >= WEEKLY_MISSIONS.DAILY_GRINDER.requirement,
  // Composition-based: a percentage of portfolio value you actively maintain.
  CREW_MAXIMALIST: (wp, userData, prices) => {
    const crew = userData.crew;
    if (!crew || !CREW_MEMBERS[crew]) return false;
    const holdings = userData.holdings || {};
    let totalVal = 0, crewVal = 0;
    Object.entries(holdings).forEach(([t, s]) => {
      if (s > 0) { const v = s * ((prices || {})[t] || 0); totalVal += v; if (CREW_MEMBERS[crew].includes(t)) crewVal += v; }
    });
    return totalVal > 0 && (crewVal / totalVal) * 100 >= WEEKLY_MISSIONS.CREW_MAXIMALIST.requirement;
  },
  // Growth is percentage-based so big accounts can't auto-complete on free
  // cash income and small accounts aren't locked out by flat dollar targets
  PORTFOLIO_BUILDER: (wp, userData) => {
    const startValue = wp.startPortfolioValue || 0;
    if (startValue <= 0) return false;
    const growthPct = (((userData.portfolioValue || 0) - startValue) / startValue) * 100;
    return growthPct >= WEEKLY_MISSIONS.PORTFOLIO_BUILDER.requirement;
  },
  PORTFOLIO_MOONSHOT: (wp, userData) => {
    const startValue = wp.startPortfolioValue || 0;
    if (startValue <= 0) return false;
    const growthPct = (((userData.portfolioValue || 0) - startValue) / startValue) * 100;
    return growthPct >= WEEKLY_MISSIONS.PORTFOLIO_MOONSHOT.requirement;
  }
};

exports.claimMissionReward = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { missionId, type } = data;

  if (!missionId || !type || !['daily', 'weekly'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid mission data.');
  }

  const userRef = db.collection('users').doc(uid);

  const marketRef = db.collection('market').doc('current');
  const crewStatsRef = db.collection('market').doc('crewStats');

  return db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc, crewStatsDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(marketRef),
      transaction.get(crewStatsRef)
    ]);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
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

    // The mission must actually be assigned to this user today/this week.
    // The client only shows assigned missions; without this check a direct
    // call could claim every mission in the catalog each day.
    if (!userData.crew) {
      throw new functions.https.HttpsError('failed-precondition', 'Must be in a crew.');
    }
    const rerollSeed = userData.weeklyMissions?.[weekId]?.rerollSeed || 0;
    const assignedMissions = type === 'daily'
      ? getDailyMissions(today, userData.crew, rerollSeed)
      : getCrewWeeklyMissions(userData.crew, weekId, rerollSeed);
    const assignedMission = assignedMissions.find((m) => m.id === missionId);
    if (!assignedMission) {
      throw new functions.https.HttpsError('failed-precondition', 'Mission not assigned.');
    }

    // Server-defined reward (ignoring client-provided values entirely),
    // scaled by the crew's underdog multiplier for this week.
    const crewMultiplier = getCrewMultiplier(crewStatsDoc.exists ? crewStatsDoc.data() : null, userData.crew);
    const reward = Math.round(assignedMission.reward * crewMultiplier);

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
exports.rerollMissions = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);

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
exports.purchasePin = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { action, pinId, slotType } = data;

  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);

    if (action === 'buyPin') {
      // J High pins were pulled (ripped official art). No purchasable shop pins
      // currently exist; any buy attempt is rejected below as an invalid pin.
      const PIN_CATALOG = {};
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
