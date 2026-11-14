import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
const db = admin.firestore();

import {
  STREAK_SAVER_PLANS,
  STREAK_SAVER_MIN_STREAK,
  streakSaverActive,
  checkinRewardFor,
  liveCheckinStreak,
  canBuyStreakSaver,
  MISSION_AUTOPILOT_PRICE,
} from '../shared/rules/economy';
import { getDailyMissions, getWeeklyMissions, PIN_COLLECTIONS, SHOP_PINS } from '../shared/crews';
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { touchLastActive } from '../shared/activity';
import { grantedValueUpdate } from '../shared/equity';
import { reportError } from '../shared/sentry';
import { getLadderChips } from '../shared/ladderMath';

// Paying a mission lives in ./claimMission, shared with Mission Autopilot.
import { claimMission, autoClaimMissions } from './claimMission';
import { recordLedger } from '../shared/ledger';
import { chargeShop } from '../shared/shopPayment';
import { ownEntry } from '../shared/lookup';
import { getWeekId } from '../shared/tradeRecords';
import { holdsShortForMissions } from '../shared/rules/missionProgress';
import { weeklyMissionsOpen } from '../shared/rules/missions';
import { settleQueuedRecruits, settleRecruit } from '../users/recruiting';

export const claimMissionReward = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'missions');
  const { missionId, type } = data || {};

  if (typeof missionId !== 'string' || !missionId || !['daily', 'weekly'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid mission data.');
  }

  return claimMission(uid, missionId, type);
});

/**
 * Reroll all missions (daily + weekly) for the current week
 * Costs $50, once per week, locked if any rewards claimed
 */
export const rerollMissions = cf().https.onCall(async (data, context) => {
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

    const userData = userDoc.data()!;
    checkBanned(userData);
    checkDiscordWall(userData);

    const now = Date.now();
    const today = new Date(now).toISOString().split('T')[0]!;
    const weekId = getWeekId(now);

    const weeklyProgress = userData.weeklyMissions?.[weekId] || {};

    if (!weeklyMissionsOpen(weekId)) {
      throw new functions.https.HttpsError('failed-precondition', 'Rerolls open at the Thursday reopen.');
    }

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

    // A random seed offset, re-drawn until the $50 actually buys something new:
    // a different weekly mission and not the same three dailies.
    const crew: string | null = userData.crew || null;
    const holdsShort = holdsShortForMissions(userData, dailyProgress, now);
    const weeklyBefore = getWeeklyMissions(crew, weekId)[1]?.id;
    const dailyKey = (seed: number) =>
      getDailyMissions(today, crew, seed, holdsShort)
        .map((m) => m.id)
        .sort()
        .join();
    const dailyBefore = dailyKey(0);
    let rerollSeed = 0;
    for (let tries = 0; tries < 50; tries++) {
      rerollSeed = Math.floor(Math.random() * 100000) + 1;
      if (getWeeklyMissions(crew, weekId, rerollSeed)[1]?.id !== weeklyBefore && dailyKey(rerollSeed) !== dailyBefore) {
        break;
      }
    }

    const updates: Record<string, unknown> = {
      cash: cash - 50,
      [`weeklyMissions.${weekId}.rerolled`]: true,
      [`weeklyMissions.${weekId}.rerollSeed`]: rerollSeed,
    };

    transaction.update(userRef, updates);
    recordLedger(transaction, { uid, type: 'mission_reroll', amount: -50, cashAfter: cash - 50, ref: weekId });
    return { success: true, rerollSeed };
  });
});

/**
 * The UTC day (YYYY-MM-DD) of a stored lastCheckin, which comes in three shapes:
 * an old toDateString() string, a Firestore Timestamp, or a plain {seconds}.
 */
const lastCheckinDay = (lastCheckin: unknown): string | null => {
  if (!lastCheckin) return null;
  if (typeof lastCheckin === 'string') {
    const parsed = new Date(lastCheckin);
    return isNaN(parsed.getTime()) ? null : parsed.toISOString().split('T')[0]!;
  }
  const ts = lastCheckin as { toDate?: () => Date; seconds?: number };
  if (typeof ts.toDate === 'function') return ts.toDate().toISOString().split('T')[0]!;
  if (ts.seconds) return new Date(ts.seconds * 1000).toISOString().split('T')[0]!;
  return null;
};

/**
 * Purchase a pin, an extra pin slot, a streak saver or Mission Autopilot from the shop
 */
