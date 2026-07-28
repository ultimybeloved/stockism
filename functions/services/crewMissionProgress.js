'use strict';
// Crew mission progress tracking — the write path called after a fill.
//
// Internal module: NOT registered in functions/index.js. It lives here because
// four files need it (crewMissions.js plus the three trade-executing paths:
// tradeEffects.js, limitOrders.js, marketOrders.js). It used to be exported from
// crewMissions.js, which meant index.js re-exported a plain helper into the
// deployed Cloud Function list — see the "index exports only cloud functions"
// check in scripts/test-discord-commands-emulator.cjs.
//
// WEEK BOUNDARY WARNING: getWeekId here is UTC-based and is deliberately NOT the
// same as getWeekId in helpers.js, which is local-time based and drives the
// daily/weekly personal missions. They have always differed. Do not "unify" them
// — it would silently move crew week boundaries and orphan in-progress missions.

const admin = require('firebase-admin');
const db = admin.firestore();

const { CREW_MEMBERS } = require('../constants');

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

module.exports = { getWeekId, updateCrewMissionProgress };
