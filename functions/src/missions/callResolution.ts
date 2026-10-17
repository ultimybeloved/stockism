// Scoring and paying weekly Calls. INTERNAL MODULE: exports no Cloud Functions
// (weeklyCalls.ts owns the schedules).

import * as admin from 'firebase-admin';
import { FieldPath, FieldValue } from 'firebase-admin/firestore';
import * as logger from 'firebase-functions/logger';
import { CALL_MISSION, getCrewMultiplier } from '../shared/crews';
import { grantedValueUpdate } from '../shared/equity';
import { recordLedger } from '../shared/ledger';
import { reportError } from '../shared/sentry';
import { writeNotification } from '../shared/notifications';
import { getWeekId } from '../shared/tradeRecords';
import { noteRivalryActivity } from '../shared/rivalries';
import { scoreCall, callReward } from '../shared/rules/missions';
import { nextRivalry, rivalryQualified, type WeeklyProgress } from '../shared/rules/missionProgress';
import { missionAchievementFor } from './missionChecks';
const db = admin.firestore();

/** market/callBaseline: { weekId, prices, savedAt }, the prices when the halt began. */
export const callBaselineRef = () => db.collection('market').doc('callBaseline');

export async function lockCallBaseline(now = Date.now()) {
  const market = await db.collection('market').doc('current').get();
  await callBaselineRef().set({ weekId: getWeekId(now), prices: market.data()?.prices || {}, savedAt: now });
}

const RESULT_TEXT = {
  big: 'Big call!',
  win: 'You called it.',
  push: 'It barely moved, so this one is a push.',
  loss: 'It went the other way.',
} as const;

/** Score and pay every Call of the week. Safe to re-run: a scored Call is skipped. */
export async function resolveWeeklyCalls(now = Date.now()) {
  const weekId = getWeekId(now);
  const [baseSnap, marketSnap, statsSnap] = await Promise.all([
    callBaselineRef().get(),
    db.collection('market').doc('current').get(),
    db.collection('market').doc('crewStats').get(),
  ]);
  const base = baseSnap.data();
  if (!base || base.weekId !== weekId) {
    throw new Error(`No halt price lock for week ${weekId}; Calls left unscored.`);
  }
  const before: Record<string, number> = base.prices || {};
  const after: Record<string, number> = marketSnap.data()?.prices || {};
  const crewStats = statsSnap.exists ? statsSnap.data() : null;

  const callers = await db
    .collection('users')
    .where(new FieldPath('weeklyMissions', weekId, 'call', 'direction'), 'in', ['up', 'down'])
    .get();

  let scored = 0;
  let paid = 0;
  for (const doc of callers.docs) {
    try {
      const outcome = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(doc.ref);
        const user = fresh.data();
        const wp: WeeklyProgress = user?.weeklyMissions?.[weekId] || {};
        const call = wp.call;
        if (!user || !call || call.result) return null;

        const p0 = before[call.ticker] || 0;
        const p1 = after[call.ticker] || 0;
        const result = scoreCall(call.direction, p0, p1);
        const crew: string | null = user.crew || null;
        const reward = Math.round(callReward(result) * (crew ? getCrewMultiplier(crewStats, crew) : 1));
        const field = `weeklyMissions.${weekId}`;
        const updates: Record<string, unknown> = {
          [`${field}.call.result`]: result,
          [`${field}.call.before`]: p0,
          [`${field}.call.after`]: p1,
          [`${field}.call.paid`]: reward,
        };
        let qualified = false;
        if (reward > 0) {
          const newTotal = (user.totalMissionsCompleted || 0) + 1;
          Object.assign(updates, {
            cash: (user.cash || 0) + reward,
            ...grantedValueUpdate(reward),
            totalMissionsCompleted: newTotal,
            [`${field}.claimed.${CALL_MISSION.id}`]: true,
          });
          const earned = missionAchievementFor(newTotal, user.achievements);
          if (earned) updates.achievements = FieldValue.arrayUnion(earned);
          if (crew) {
            const rivalry = nextRivalry(wp, crew);
            updates[`${field}.rivalry`] = rivalry;
            qualified = rivalryQualified({ rivalry }, crew);
          }
          recordLedger(tx, {
            uid: doc.id,
            type: 'mission_reward',
            amount: reward,
            cashAfter: (user.cash || 0) + reward,
            ref: CALL_MISSION.id,
            detail: { missionType: 'weekly', ticker: call.ticker, direction: call.direction, result },
          });
        }
        tx.update(doc.ref, updates);
        return { result, reward, call, crew, qualified, p0, p1 };
      });
      if (!outcome) continue;
      scored++;
      const { result, reward, call, crew, qualified, p0, p1 } = outcome;
      if (reward > 0) {
        paid += reward;
        if (crew) await noteRivalryActivity(weekId, crew, doc.id, qualified);
      }
      const move = p0 > 0 ? (p1 / p0 - 1) * 100 : 0;
      await writeNotification(doc.id, {
        type: 'system',
        title: reward > 0 ? `Call paid +$${reward.toLocaleString()}` : 'Your Call',
        message: `${call.ticker} moved ${move >= 0 ? '+' : ''}${move.toFixed(1)}% this chapter and you said ${call.direction}. ${RESULT_TEXT[result]}`,
        data: { ticker: call.ticker },
      });
    } catch (err) {
      reportError(err, { where: 'resolveWeeklyCalls', uid: doc.id });
    }
  }
  logger.info(`Weekly Calls ${weekId}: ${scored} scored, $${paid} paid`);
  return { weekId, scored, paid };
}
