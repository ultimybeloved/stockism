'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const {
  CREW_MEMBERS,
  getCrewBuyTarget, getCrewSellTarget, getCrewVolumeTarget,
  CREW_MISSION_REWARDS, CREW_CONTRIB,
} = require('../constants');
const { checkBanned, checkDiscordWall, writeNotification, touchLastActive } = require('../helpers');

const VALID_CREW_MISSIONS = new Set(Object.keys(CREW_MISSION_REWARDS));

// Contribution fields stored booleans before June 2026; those legacy `true`
// values are grandfathered as qualifying so nobody loses credit mid-week.
// From the next Monday reset on, only the numeric counters exist.
const meetsContribution = (value, threshold) =>
  value === true || (typeof value === 'number' && value >= threshold);

const getWeekId = (now = new Date()) => {
  const d = new Date(now);
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1);
  d.setUTCDate(diff);
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString().split('T')[0];
};

/**
 * Fire-and-forget — called from executeTrade after the main transaction completes.
 * Updates aggregate crew mission counters for the given trade action.
 */
const updateCrewMissionProgress = async (crew, uid, action, amount, ticker, totalCost) => {
  if (!crew) return;
  try {
    // The buy/sell/volume crew goals only count trades of the crew's OWN
    // roster stocks. Trading anyone else's stock no longer moves these.
    const crewTickers = CREW_MEMBERS[crew] || [];
    if (!crewTickers.includes(ticker)) return;

    const weekId = getWeekId();
    const ref = db.collection('crewMissions').doc(`${crew}_${weekId}`);

    // Per-user counters (not booleans) so claims can require a real personal
    // contribution.
    const update = {
      tradeVolume: admin.firestore.FieldValue.increment(totalCost),
      [`contributorsVolume.${uid}`]: admin.firestore.FieldValue.increment(totalCost),
    };

    if (action === 'buy') {
      update.buyCount = admin.firestore.FieldValue.increment(amount);
      update[`contributorsBuy.${uid}`] = admin.firestore.FieldValue.increment(amount);
    } else if (action === 'sell') {
      update.sellCount = admin.firestore.FieldValue.increment(amount);
      update[`contributorsSell.${uid}`] = admin.firestore.FieldValue.increment(amount);
    }

    await ref.set({ crew, weekId }, { merge: true });
    await ref.update(update);
  } catch (err) {
    console.error('updateCrewMissionProgress error:', err.message);
  }
};

/**
 * Checks if the crew goal is met and whether the user contributed.
 * Returns { complete, contributed, reason? }
 */
async function checkCrewGoal(missionId, missionData, crew, uid, userData, weekId) {
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

exports.claimCrewMission = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { missionId } = data;

  if (!VALID_CREW_MISSIONS.has(missionId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid crew mission.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  const userData = userSnap.data();
  checkBanned(userData);
  checkDiscordWall(userData);

  const crew = userData.crew;
  if (!crew) throw new functions.https.HttpsError('failed-precondition', 'You must be in a crew to claim crew missions.');

  const weekId = getWeekId();
  const missionRef = db.collection('crewMissions').doc(`${crew}_${weekId}`);
  const missionSnap = await missionRef.get();
  const missionData = missionSnap.exists ? missionSnap.data() : {};

  if (missionData.claimed?.[uid]?.[missionId]) {
    throw new functions.https.HttpsError('failed-precondition', 'Already claimed this mission.');
  }

  const { complete, contributed, reason } = await checkCrewGoal(missionId, missionData, crew, uid, userData, weekId);
  if (!complete) throw new functions.https.HttpsError('failed-precondition', reason || 'Mission not yet complete.');
  if (!contributed) throw new functions.https.HttpsError('failed-precondition', 'You have not contributed to this mission.');

  const reward = CREW_MISSION_REWARDS[missionId];
  const userRef = db.collection('users').doc(uid);

  await db.runTransaction(async (tx) => {
    const [freshUser, freshMission] = await Promise.all([tx.get(userRef), tx.get(missionRef)]);
    if (!freshUser.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (freshUser.data().crew !== crew) throw new functions.https.HttpsError('failed-precondition', 'Your crew has changed.');
    if (freshMission.exists && freshMission.data().claimed?.[uid]?.[missionId]) {
      throw new functions.https.HttpsError('failed-precondition', 'Already claimed.');
    }
    tx.update(userRef, { cash: admin.firestore.FieldValue.increment(reward) });
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

exports.updateCrewMissionProgress = updateCrewMissionProgress;
exports.CREW_MISSION_REWARDS = CREW_MISSION_REWARDS;
