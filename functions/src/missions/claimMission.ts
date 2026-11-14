// Internal module: the one place a mission is paid. claimMissionReward (a
// player pressing Claim) and Mission Autopilot (the shop perk that claims for
// its owner) both come through claimMission, so the reward, the crew bonus,
// the ledger entry, and the Rivalry count can never drift apart.

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();

import { getDailyMissions, getWeeklyMissions, getCrewMultiplier } from '../shared/crews';
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { getLastActiveMs } from '../shared/activity';
import { grantedValueUpdate } from '../shared/equity';
import { reportError } from '../shared/sentry';
import { settleRecruit } from '../users/recruiting';
import { isDailyMissionDone, isWeeklyMissionDone, missionContext, missionAchievementFor } from './missionChecks';
import { recordLedger } from '../shared/ledger';
import { getWeekId } from '../shared/tradeRecords';
import { holdsShortForMissions, nextRivalry, rivalryQualified } from '../shared/rules/missionProgress';
import { missionCreditFor } from '../shared/rules/shop';
import { MISSION_AUTOPILOT_IDLE_DAYS } from '../shared/rules/economy';
import { noteRivalryActivity } from '../shared/rivalries';

export type MissionType = 'daily' | 'weekly';

const dayOf = (now: number) => new Date(now).toISOString().split('T')[0]!;

/**
 * Pays one assigned mission. `auto` is Mission Autopilot: the mission does not
 * have to be finished, the account must own the perk, and the claim leaves the
 * lifetime mission count (shop credit milestones, achievements) alone.
 */
export async function claimMission(uid: string, missionId: string, type: MissionType, { auto = false } = {}) {
  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');
  const crewStatsRef = db.collection('market').doc('crewStats');
  const haltLockRef = db.collection('market').doc('callBaseline');

  const result = await db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc, crewStatsDoc, haltLockDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(marketRef),
      transaction.get(crewStatsRef),
      transaction.get(haltLockRef),
    ]);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data()!;
    checkBanned(userData);
    checkDiscordWall(userData);
    if (auto && (userData.missionAutopilot !== true || userData.missionAutopilotOff)) {
      throw new functions.https.HttpsError('failed-precondition', 'No Mission Autopilot.');
    }
    const now = Date.now();
    const ctx = missionContext(userData, marketDoc.exists ? marketDoc.data() : null, now, haltLockDoc.data() || null);
    const today = dayOf(now);
    const weekId = getWeekId(now);
    const crew: string | null = userData.crew || null;

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
    // call could claim every mission in the catalog each day. Players without
    // a crew get missions too since 2026-10-22, from the non-crew pool.
    const rerollSeed = userData.weeklyMissions?.[weekId]?.rerollSeed || 0;
    const assignedMissions =
      type === 'daily'
        ? getDailyMissions(
            today,
            crew,
            rerollSeed,
            holdsShortForMissions(userData, userData.dailyMissions?.[today], now),
          )
        : getWeeklyMissions(crew, weekId, rerollSeed);
    const assignedMission = assignedMissions.find((m) => m.id === missionId);
    if (!assignedMission) {
      throw new functions.https.HttpsError('failed-precondition', 'Mission not assigned.');
    }
    // Claims are capped by count, not just by id: the set depends on the crew,
    // so switching crews mid-day handed out a fresh set to claim again.
    const claimedMap: Record<string, boolean> =
      (type === 'daily' ? userData.dailyMissions?.[today]?.claimed : userData.weeklyMissions?.[weekId]?.claimed) || {};
    const claimedCount = Object.values(claimedMap).filter(Boolean).length;
    if (claimedCount >= assignedMissions.length) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `You've claimed all your ${type} missions. New ones ${type === 'daily' ? 'tomorrow' : 'next week'}.`,
      );
    }

    // Server-defined reward (ignoring client-provided values entirely),
    // scaled by the crew's underdog multiplier for this week.
    const crewMultiplier = crew ? getCrewMultiplier(crewStatsDoc.exists ? crewStatsDoc.data() : null, crew) : 1;
    const reward = Math.round(assignedMission.reward * crewMultiplier);

    // Verify mission is actually completed server-side
    const weeklyProgress = userData.weeklyMissions?.[weekId] || {};
    const done =
      auto ||
      (type === 'daily'
        ? isDailyMissionDone(missionId, userData.dailyMissions?.[today] || {}, ctx)
        : isWeeklyMissionDone(missionId, weeklyProgress, ctx));
    if (!done) {
      throw new functions.https.HttpsError('failed-precondition', 'Mission not completed yet.');
    }

    const total = userData.totalMissionsCompleted || 0;
    const newTotal = auto ? total : total + 1;
    const updates: Record<string, unknown> = {
      cash: (userData.cash || 0) + reward,
      // Free money: booked so percent-return boards can net it out.
      ...grantedValueUpdate(reward),
    };
    if (!auto) updates.totalMissionsCompleted = newTotal;

    if (type === 'daily') {
      updates[`dailyMissions.${today}.claimed.${missionId}`] = true;
      // Mission Machine counts the week's daily claims.
      updates[`weeklyMissions.${weekId}.dailyClaims`] = FieldValue.increment(1);
    } else {
      updates[`weeklyMissions.${weekId}.claimed.${missionId}`] = true;
    }
    // Rivalries: every mission finished in a crew counts toward its week.
    const rivalry = crew ? nextRivalry(weeklyProgress, crew) : null;
    if (rivalry) updates[`weeklyMissions.${weekId}.rivalry`] = rivalry;

    // Check mission achievements
    const earned = auto ? null : missionAchievementFor(newTotal, userData.achievements);
    if (earned) updates.achievements = FieldValue.arrayUnion(earned);

    // Every so many missions pays shop credit (rules/shop). Not cash, so it is
    // not granted value: it can only be spent in the shop.
    const credit = auto ? 0 : missionCreditFor(newTotal);
    if (credit) updates.shopCredit = (userData.shopCredit || 0) + credit;

    transaction.update(userRef, updates);
    recordLedger(transaction, {
      uid,
      type: 'mission_reward',
      amount: reward,
      cashAfter: (userData.cash || 0) + reward,
      ref: missionId,
      detail: auto ? { missionType: type, autopilot: true } : { missionType: type },
    });
    recordLedger(transaction, {
      uid,
      type: 'mission_credit',
      account: 'credit',
      amount: credit,
      cashAfter: (userData.shopCredit || 0) + credit,
      ref: missionId,
      detail: { missions: newTotal },
    });

    return {
      success: true,
      reward,
      newTotal,
      credit,
      rivalry: crew && rivalry ? { weekId, crew, qualified: rivalryQualified({ rivalry }, crew) } : null,
      recruitPending: !auto && userData.recruitPending === true,
    };
  });

  const { rivalry, recruitPending, ...response } = result;
  if (rivalry) await noteRivalryActivity(rivalry.weekId, rivalry.crew, uid, rivalry.qualified);
  // Finished missions are one way an invited player earns the recruit rewards
  // (users/recruiting.ts). Never allowed to fail the claim.
  if (recruitPending) {
    await settleRecruit(uid).catch((err) => reportError(err, { where: 'claimMission.settleRecruit', uid }));
  }
  return response;
}

