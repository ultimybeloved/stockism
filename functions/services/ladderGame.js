'use strict';
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const { checkBanned, getTotalInvested } = require('../helpers');
const {
  LADDER_GAME_MAX_BALANCE,
  LADDER_GAME_MAX_DAILY_DEPOSIT,
  LADDER_GAME_INITIAL_BALANCE,
  LADDER_HIGH_BET_THRESHOLD,
  LADDER_ACHIEVEMENT_PROFIT,
  LADDER_ACHIEVEMENT_HIGH_BETS,
  ADMIN_UID,
} = require('../constants');

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
        balance: LADDER_GAME_INITIAL_BALANCE,
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

      // Update user stats — ceil to keep balance a clean integer
      userData.balance = Math.ceil(userData.balance - amount + payout);
      userData.gamesPlayed += 1;
      if (amount >= LADDER_HIGH_BET_THRESHOLD) userData.highBetGames = (userData.highBetGames || 0) + 1;
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


      // Check ladder game achievements
      const currentAchievements = mainUser?.achievements || [];
      const ladderNewAchievements = [];
      const netProfit = userData.totalWon - userData.totalLost;
      if (netProfit >= LADDER_ACHIEVEMENT_PROFIT && !currentAchievements.includes('COMPULSIVE_GAMBLER')) ladderNewAchievements.push('COMPULSIVE_GAMBLER');
      if ((userData.highBetGames || 0) >= LADDER_ACHIEVEMENT_HIGH_BETS && !currentAchievements.includes('ADDICTED')) ladderNewAchievements.push('ADDICTED');
      if ((userData.balance || 0) <= 0 && !currentAchievements.includes('JIHOISM')) ladderNewAchievements.push('JIHOISM');

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
  const amount = Math.ceil(data.amount);

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

      // Cap: ladder balance can't exceed what the user has invested in stocks
      // (cost basis of holdings + open short margin). Mirrors the prediction market.
      const totalInvested = getTotalInvested(mainUser);
      if (totalInvested <= 0) {
        throw new functions.https.HttpsError('failed-precondition', 'Invest in stocks before depositing to the ladder game.');
      }

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

      const currentBalance = ladderData.balance ?? 0;
      if (currentBalance >= LADDER_GAME_MAX_BALANCE) {
        throw new functions.https.HttpsError('failed-precondition', `Ladder balance is already at the $${LADDER_GAME_MAX_BALANCE.toLocaleString()} limit.`);
      }
      if (currentBalance + amount > LADDER_GAME_MAX_BALANCE) {
        throw new functions.https.HttpsError('failed-precondition', `You can only deposit $${(LADDER_GAME_MAX_BALANCE - currentBalance).toFixed(2)} more before hitting the $${LADDER_GAME_MAX_BALANCE.toLocaleString()} cap.`);
      }

      // Enforce the invested-in-stocks cap on the ladder balance.
      if (currentBalance + amount > totalInvested) {
        const room = Math.max(0, totalInvested - currentBalance);
        throw new functions.https.HttpsError('failed-precondition',
          room <= 0
            ? `Your ladder balance is at your invested amount ($${totalInvested.toFixed(2)}). Invest more in stocks to deposit more.`
            : `You can only deposit $${room.toFixed(2)} more — the ladder game is capped at what you've invested in stocks ($${totalInvested.toFixed(2)}).`);
      }

      // Daily deposit cap — resets at UTC midnight
      const todayUTC = new Date().toISOString().slice(0, 10);
      const lastDepositDay = ladderData.dailyDepositedAt || '';
      const dailyDeposited = lastDepositDay === todayUTC ? (ladderData.dailyDeposited || 0) : 0;
      const remaining = LADDER_GAME_MAX_DAILY_DEPOSIT - dailyDeposited;
      if (amount > remaining) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          remaining <= 0
            ? `Daily deposit limit of $${LADDER_GAME_MAX_DAILY_DEPOSIT.toLocaleString()} reached. Resets at midnight UTC.`
            : `Daily deposit limit: you can only deposit $${remaining.toFixed(2)} more today.`
        );
      }

      // Deduct from Stockism cash
      transaction.update(mainUserRef, { cash: cash - amount });

      transaction.set(ladderUserRef, {
        ...ladderData,
        balance: (ladderData.balance ?? 0) + amount,
        totalDeposited: (ladderData.totalDeposited || 0) + amount,
        dailyDepositedAt: todayUTC,
        dailyDeposited: dailyDeposited + amount
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
 * Withdraw full ladder game balance back to Stockism cash
 */
exports.withdrawFromLadderGame = functions.https.onCall(async (data, context) => {
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
      if (!ladderUserDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'No ladder game account found.');
      }

      const mainUser = mainUserDoc.data();
      checkBanned(mainUser);

      const ladderData = ladderUserDoc.data();
      const balance = ladderData.balance ?? 0;

      if (amount > balance) {
        throw new functions.https.HttpsError('failed-precondition', 'Withdrawal amount exceeds ladder balance.');
      }

      transaction.update(ladderUserRef, { balance: balance - amount });
      transaction.update(mainUserRef, { cash: (mainUser.cash || 0) + amount });

      return {
        success: true,
        newLadderBalance: balance - amount,
        newStockismCash: (mainUser.cash || 0) + amount
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('Withdrawal error:', error);
    throw new functions.https.HttpsError('internal', 'Withdrawal failed: ' + error.message);
  }
});

/**
 * Admin-only: force-transfer cash between a user's main account and their
 * ladder game balance. Bypasses every normal deposit cap (max balance, daily
 * limit, invested-in-stocks cap). A positive amount moves cash -> ladder; a
 * negative amount moves balance back ladder -> cash. Creates the ladder doc
 * if the user has never played.
 */
exports.adminTransferToLadder = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId } = data;
  const amount = Math.round(Number(data.amount) * 100) / 100;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }
  if (!Number.isFinite(amount) || amount === 0) {
    throw new functions.https.HttpsError('invalid-argument', 'amount must be a non-zero number');
  }

  try {
    return await db.runTransaction(async (transaction) => {
      const mainUserRef = db.collection('users').doc(userId);
      const ladderUserRef = db.collection('ladderGameUsers').doc(userId);

      const [mainUserDoc, ladderUserDoc] = await Promise.all([
        transaction.get(mainUserRef),
        transaction.get(ladderUserRef)
      ]);

      if (!mainUserDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }

      const mainUser = mainUserDoc.data();
      const cash = mainUser.cash || 0;

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
      const ladderBalance = ladderData.balance ?? 0;

      // Positive: pull from cash. Negative: pull from ladder balance.
      if (amount > 0 && cash < amount) {
        throw new functions.https.HttpsError('failed-precondition', `User only has $${cash.toFixed(2)} cash to transfer.`);
      }
      if (amount < 0 && ladderBalance < -amount) {
        throw new functions.https.HttpsError('failed-precondition', `User only has $${ladderBalance.toFixed(2)} in the ladder game to pull back.`);
      }

      const newCash = Math.round((cash - amount) * 100) / 100;
      const newLadderBalance = Math.round((ladderBalance + amount) * 100) / 100;

      transaction.update(mainUserRef, { cash: newCash });
      transaction.set(ladderUserRef, {
        ...ladderData,
        balance: newLadderBalance,
        totalDeposited: (ladderData.totalDeposited || 0) + Math.max(0, amount)
      }, { merge: true });

      return {
        success: true,
        amount,
        previousCash: cash,
        previousLadderBalance: ladderBalance,
        newCash,
        newLadderBalance
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    console.error('Admin ladder transfer error:', error);
    throw new functions.https.HttpsError('internal', 'Transfer failed: ' + error.message);
  }
});

exports.getLadderLeaderboard = functions.https.onCall(async (data, context) => {
  try {
    const ladderUsersSnap = await db.collection('ladderGameUsers')
      .orderBy('balance', 'desc')
      .limit(50)
      .get();

    const userIds = ladderUsersSnap.docs.map(doc => doc.id);
    const leaderboard = [];

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
