'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const {
  CREW_MEMBERS,
  CREW_BUY_THRESHOLD, CREW_SELL_THRESHOLD, CREW_VOLUME_THRESHOLD,
  CREW_MISSION_REWARDS, CREW_PUMP_THRESHOLD,
} = require('../constants');
const { checkBanned, writeNotification } = require('../helpers');

const VALID_CREW_MISSIONS = new Set(Object.keys(CREW_MISSION_REWARDS));

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
    const weekId = getWeekId();
    const ref = db.collection('crewMissions').doc(`${crew}_${weekId}`);

    const update = {
      tradeVolume: admin.firestore.FieldValue.increment(totalCost),
      [`contributorsVolume.${uid}`]: true,
    };

    if (action === 'buy') {
      update.buyCount = admin.firestore.FieldValue.increment(amount);
      update[`contributorsBuy.${uid}`] = true;
      const crewTickers = CREW_MEMBERS[crew] || [];
      if (crewTickers.includes(ticker)) {
        update[`contributorsPump.${uid}`] = true;
      }
    } else if (action === 'sell') {
      update.sellCount = admin.firestore.FieldValue.increment(amount);
      update[`contributorsSell.${uid}`] = true;
    }

    await ref.set({ crew, weekId }, { merge: true });
    await ref.update(update);
  } catch (err) {
    console.error('updateCrewMissionProgress error:', err.message);
  }
};

/**
 * Fire-and-forget — called from switchCrew after a user successfully joins a crew.
 */
const updateCrewMissionNewMember = async (crew) => {
  if (!crew) return;
  try {
    const weekId = getWeekId();
    const ref = db.collection('crewMissions').doc(`${crew}_${weekId}`);
    await ref.set({
      crew,
      weekId,
      newMemberCount: admin.firestore.FieldValue.increment(1),
    }, { merge: true });
  } catch (err) {
    console.error('updateCrewMissionNewMember error:', err.message);
  }
};

/**
 * Checks if the crew goal is met and whether the user contributed.
 * Returns { complete, contributed, reason? }
 */
async function checkCrewGoal(missionId, missionData, crew, uid, userData, weekId) {
  const crewTickers = CREW_MEMBERS[crew] || [];

  switch (missionId) {
    case 'CREW_BUY_500': {
      const complete = (missionData.buyCount || 0) >= CREW_BUY_THRESHOLD;
      return {
        complete,
        contributed: !!missionData.contributorsBuy?.[uid],
        reason: complete ? null : `Crew needs to buy ${CREW_BUY_THRESHOLD} shares total this week.`,
      };
    }
    case 'CREW_SELL_500': {
      const complete = (missionData.sellCount || 0) >= CREW_SELL_THRESHOLD;
      return {
        complete,
        contributed: !!missionData.contributorsSell?.[uid],
        reason: complete ? null : `Crew needs to sell ${CREW_SELL_THRESHOLD} shares total this week.`,
      };
    }
    case 'CREW_VOLUME': {
      const complete = (missionData.tradeVolume || 0) >= CREW_VOLUME_THRESHOLD;
      return {
        complete,
        contributed: !!missionData.contributorsVolume?.[uid],
        reason: complete ? null : `Crew needs $${CREW_VOLUME_THRESHOLD.toLocaleString()} in total trade volume this week.`,
      };
    }
    case 'CREW_RECRUIT': {
      const complete = (missionData.newMemberCount || 0) >= 1;
      if (!complete) return { complete: false, contributed: false, reason: 'No new crew members joined this week.' };
      const weekStartTs = new Date(weekId + 'T00:00:00Z').getTime();
      const contributed = (userData.crewJoinedAt || 0) < weekStartTs;
      return { complete: true, contributed, reason: null };
    }
    case 'CREW_PUMP': {
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) return { complete: false, contributed: false, reason: 'Market data unavailable.' };
      const { prices = {}, priceHistory = {} } = marketSnap.data();
      const weekStartTs = new Date(weekId + 'T00:00:00Z').getTime();

      let anyTickerUp = false;
      for (const ticker of crewTickers) {
        const currentPrice = prices[ticker];
        if (!currentPrice) continue;
        const history = priceHistory[ticker] || [];
        let weekStartPrice = null;
        let closestTs = -Infinity;
        for (const entry of history) {
          const ts = typeof entry.timestamp === 'number' ? entry.timestamp : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000 : 0);
          if (ts <= weekStartTs && ts > closestTs) { closestTs = ts; weekStartPrice = entry.price; }
        }
        if (!weekStartPrice) continue;
        if (currentPrice >= weekStartPrice * CREW_PUMP_THRESHOLD) { anyTickerUp = true; break; }
      }

      if (!anyTickerUp) return { complete: false, contributed: false, reason: 'No crew stock has risen 10% this week.' };
      return { complete: true, contributed: !!missionData.contributorsPump?.[uid] };
    }
    case 'CREW_FULL_ROSTER': {
      const usersSnap = await db.collection('users').where('crew', '==', crew).get();
      const coveredTickers = new Set();
      usersSnap.docs.forEach(doc => {
        const holdings = doc.data().holdings || {};
        Object.entries(holdings).forEach(([t, shares]) => {
          if (shares > 0 && crewTickers.includes(t)) coveredTickers.add(t);
        });
      });
      const complete = crewTickers.every(t => coveredTickers.has(t));
      if (!complete) return { complete: false, contributed: false, reason: 'Not every crew stock is held by a crew member.' };
      const userHoldings = userData.holdings || {};
      const contributed = crewTickers.some(t => (userHoldings[t] || 0) > 0);
      return { complete: true, contributed };
    }
    default:
      return { complete: false, contributed: false, reason: 'Unknown mission.' };
  }
}

exports.claimCrewMission = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { missionId } = data;

  if (!VALID_CREW_MISSIONS.has(missionId)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid crew mission.');
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  const userData = userSnap.data();
  checkBanned(userData);

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

  writeNotification(uid, {
    type: 'achievement',
    title: 'Crew Mission Complete',
    message: `You earned $${reward} from your crew's mission.`,
    data: {},
  });

  return { success: true, reward };
});

exports.updateCrewMissionProgress = updateCrewMissionProgress;
exports.updateCrewMissionNewMember = updateCrewMissionNewMember;
exports.CREW_MISSION_REWARDS = CREW_MISSION_REWARDS;
