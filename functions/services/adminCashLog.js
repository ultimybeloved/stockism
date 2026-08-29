'use strict';
// Read side of the admin cash audit log.
//
// adminSetCash has been writing an `adminCashLog` entry for every balance change
// since 2026-08-22 (who, how much, before and after, the memo, and when). Nothing
// ever read it back, so the record existed but was invisible. This is the reader.
//
// Write path lives in adminOps.js. Keep it that way: this file must stay a
// read-only view, so a bug here can never move anyone's money.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { ADMIN_UID, ADMIN_CASH_LOG_PAGE_MAX } = require('../constants');

/**
 * Admin-only: the most recent cash adjustments, newest first.
 *
 * Deliberately one un-filtered page rather than a query per player. The whole
 * collection is small (one entry per manual adjustment ever made), a single
 * ordered read needs no composite index, and the panel filters the page it
 * already has. Add a real query here only if this ever stops fitting.
 */
exports.adminListCashLog = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const requested = Number(data?.limit);
  const limit = Math.min(
    ADMIN_CASH_LOG_PAGE_MAX,
    Number.isFinite(requested) && requested > 0 ? Math.floor(requested) : ADMIN_CASH_LOG_PAGE_MAX
  );

  const snap = await db.collection('adminCashLog').orderBy('at', 'desc').limit(limit).get();

  const entries = snap.docs.map((doc) => {
    const d = doc.data();
    return {
      id: doc.id,
      userId: d.userId,
      displayName: d.displayName || null,
      mode: d.mode || 'set',
      amount: d.amount ?? null,
      previousCash: d.previousCash ?? null,
      newCash: d.newCash ?? null,
      delta: d.delta ?? null,
      memo: d.memo || null,
      // Timestamps predate serverTimestamp on some early rows, so tolerate both.
      at: d.at?.toMillis ? d.at.toMillis() : (typeof d.at === 'number' ? d.at : null),
    };
  });

  // Handed to the panel so the header can say what was given away without the
  // client having to re-add it, and so both numbers always agree.
  const granted = entries.reduce((sum, e) => sum + (e.delta > 0 ? e.delta : 0), 0);
  const takenBack = entries.reduce((sum, e) => sum + (e.delta < 0 ? -e.delta : 0), 0);

  return {
    success: true,
    entries,
    totals: {
      granted: Math.round(granted * 100) / 100,
      takenBack: Math.round(takenBack * 100) / 100,
      count: entries.length,
    },
  };
});