/**
 * Mission Autopilot for one account: claims every mission it has today and this
 * week that is not claimed yet. Returns how many it paid. Does nothing for an
 * account without the perk, one that switched it off, a banned one, or one whose owner has been away for
 * MISSION_AUTOPILOT_IDLE_DAYS.
 */
export async function autoClaimMissions(uid: string, now: number = Date.now()): Promise<number> {
  const data = (await db.collection('users').doc(uid).get()).data();
  if (!data || data.missionAutopilot !== true || data.missionAutopilotOff || data.isBanned) return 0;
  if (now - getLastActiveMs(data) >= MISSION_AUTOPILOT_IDLE_DAYS * 24 * 60 * 60 * 1000) return 0;

  const today = dayOf(now);
  const weekId = getWeekId(now);
  const crew: string | null = data.crew || null;
  const rerollSeed = data.weeklyMissions?.[weekId]?.rerollSeed || 0;
  const daily = getDailyMissions(
    today,
    crew,
    rerollSeed,
    holdsShortForMissions(data, data.dailyMissions?.[today], now),
  );
  const weekly = getWeeklyMissions(crew, weekId, rerollSeed);
  const open: [string, MissionType][] = [
    ...daily
      .filter((m) => !data.dailyMissions?.[today]?.claimed?.[m.id])
      .map((m) => [m.id, 'daily'] as [string, 'daily']),
    ...weekly
      .filter((m) => !data.weeklyMissions?.[weekId]?.claimed?.[m.id])
      .map((m) => [m.id, 'weekly'] as [string, 'weekly']),
  ];

  let paid = 0;
  for (const [missionId, type] of open) {
    try {
      await claimMission(uid, missionId, type, { auto: true });
      paid++;
    } catch (err) {
      // A refusal (already claimed, Discord wall, a ban since the read) is a
      // skip, not a failure. Anything else is reported and the rest still run.
      if (err instanceof functions.https.HttpsError) {
        logger.info(`Autopilot skipped ${type} ${missionId} for ${uid}: ${err.message}`);
      } else {
        reportError(err, { where: 'autoClaimMissions', uid, missionId });
      }
    }
  }
  return paid;
}
