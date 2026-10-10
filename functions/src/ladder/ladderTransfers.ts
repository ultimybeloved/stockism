import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
const db = admin.firestore();
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { getTotalInvested, grantedFlowUpdate } from '../shared/equity';
import { getLadderDepositFactor, getLadderRampEndDate, getLadderChips } from '../shared/ladderMath';
import { touchLastActive } from '../shared/activity';
import { reportError } from '../shared/sentry';
import {
  LADDER_GAME_MAX_BALANCE,
  LADDER_GAME_MAX_DEPOSIT_PER_WINDOW,
  LADDER_DEPOSIT_WINDOW_MS,
  formatWait,
} from '../shared/constants';

// The withdrawal tax is the shared rule module, so the withdraw tab's preview
// is exactly what gets charged.
import { calculateLadderWithdrawTax } from '../shared/rules/ladder';

/**
 * Deposit from Stockism cash to ladder game balance (one-way)
 */
export const depositToLadderGame = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'ladder');
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
        transaction.get(ladderUserRef),
      ]);

      if (!mainUserDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }

      const mainUser = mainUserDoc.data()!;
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
        throw new functions.https.HttpsError(
          'failed-precondition',
          'Invest in stocks before depositing to the ladder game.',
        );
      }

      const ladderData = ladderUserDoc.exists
        ? ladderUserDoc.data()!
        : {
            balance: 0,
            totalDeposited: 0,
            totalWon: 0,
            totalLost: 0,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            currentStreak: 0,
            bestStreak: 0,
            lastPlayed: null,
          };

      // New accounts only have part of the caps unlocked. The invested-in-stocks
      // gate below doesn't stop an alt — it buys stock with its signup cash and
      // passes honestly — so age is what limits gambling the free stake.
      const rampFactor = getLadderDepositFactor(mainUser);
      const rampEndDate = getLadderRampEndDate(mainUser);
      const rampNote = rampEndDate ? ` Your account's limit rises daily and is full on ${rampEndDate}.` : '';
      const maxBalance = Math.floor(LADDER_GAME_MAX_BALANCE * rampFactor);
      const maxPerWindow = Math.floor(LADDER_GAME_MAX_DEPOSIT_PER_WINDOW * rampFactor);

      const currentBalance = ladderData.balance ?? 0;
      if (currentBalance >= maxBalance) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Ladder balance is already at the $${maxBalance.toLocaleString()} limit.${rampNote}`,
        );
      }
      if (currentBalance + amount > maxBalance) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `You can only deposit $${(maxBalance - currentBalance).toFixed(2)} more before hitting the $${maxBalance.toLocaleString()} cap.${rampNote}`,
        );
      }

      // Enforce the invested-in-stocks cap on the ladder balance.
      if (currentBalance + amount > totalInvested) {
        const room = Math.max(0, totalInvested - currentBalance);
        throw new functions.https.HttpsError(
          'failed-precondition',
          room <= 0
            ? `Your ladder balance is at your invested amount ($${totalInvested.toFixed(2)}). Invest more in stocks to deposit more.`
            : `You can only deposit $${room.toFixed(2)} more — the ladder game is capped at what you've invested in stocks ($${totalInvested.toFixed(2)}).`,
        );
      }

      // Rolling deposit cap: at most LADDER_GAME_MAX_DEPOSIT_PER_WINDOW within the trailing window
      const now = Date.now();
      const recent = (ladderData.recentDeposits || []).filter(
        (d: { ts: number; amount: number }) => now - d.ts < LADDER_DEPOSIT_WINDOW_MS,
      );
      const windowTotal = recent.reduce((sum: number, d: { amount: number }) => sum + d.amount, 0);
      const remaining = maxPerWindow - windowTotal;
      if (amount > remaining) {
        // soonest relief = when the oldest in-window deposit ages out
        const oldest = recent.length ? Math.min(...recent.map((d: { ts: number }) => d.ts)) : now;
        const freesIn = formatWait(oldest + LADDER_DEPOSIT_WINDOW_MS - now);
        throw new functions.https.HttpsError(
          'failed-precondition',
          remaining <= 0
            ? `Deposit limit reached: max $${maxPerWindow.toLocaleString()} per 12 hours. More frees up in ${freesIn}.${rampNote}`
            : `You can only deposit $${remaining.toFixed(2)} more in the next 12 hours.${rampNote}`,
        );
      }

      // Record this deposit, coalescing into the current minute to bound the array size
      const minuteTs = Math.floor(now / 60000) * 60000;
      const last = recent[recent.length - 1];
      if (last && last.ts === minuteTs) last.amount += amount;
      else recent.push({ ts: minuteTs, amount });

      // Deduct from Stockism cash. The negative flow keeps the ladder out of
      // percent-return boards: the money left the portfolio but wasn't lost.
      transaction.update(mainUserRef, {
        cash: cash - amount,
        ...grantedFlowUpdate(-amount),
      });

      transaction.set(ladderUserRef, {
        ...ladderData,
        balance: (ladderData.balance ?? 0) + amount,
        totalDeposited: (ladderData.totalDeposited || 0) + amount,
        recentDeposits: recent,
      });

      return {
        success: true,
        newStockismCash: cash - amount,
        newLadderBalance: (ladderData.balance ?? 0) + amount,
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    reportError(error, { where: 'depositToLadderGame', uid });
    throw new functions.https.HttpsError('internal', 'Deposit failed: ' + (error as Error).message);
  }
});

/**
 * Withdraw ladder game balance back to Stockism cash, minus the withdrawal tax.
 * Principal back pays a flat fee, profit pays lifetime bracket rates, and a
 * rush surcharge applies if any deposit landed within the last 12 hours.
 */
