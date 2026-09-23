'use strict';
// What a coordinated push made a player, and taking it back.
//
// Measured per flagged push, from the cluster's start over COORD_PROFIT_WINDOW_MS,
// on that stock only, from the player's own trade records:
//
//   locked in   shares sold and bought back inside the window, at the
//               difference in price, plus shorts opened and covered in it.
//               Money the push already made.
//   gain since  whatever position the window left them with (shares bought in
//               a crash they helped cause, or into a pump), valued at today's
//               price against what they paid.
//
// A short covered in the window but opened in the week before it is matched to
// that earlier short, so closing an old position doesn't read as a loss.
// Pushes on the same stock whose windows overlap are merged, so nothing is
// counted twice.
//
// Removing it is the admin's decision, one player at a time. Cash goes first;
// the rest becomes margin debt, which is refused if it would push the account
// into forced liquidation.

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const {
  ADMIN_UID, LONG_MARGIN_LIQUIDATION_THRESHOLD, LONG_MARGIN_CALL_THRESHOLD,
  ADMIN_MEMO_MAX_LENGTH,
} = require('../constants');
const { toMs, round2, writeNotification } = require('../helpers');
const { seasonMarginUpdate } = require('./seasonTiers');
// Pure math, apart so it can be unit-tested. Internal module.
const { pushWindows, windowProfit, afterRemoval, WEEK_MS } = require('./coordProfitMath');

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const requireAdmin = (context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
};

/** Every flagged push this player was in over the last 30 days, and what each made. */
async function coordProfitFor(uid) {
  const since = Date.now() - LOOKBACK_MS;
  const [alertSnap, tradeSnap, marketSnap] = await Promise.all([
    db.collection('watchlist_alerts').where('participantUIDs', 'array-contains', uid).get(),
    db.collection('trades').where('uid', '==', uid).get(),
    db.collection('market').doc('current').get(),
  ]);
  const prices = marketSnap.exists ? marketSnap.data().prices || {} : {};
  const alerts = alertSnap.docs.map((d) => d.data())
    .filter((a) => a.type === 'coordinated_pressure' && toMs(a.timestamp) >= since);
  const trades = tradeSnap.docs.map((d) => d.data()).map((t) => ({
    ticker: t.ticker, action: t.action, ts: toMs(t.timestamp),
    shares: Number(t.amount || t.shares) || 0, value: Number(t.totalValue) || 0,
  })).filter((t) => t.ts >= since - WEEK_MS && t.shares > 0);

  const pushes = pushWindows(alerts).map((w) => ({
    ticker: w.ticker,
    days: [...new Set(w.days)].sort(),
    ...windowProfit(trades.filter((t) => t.ticker === w.ticker), w, prices[w.ticker] || 0),
  })).filter((p) => p.trades > 0);

  const total = pushes.reduce((s, p) => s + p.lockedIn + p.gainSince, 0);
  return { pushes, suggested: round2(Math.max(0, total)) };
}

exports.getCoordProfit = cf({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = data?.uid;
  if (!uid || typeof uid !== 'string') throw new functions.https.HttpsError('invalid-argument', 'uid is required');
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found');
  const result = await coordProfitFor(uid);
  return { uid, ...result, preview: { ...afterRemoval(userDoc.data(), result.suggested), marginCallLine: LONG_MARGIN_CALL_THRESHOLD } };
});

/**
 * Remove `amount` of manipulation profit from a player. `preview: true` only
 * reports where the account would stand. The player gets a notice with the
 * amount and a plain reason; the memo stays in the admin log.
 */
exports.adminRemoveCoordProfit = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const { uid, preview } = data || {};
  const amount = round2(Number(data?.amount));
  const memo = String(data?.memo || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  if (!uid || typeof uid !== 'string') throw new functions.https.HttpsError('invalid-argument', 'uid is required');
  if (!(amount > 0) || !Number.isFinite(amount)) throw new functions.https.HttpsError('invalid-argument', 'Amount must be above 0');
  if (!preview && !memo) throw new functions.https.HttpsError('invalid-argument', 'A memo is required — say why.');
  if (memo.length > ADMIN_MEMO_MAX_LENGTH) throw new functions.https.HttpsError('invalid-argument', `Memo must be ${ADMIN_MEMO_MAX_LENGTH} characters or less`);

  const userRef = db.collection('users').doc(uid);
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
    const u = snap.data();
    const after = afterRemoval(u, amount);
    if (after.toDebt > 0 && !u.marginEnabled) {
      throw new functions.https.HttpsError('failed-precondition',
        `They only have $${round2(u.cash || 0)} in cash and margin is off, so the rest can't be taken as debt.`);
    }
    if (after.toDebt > 0 && after.equityRatioAfter <= LONG_MARGIN_LIQUIDATION_THRESHOLD) {
      throw new functions.https.HttpsError('failed-precondition',
        `That would put them at ${Math.round(after.equityRatioAfter * 100)}% equity, below the ${Math.round(LONG_MARGIN_LIQUIDATION_THRESHOLD * 100)}% forced-sale line. Take less.`);
    }
    if (preview) return { preview: true, ...after, marginCallLine: LONG_MARGIN_CALL_THRESHOLD };

    const now = Date.now();
    tx.update(userRef, {
      cash: round2((u.cash || 0) - after.fromCash),
      ...(after.toDebt > 0 ? {
        marginUsed: after.owedAfter,
        ...seasonMarginUpdate(u, after.owedAfter, now),
      } : {}),
    });
    tx.set(db.collection('adminCashLog').doc(), {
      userId: uid,
      displayName: u.displayName || null,
      mode: 'remove_coord_profit',
      amount,
      previousCash: u.cash || 0,
      newCash: round2((u.cash || 0) - after.fromCash),
      addedDebt: after.toDebt,
      delta: -amount,
      memo,
      at: admin.firestore.FieldValue.serverTimestamp(),
      by: context.auth.uid,
    });
    return { preview: false, ...after, marginCallLine: LONG_MARGIN_CALL_THRESHOLD };
  });

  if (!result.preview) {
    await writeNotification(uid, {
      type: 'system',
      title: 'Profit removed',
      message: `$${amount.toLocaleString('en-US')} was removed from your account: profit from planning trades with other players to move a price, which is against the rules.`
        + (result.toDebt > 0 ? ` $${result.toDebt.toLocaleString('en-US')} of it was added to your margin balance.` : ''),
    });
    console.log(`COORD PROFIT REMOVED: ${uid} $${amount} (debt ${result.toDebt})`);
  }
  return { uid, amount, ...result };
});

