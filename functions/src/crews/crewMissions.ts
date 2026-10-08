import * as functions from 'firebase-functions';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
const db = admin.firestore();

import {
  CREW_MEMBERS,
  getCrewBuyTarget,
  getCrewSellTarget,
  getCrewVolumeTarget,
  CREW_MISSION_REWARDS,
  CREW_CONTRIB,
} from '../shared/constants';
import { getCrewMultiplier } from '../shared/crews';
import { checkBanned, checkDiscordWall } from '../shared/accountGuards';
import { writeNotification } from '../shared/notifications';
import { touchLastActive } from '../shared/activity';
import { grantedValueUpdate } from '../shared/equity';
import type { UserData } from '../shared/types';

type CrewMissionId = keyof typeof CREW_MISSION_REWARDS;

/** crewMissions/{crew}_{weekId}. Contributor values were booleans before June 2026. */
interface CrewMissionDoc {
  buyCount?: number;
  sellCount?: number;
  tradeVolume?: number;
  contributorsBuy?: Record<string, number | boolean>;
  contributorsSell?: Record<string, number | boolean>;
  contributorsVolume?: Record<string, number | boolean>;
  claimed?: Record<string, Record<string, boolean> | undefined>;
}

const VALID_CREW_MISSIONS = new Set(Object.keys(CREW_MISSION_REWARDS));

// Contribution fields stored booleans before June 2026; those legacy `true`
// values are grandfathered as qualifying so nobody loses credit mid-week.
// From the next Monday reset on, only the numeric counters exist.
const meetsContribution = (value: number | boolean | undefined, threshold: number) =>
  value === true || (typeof value === 'number' && value >= threshold);

// Progress writing + the UTC week id live in an internal module so the three
// trade-executing paths can import them without this file having to export a
// plain helper (which index.js would then re-export as a "Cloud Function").
import { getWeekId } from './crewMissionProgress';

/**
 * Checks if the crew goal is met and whether the user contributed.
 * Returns { complete, contributed, reason? }
 */
async function checkCrewGoal(
  missionId: string,
  missionData: CrewMissionDoc,
  crew: string,
  uid: string,
): Promise<{ complete: boolean; contributed: boolean; reason: string | null }> {
  const crewTickers = CREW_MEMBERS[crew] || [];
  const memberCount = crewTickers.length;

  switch (missionId) {
    case 'CREW_BUY_500': {
      const target = getCrewBuyTarget(memberCount);
      const complete = (missionData.buyCount || 0) >= target;
      return {
        complete,
        contributed: meetsContribution(missionData.contributorsBuy?.[uid], CREW_CONTRIB.BUY_SHARES),
        reason: complete ? null : `Crew needs to buy ${target} shares of its own stocks this week.`,
      };
    }
    case 'CREW_SELL_500': {
      const target = getCrewSellTarget(memberCount);
      const complete = (missionData.sellCount || 0) >= target;
      return {
        complete,
        contributed: meetsContribution(missionData.contributorsSell?.[uid], CREW_CONTRIB.SELL_SHARES),
        reason: complete ? null : `Crew needs to sell ${target} shares of its own stocks this week.`,
      };
    }
    case 'CREW_VOLUME': {
      const target = getCrewVolumeTarget(memberCount);
      const complete = (missionData.tradeVolume || 0) >= target;
      return {
        complete,
        contributed: meetsContribution(missionData.contributorsVolume?.[uid], CREW_CONTRIB.VOLUME),
        reason: complete ? null : `Crew needs $${target.toLocaleString()} in crew-stock trade volume this week.`,
      };
    }
    default:
      return { complete: false, contributed: false, reason: 'Unknown mission.' };
  }
}

export const claimCrewMission = cf().https.onCall(async (data: { missionId?: unknown }, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'crewMissions');
  const missionId = data.missionId as CrewMissionId;

  if (!VALID_CREW_MISSIONS.has(missionId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid crew mission.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  const userData = userSnap.data() as UserData;
  checkBanned(userData);
  checkDiscordWall(userData);

  const crew = userData.crew;
  if (!crew)
    throw new functions.https.HttpsError('failed-precondition', 'You must be in a crew to claim crew missions.');

  const weekId = getWeekId();
  const missionRef = db.collection('crewMissions').doc(`${crew}_${weekId}`);
  const missionSnap = await missionRef.get();
  const missionData: CrewMissionDoc = missionSnap.exists ? missionSnap.data()! : {};

  if (missionData.claimed?.[uid]?.[missionId]) {
    throw new functions.https.HttpsError('failed-precondition', 'Already claimed this mission.');
  }

  const { complete, contributed, reason } = await checkCrewGoal(missionId, missionData, crew, uid);
  if (!complete) throw new functions.https.HttpsError('failed-precondition', reason || 'Mission not yet complete.');
  if (!contributed)
    throw new functions.https.HttpsError('failed-precondition', 'You have not contributed to this mission.');

  // Scaled by the crew's underdog multiplier for this week.
  const crewStatsSnap = await db.collection('market').doc('crewStats').get();
  const crewMultiplier = getCrewMultiplier(crewStatsSnap.exists ? crewStatsSnap.data() : null, crew);
  const reward = Math.round(CREW_MISSION_REWARDS[missionId] * crewMultiplier);
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const [freshUser, freshMission] = await Promise.all([tx.get(userRef), tx.get(missionRef)]);
    if (!freshUser.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (freshUser.data()!.crew !== crew)
      throw new functions.https.HttpsError('failed-precondition', 'Your crew has changed.');
    if (freshMission.exists && freshMission.data()!.claimed?.[uid]?.[missionId]) {
      throw new functions.https.HttpsError('failed-precondition', 'Already claimed.');
    }
    tx.update(userRef, {
      cash: admin.firestore.FieldValue.increment(reward),
      ...grantedValueUpdate(reward),
    });
    if (freshMission.exists) {
      tx.update(missionRef, { [`claimed.${uid}.${missionId}`]: true });
    } else {
      tx.set(missionRef, { crew, weekId, claimed: { [uid]: { [missionId]: true } } });
    }
  });

  await writeNotification(uid, {
    type: 'achievement',
    title: 'Crew Mission Complete',
    message: `You earned $${reward} from your crew's mission.`,
    data: {},
  });

  return { success: true, reward };
});

// NOTE: this file exports Cloud Functions ONLY. index.js re-exports everything
// it finds here straight into the deployed function list, so a plain helper or
// constant exported below would show up as a bogus deployable function.
// Shared helpers belong in ./crewMissionProgress or ../helpers instead.