export const withdrawFromLadderGame = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'ladder');
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
        transaction.get(ladderUserRef),
      ]);

      if (!mainUserDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }
      if (!ladderUserDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'No ladder game account found.');
      }

      const mainUser = mainUserDoc.data()!;
      checkBanned(mainUser);
      checkDiscordWall(mainUser);

      const ladderData = ladderUserDoc.data()!;
      const balance = ladderData.balance ?? 0;

      // House chips (check-in grants / welcome stake) can be played but never
      // cashed out. They are staked first, so losses burn them and anything the
      // player wins on top of them is real money — see the note in ladderGame.js.
      const chips = getLadderChips(ladderData);
      const withdrawable = Math.max(0, balance - chips);
      if (amount > withdrawable) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          chips > 0
            ? `You can cash out up to $${withdrawable.toFixed(2)}. Bonus chips from check-ins and the welcome stake can be played but not cashed out. What you win with them can.`
            : 'Withdrawal amount exceeds ladder balance.',
        );
      }

      const principalWithdrawn = ladderData.principalWithdrawn || 0;
      const profitWithdrawn = ladderData.profitWithdrawn || 0;
      const now = Date.now();
      const hasRecentDeposit = (ladderData.recentDeposits || []).some(
        (d: { ts: number }) => now - d.ts < LADDER_DEPOSIT_WINDOW_MS,
      );

      const tax = calculateLadderWithdrawTax({
        amount,
        totalDeposited: ladderData.totalDeposited || 0,
        principalWithdrawn,
        profitWithdrawn,
        hasRecentDeposit,
      });

      // Ladder balance loses the full gross; the tax just disappears (money sink).
      // Rounded to the cent: withdrawals accept any float, so the raw
      // subtraction left balances like 123.45000000000002 behind.
      const newLadderBalance = Math.round((balance - amount) * 100) / 100;
      transaction.update(ladderUserRef, {
        balance: newLadderBalance,
        principalWithdrawn: principalWithdrawn + tax.principalPart,
        profitWithdrawn: profitWithdrawn + tax.profitPart,
        // Chips are untouched by a withdrawal (only what sits above them comes
        // out), but write the repaired figure back so the fix sticks.
        nonWithdrawable: chips,
        chipsMigrated: true,
      });
      // Cancels the deposit's negative flow, so a ladder round trip is invisible
      // to season and leaderboard returns — winnings included.
      transaction.update(mainUserRef, {
        cash: Math.round(((mainUser.cash || 0) + tax.netReceived) * 100) / 100,
        ...grantedFlowUpdate(tax.netReceived),
      });

      return {
        success: true,
        grossAmount: tax.grossAmount,
        principalFee: tax.principalFee,
        profitTax: tax.profitTax,
        rushSurcharge: tax.rushSurcharge,
        totalTax: tax.totalTax,
        netReceived: tax.netReceived,
        newLadderBalance,
        newStockismCash: Math.round(((mainUser.cash || 0) + tax.netReceived) * 100) / 100,
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    reportError(error, { where: 'withdrawFromLadderGame', uid });
    throw new functions.https.HttpsError('internal', 'Withdrawal failed: ' + (error as Error).message);
  }
});

/**
 * Admin-only: force-transfer cash between a user's main account and their
 * ladder game balance. Bypasses every normal deposit cap (max balance, daily
 * limit, invested-in-stocks cap) and the withdrawal tax. A positive amount
 * moves cash -> ladder; a negative amount moves balance back ladder -> cash.
 * Creates the ladder doc if the user has never played.
 */
export const adminTransferToLadder = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

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
        transaction.get(ladderUserRef),
      ]);

      if (!mainUserDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }

      const mainUser = mainUserDoc.data()!;
      const cash = mainUser.cash || 0;

      const ladderData = ladderUserDoc.exists
        ? ladderUserDoc.data()!
        : {
            balance: 0,
            totalDeposited: 0,
            totalWon: 0,
            totalLost: 0,
            gamesPlayed: 0,
            wins: 0,
            losses: 0,
            currentStreak: 0,
            bestStreak: 0,
            lastPlayed: null,
          };
      const ladderBalance = ladderData.balance ?? 0;

      // Positive: pull from cash. Negative: pull from ladder balance.
      if (amount > 0 && cash < amount) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `User only has $${cash.toFixed(2)} cash to transfer.`,
        );
      }
      if (amount < 0 && ladderBalance < -amount) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `User only has $${ladderBalance.toFixed(2)} in the ladder game to pull back.`,
        );
      }

      const newCash = Math.round((cash - amount) * 100) / 100;
      const newLadderBalance = Math.round((ladderBalance + amount) * 100) / 100;

      // Same neutralisation as the player-facing transfers: cash crossing into
      // or out of the ladder must not read as trading. Positive amount pulls
      // FROM cash, so the flow booked is its negative.
      transaction.update(mainUserRef, {
        cash: newCash,
        ...grantedFlowUpdate(-amount),
      });
      transaction.set(
        ladderUserRef,
        {
          ...ladderData,
          balance: newLadderBalance,
          // An admin pull can take the balance below the house chips sitting in
          // it; chips can never exceed what is actually there.
          nonWithdrawable: Math.min(getLadderChips(ladderData), newLadderBalance),
          chipsMigrated: true,
          totalDeposited: (ladderData.totalDeposited || 0) + Math.max(0, amount),
        },
        { merge: true },
      );

      return {
        success: true,
        amount,
        previousCash: cash,
        previousLadderBalance: ladderBalance,
        newCash,
        newLadderBalance,
      };
    });
  } catch (error) {
    if (error instanceof functions.https.HttpsError) throw error;
    reportError(error, { where: 'adminTransferToLadder' });
    throw new functions.https.HttpsError('internal', 'Transfer failed: ' + (error as Error).message);
  }
});
