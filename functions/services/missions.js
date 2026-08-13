'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const { CHECKIN_STREAK_REWARDS } = require('../constants');
const { getDailyMissions, getCrewWeeklyMissions, getCrewMultiplier } = require('../crews');
const { writeNotification, writeFeedEntry, checkBanned, checkDiscordWall, touchLastActive, grantedValueUpdate } = require('../helpers');

// Mission completion rules live in ./missionChecks so the Discord bot's
// /missions command reads the exact same logic instead of a second copy.
const { DAILY_MISSION_CHECKS, WEEKLY_MISSION_CHECKS } = require('./missionChecks');

exports.claimMissionReward = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'missions');
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
      totalMissionsCompleted: newTotal,
      // Free money: booked so percent-return boards can net it out.
      ...grantedValueUpdate(reward),
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
  touchLastActive(uid, 'missions');
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
  touchLastActive(uid, 'pins');
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

// Daily check-in reward. Lives here rather than users.js because the streak it
// pays out on is the same daily-reward loop as the missions above.
exports.dailyCheckin = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'dailyCheckin');
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
      checkDiscordWall(userData);
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
      const maxCheckinStreak = Math.max(userData.maxCheckinStreak || 0, newStreak);

      // Streak-based reward: escalates with the consecutive-day streak, then caps.
      const rewardIndex = Math.min(newStreak - 1, CHECKIN_STREAK_REWARDS.length - 1);
      const checkinReward = CHECKIN_STREAK_REWARDS[rewardIndex];

      // Compute week ID for weekly missions
      const weekStartDate = new Date(now);
      weekStartDate.setDate(weekStartDate.getDate() - weekStartDate.getDay() + 1);
      if (weekStartDate > now) weekStartDate.setDate(weekStartDate.getDate() - 7);
      const checkinWeekId = weekStartDate.toISOString().split('T')[0];

      // Update user document
      const updates = {
        cash: (userData.cash || 0) + checkinReward,
        ...grantedValueUpdate(checkinReward),
        lastCheckin: Timestamp.now(),
        checkinStreak: newStreak,
        maxCheckinStreak,
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
        // New player — initialize with $500. The whole grant is non-withdrawable
        // "house chips": it can be played but not cashed out to main cash, so the
        // check-in stake can't be looped into free spendable cash via the ladder.
        ladderTopUpAmount = 500;
        updates.ladderGameInitialized = true;
        transaction.set(ladderRef, {
          uid,
          displayName: userData.displayName || 'Anonymous',
          balance: 500,
          nonWithdrawable: 500,
          totalDeposited: 0,
          totalWon: 0,
          totalLost: 0,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          currentStreak: 0,
          bestStreak: 0,
          lastPlayed: null,
          createdAt: FieldValue.serverTimestamp()
        });
      } else {
        // Existing player — top up to $100 if below. The topped-up amount is also
        // non-withdrawable so it can fund play but never be cashed out.
        const ladderBalance = ladderDoc.data().balance || 0;
        if (ladderBalance < 100) {
          ladderTopUpAmount = 100 - ladderBalance;
          transaction.update(ladderRef, {
            balance: 100,
            nonWithdrawable: FieldValue.increment(ladderTopUpAmount)
          });
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