export const purchasePin = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'pins');
  const { action, pinId, slotType } = data || {};

  const userRef = db.collection('users').doc(uid);

  const result = await db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data()!;
    checkBanned(userData);
    checkDiscordWall(userData);

    if (action === 'buyPin') {
      // Only pins in a collection that is on sale (src/crews.ts, synced here).
      const shopPin = ownEntry(SHOP_PINS, pinId);
      const pinInfo = shopPin && PIN_COLLECTIONS[shopPin.collection]?.active ? shopPin : undefined;
      if (!pinInfo) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid pin.');
      }
      const validCost = pinInfo.price;
      const bestStreak = Math.max(userData.maxCheckinStreak || 0, userData.checkinStreak || 0);
      if (pinInfo.requiredCheckinStreak && bestStreak < pinInfo.requiredCheckinStreak) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `Requires ${pinInfo.requiredCheckinStreak}-day check-in streak.`,
        );
      }
      const owned = userData.ownedShopPins || [];
      if (owned.includes(pinId)) {
        throw new functions.https.HttpsError('already-exists', 'Already owned.');
      }
      const { updates, paid } = chargeShop(transaction, uid, userData, validCost, { type: 'pin_purchase', ref: pinId });
      transaction.update(userRef, { ownedShopPins: FieldValue.arrayUnion(pinId), ...updates });
      return { success: true, cost: validCost, paid };
    } else if (action === 'buySlot') {
      // Slot costs: achievement = $5000, shop = $7500
      const slotCosts: Record<string, number> = { achievement: 5000, shop: 7500 };
      const validCost = ownEntry(slotCosts, slotType);
      if (!validCost) throw new functions.https.HttpsError('invalid-argument', 'Invalid slot type.');
      const field = slotType === 'achievement' ? 'extraAchievementSlot' : 'extraShopSlot';
      if (userData[field]) {
        throw new functions.https.HttpsError('already-exists', 'Slot already purchased.');
      }
      const { updates, paid } = chargeShop(transaction, uid, userData, validCost, {
        type: 'pin_slot_purchase',
        ref: slotType,
      });
      transaction.update(userRef, { [field]: true, ...updates });
      return { success: true, cost: validCost, paid };
    } else if (action === 'buyStreakSaver') {
      // Shop perk: check-ins pay the top reward while it lasts (rules/economy).
      // Buying the month plan again stacks another 30 days on what's left.
      const plan = ownEntry(STREAK_SAVER_PLANS, data.plan);
      if (!plan) {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid plan.');
      }
      if (userData.streakSaverPermanent) {
        throw new functions.https.HttpsError('already-exists', 'You already have the permanent streak saver.');
      }
      const now = Date.now();
      const live = liveCheckinStreak(
        userData.checkinStreak || 0,
        lastCheckinDay(userData.lastCheckin),
        new Date(now).toISOString().split('T')[0]!,
      );
      if (!canBuyStreakSaver(live, streakSaverActive(userData, now))) {
        throw new functions.https.HttpsError(
          'failed-precondition',
          `You need a ${STREAK_SAVER_MIN_STREAK}-day check-in streak to buy a streak saver.`,
        );
      }
      const until =
        plan.days === null ? null : Math.max(now, userData.streakSaverUntil || 0) + plan.days * 24 * 60 * 60 * 1000;
      const { updates, paid } = chargeShop(transaction, uid, userData, plan.price, {
        type: 'streak_saver_purchase',
        ref: data.plan,
        detail: until === null ? { permanent: true } : { until },
      });
      transaction.update(userRef, {
        ...(until === null ? { streakSaverPermanent: true } : { streakSaverUntil: until }),
        ...updates,
      });
      return { success: true, cost: plan.price, until, paid };
    } else if (action === 'buyAutopilot') {
      // Shop perk: every mission is claimed for the owner from now on (rules/economy).
      if (userData.missionAutopilot) {
        throw new functions.https.HttpsError('already-exists', 'You already have Mission Autopilot.');
      }
      const { updates, paid } = chargeShop(transaction, uid, userData, MISSION_AUTOPILOT_PRICE, {
        type: 'autopilot_purchase',
      });
      transaction.update(userRef, { missionAutopilot: true, ...updates });
      return { success: true, cost: MISSION_AUTOPILOT_PRICE, paid, autopilot: true };
    } else if (action === 'setAutopilot') {
      // An owner can switch it off to do missions by hand (those count toward
      // shop credit) and back on. Either way it takes effect at the next daily run.
      if (!userData.missionAutopilot) {
        throw new functions.https.HttpsError('failed-precondition', 'You do not own Mission Autopilot.');
      }
      if (typeof data.on !== 'boolean') {
        throw new functions.https.HttpsError('invalid-argument', 'Invalid setting.');
      }
      transaction.update(userRef, { missionAutopilotOff: data.on ? FieldValue.delete() : true });
      return { success: true, on: data.on as boolean };
    } else {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid action.');
    }
  });
  // A new owner's missions are claimed right away instead of at the next daily
  // run. Never allowed to fail the purchase, which has already gone through.
  if ('autopilot' in result) {
    await autoClaimMissions(uid).catch((err) => reportError(err, { where: 'purchasePin.autopilot', uid }));
  }
  return result;
});

