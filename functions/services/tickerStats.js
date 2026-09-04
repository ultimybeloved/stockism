'use strict';
// All-time high/low sweep.
//
// This is its own schedule rather than a few lines bolted onto an existing
// price mover, for two reasons. Every mover either skips the weekly halt or
// writes only on the cycles where it actually acts, so hooking any one of them
// would leave holes. And the largest price moves of the week are the admin's
// chapter review changes, which happen DURING the Thursday halt, when every
// mover is deliberately asleep.
//
// Recording an extreme does not move a price, so the halt rules that bind every
// mover do not apply here. This job never writes a price and never writes a
// history point.
//
// Hourly is the resolution. A spike that happens and fully reverses inside one
// hour is not captured. That is the accepted trade: the alternative is reading
// the stats back inside the trade transaction, and executeTrade is not a place
// to add reads.
const { cf } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { buildExtremeUpdates } = require('../helpers');

exports.recordPriceExtremes = cf().pubsub
  .schedule('20 * * * *')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const marketRef = db.collection('market').doc('current');
      const snap = await marketRef.get();
      if (!snap.exists) {
        console.log('recordPriceExtremes: no market document found');
        return null;
      }

      const data = snap.data();
      const updates = buildExtremeUpdates(data.prices || {}, data.ath || {}, data.atl || {});

      const moved = Object.keys(updates).length;
      if (!moved) {
        console.log('recordPriceExtremes: no new records');
        return null;
      }

      await marketRef.update(updates);
      console.log(`recordPriceExtremes: ${moved} marks moved`);
      return null;
    } catch (err) {
      console.error('recordPriceExtremes error:', err);
      return null;
    }
  });
