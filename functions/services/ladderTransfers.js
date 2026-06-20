'use strict';
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { checkBanned, checkDiscordWall, getTotalInvested, touchLastActive } = require('../helpers');
const {
  LADDER_GAME_MAX_BALANCE,
  LADDER_GAME_MAX_DEPOSIT_PER_WINDOW,
  LADDER_DEPOSIT_WINDOW_MS,
  LADDER_WITHDRAW_PRINCIPAL_FEE_RATE,
  LADDER_WITHDRAW_RUSH_RATE,
  LADDER_WITHDRAW_PROFIT_BRACKETS,
  ADMIN_UID,
} = require('../constants');

// Round up to the cent (house favor). The epsilon guards against FP noise
// (e.g. 50.000000000001) charging a phantom extra cent.
const roundUpToCent = (x) => Math.ceil((x - 1e-9) * 100) / 100;

// Mirror of calculateLadderWithdrawTax in src/utils/ladderTax.js — keep both in sync.
// Principal (the user's own deposits coming back) pays a flat fee; profit pays
// lifetime-progressive bracket rates over cumulative profit withdrawn; a rush
// surcharge on the whole amount applies if any deposit landed within the window.
const calculateLadderWithdrawTax = ({ amount, totalDeposited, principalWithdrawn, profitWithdrawn, hasRecentDeposit }) => {
  const deposited = totalDeposited || 0;
  const principalSoFar = principalWithdrawn || 0;
  const profitSoFar = profitWithdrawn || 0;

  const basisRemaining = Math.max(0, deposited - principalSoFar);
  const principalPart = Math.min(amount, basisRemaining);
  const profitPart = amount - principalPart;

  const principalFee = principalPart > 0 ? roundUpToCent(principalPart * LADDER_WITHDRAW_PRINCIPAL_FEE_RATE) : 0;

  let profitTaxRaw = 0;
  let prevUpTo = 0;
  for (const bracket of LADDER_WITHDRAW_PROFIT_BRACKETS) {
    const overlap = Math.max(0, Math.min(profitSoFar + profitPart, bracket.upTo) - Math.max(profitSoFar, prevUpTo));
    profitTaxRaw += overlap * bracket.rate;
    prevUpTo = bracket.upTo;
  }
  const profitTax = profitTaxRaw > 0 ? roundUpToCent(profitTaxRaw) : 0;

  const rushSurcharge = hasRecentDeposit ? roundUpToCent(amount * LADDER_WITHDRAW_RUSH_RATE) : 0;

  const totalTax = Math.round((principalFee + profitTax + rushSurcharge) * 100) / 100;
  const netReceived = Math.round((amount - totalTax) * 100) / 100;

  return { grossAmount: amount, principalPart, profitPart, principalFee, profitTax, rushSurcharge, totalTax, netReceived };
};

/**
 * Deposit from Stockism cash to ladder game balance (one-way)
 */
exports.depositToLadderGame = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  // Whole-dollar deposits only: floor decimals away. The remainder stays in the
  // user's main cash (nothing is destroyed), and the ladder balance stays integer.
  const amount = Math.floor(Number(data.amount));

  if (!amount || !Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Deposit must be a whole dollar amount of at least $1.');
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
      checkDiscordWall(mainUser);
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

      // Rolling deposit cap: at most LADDER_GAME_MAX_DEPOSIT_PER_WINDOW within the trailing window
      const now = Date.now();
      const recent = (ladderData.recentDeposits || []).filter(d => now - d.ts < LADDER_DEPOSIT_WINDOW_MS);
      const windowTotal = recent.reduce((sum, d) => sum + d.amount, 0);
      const remaining = LADDER_GAME_MAX_DEPOSIT_PER_WINDOW - windowTotal;
      if (amount > remaining) {
        // soonest relief = when the oldest in-window deposit ages out
        const oldest = recent.length ? Math.min(...recent.map(d => d.ts)) : now;
        const freesAt = new Date(oldest + LADDER_DEPOSIT_WINDOW_MS).toISOString().slice(11, 16);
        throw new functions.https.HttpsError(
          'failed-precondition',
          remaining <= 0
            ? `Deposit limit reached: max $${LADDER_GAME_MAX_DEPOSIT_PER_WINDOW.toLocaleString()} per 12 hours. More frees up at ${freesAt} UTC.`
            : `You can only deposit $${remaining.toFixed(2)} more in the next 12 hours.`
        );
      }

      // Record this deposit, coalescing into the current minute to bound the array size
      const minuteTs = Math.floor(now / 60000) * 60000;
      const last = recent[recent.length - 1];
      if (last && last.ts === minuteTs) last.amount += amount;
      else recent.push({ ts: minuteTs, amount });

      // Deduct from Stockism cash
      transaction.update(mainUserRef, { cash: cash - amount });

      transaction.set(ladderUserRef, {
        ...ladderData,
        balance: (ladderData.balance ?? 0) + amount,
        totalDeposited: (ladderData.totalDeposited || 0) + amount,
        recentDeposits: recent
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
 * Withdraw ladder game balance back to Stockism cash, minus the withdrawal tax.
 * Principal back pays a flat fee, profit pays lifetime bracket rates, and a
 * rush surcharge applies if any deposit landed within the last 12 hours.
 */
exports.withdrawFromLadderGame = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
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
      checkDiscordWall(mainUser);

      const ladderData = ladderUserDoc.data();
      const balance = ladderData.balance ?? 0;

      // Non-withdrawable "house chips" (check-in grants / welcome stake) can be
      // played but never cashed out — only deposits and winnings are withdrawable.
      const nonWithdrawable = ladderData.nonWithdrawable || 0;
      const withdrawable = Math.max(0, balance - nonWithdrawable);
      if (amount > withdrawable) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          nonWithdrawable > 0
            ? `You can cash out up to $${withdrawable.toFixed(2)}. Bonus chips from check-ins and the welcome stake can be played but not withdrawn.`
            : 'Withdrawal amount exceeds ladder balance.'
        );
      }

      const principalWithdrawn = ladderData.principalWithdrawn || 0;
      const profitWithdrawn = ladderData.profitWithdrawn || 0;
      const now = Date.now();
      const hasRecentDeposit = (ladderData.recentDeposits || []).some(d => now - d.ts < LADDER_DEPOSIT_WINDOW_MS);

      const tax = calculateLadderWithdrawTax({
        amount,
        totalDeposited: ladderData.totalDeposited || 0,
        principalWithdrawn,
        profitWithdrawn,
        hasRecentDeposit
      });

      // Ladder balance loses the full gross; the tax just disappears (money sink).
      transaction.update(ladderUserRef, {
        balance: balance - amount,
        principalWithdrawn: principalWithdrawn + tax.principalPart,
        profitWithdrawn: profitWithdrawn + tax.profitPart
      });
      transaction.update(mainUserRef, {
        cash: Math.round(((mainUser.cash || 0) + tax.netReceived) * 100) / 100
      });

      return {
        success: true,
        grossAmount: tax.grossAmount,
        principalFee: tax.principalFee,
        profitTax: tax.profitTax,
        rushSurcharge: tax.rushSurcharge,
        totalTax: tax.totalTax,
        netReceived: tax.netReceived,
        newLadderBalance: balance - amount,
        newStockismCash: Math.round(((mainUser.cash || 0) + tax.netReceived) * 100) / 100
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
 * limit, invested-in-stocks cap) and the withdrawal tax. A positive amount
 * moves cash -> ladder; a negative amount moves balance back ladder -> cash.
 * Creates the ladder doc if the user has never played.
 */
exports.adminTransferToLadder = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
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