/**
 * Place a prediction bet
 */

// Daily check-in reward. Lives here rather than users.js because the streak it
// pays out on is the same daily-reward loop as the missions above.
export const dailyCheckin = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'dailyCheckin');

  try {
    const { response, recruitPending, recruitsWaiting } = await db.runTransaction(async (transaction) => {
      const userRef = db.collection('users').doc(uid);
      const userDoc = await transaction.get(userRef);

      if (!userDoc.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }

      const userData = userDoc.data()!;
      checkBanned(userData);
      checkDiscordWall(userData);
      const now = new Date();
      const today = now.toISOString().split('T')[0]!;

      const lastCheckinDate = lastCheckinDay(userData.lastCheckin);

      // Check if already checked in today
      if (lastCheckinDate === today) {
        throw new functions.https.HttpsError('failed-precondition', 'Already checked in today.');
      }

      // Calculate streak
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayDate = yesterday.toISOString().split('T')[0]!;

      const currentStreak = userData.checkinStreak || 0;
      const newStreak = lastCheckinDate === yesterdayDate ? currentStreak + 1 : 1;
      const maxCheckinStreak = Math.max(userData.maxCheckinStreak || 0, newStreak);

      // Streak-based reward: escalates with the consecutive-day streak, then caps.
      // An active streak saver (shop perk) pays the cap whatever the streak.
      const saver = streakSaverActive(userData);
      const checkinReward = checkinRewardFor(newStreak, saver);

      const checkinWeekId = getWeekId(now);

      // Update user document
      const updates: Record<string, unknown> = {
        cash: (userData.cash || 0) + checkinReward,
        ...grantedValueUpdate(checkinReward),
        lastCheckin: Timestamp.now(),
        checkinStreak: newStreak,
        maxCheckinStreak,
        totalCheckins: (userData.totalCheckins || 0) + 1,
        // Mission tracking (server-side)
        [`dailyMissions.${today}.checkedIn`]: true,
        [`weeklyMissions.${checkinWeekId}.checkinDays.${today}`]: true,
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
          chipsMigrated: true,
          totalDeposited: 0,
          totalWon: 0,
          totalLost: 0,
          gamesPlayed: 0,
          wins: 0,
          losses: 0,
          currentStreak: 0,
          bestStreak: 0,
          lastPlayed: null,
          createdAt: FieldValue.serverTimestamp(),
        });
      } else {
        // Existing player — top up to $100 if below. The topped-up amount is also
        // non-withdrawable so it can fund play but never be cashed out.
        const ladderBalance = ladderDoc.data()!.balance || 0;
        if (ladderBalance < 100) {
          ladderTopUpAmount = 100 - ladderBalance;
          // Add the fresh chips to what is actually left of the old ones, not to
          // the lifetime total. The old total counted chips the player had
          // already lost, so every top-up raised a floor they could never clear.
          transaction.update(ladderRef, {
            balance: 100,
            nonWithdrawable: getLadderChips(ladderDoc.data()) + ladderTopUpAmount,
            chipsMigrated: true,
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
        cashAfter: (userData.cash || 0) + (checkinReward ?? 0),
      };
      updates.transactionLog = [...existingLog, checkinEntry].slice(-100);

      transaction.update(userRef, updates);
      recordLedger(transaction, {
        uid,
        type: 'checkin_reward',
        amount: checkinReward ?? 0,
        cashAfter: (userData.cash || 0) + (checkinReward ?? 0),
        detail: saver ? { streak: newStreak, streakSaver: true } : { streak: newStreak },
      });
      recordLedger(transaction, { uid, type: 'checkin_ladder_topup', account: 'ladder', amount: ladderTopUpAmount });

      return {
        response: {
          success: true,
          reward: checkinReward,
          newStreak,
          ladderTopUpAmount,
          totalCheckins: updates.totalCheckins,
        },
        crew: (userData.crew as string | undefined) || null,
        weekId: checkinWeekId,
        recruitPending: userData.recruitPending === true,
        recruitsWaiting: (userData.recruiting?.pending || 0) > 0,
      };
    });
    // An invited player may have just earned the recruit rewards (users/recruiting.ts).
    // Awaited so the work is not cut off, and never allowed to fail the check-in.
    if (recruitPending) {
      await settleRecruit(uid).catch((err) => reportError(err, { where: 'dailyCheckin.settleRecruit', uid }));
    }
    // A recruiter's own check-in pays any recruits held over by the weekly cap.
    if (recruitsWaiting) {
      await settleQueuedRecruits(uid).catch((err) => reportError(err, { where: 'dailyCheckin.settleQueued', uid }));
    }
    return response;
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    reportError(error, { where: 'dailyCheckin', uid });
    throw new functions.https.HttpsError('internal', 'Checkin failed: ' + (error as Error).message);
  }
});
