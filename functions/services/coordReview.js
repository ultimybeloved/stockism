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
const { toMs, round2, writeNotification, remainingShares, cohortRemoveUpdate } = require('../helpers');
const { FieldValue } = require('firebase-admin/firestore');
const { seasonMarginUpdate } = require('./seasonTiers');
// Pure math, apart so it can be unit-tested. Internal module.
const { pushWindows, windowProfit, planRemoval, WEEK_MS } = require('./coordProfitMath');
const { clusterTrades } = require('./coordClustering');

const LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

const requireAdmin = (context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }
};

/**
 * Every coordinated push this player was in over the last 30 days, and what
 * each made. Found from the trades themselves with the scan's own clustering,
 * not from stored alerts: the scan only started on 2026-09-19, and pushes
 * before that were never written as alerts. About 10k reads, admin-only.
 */
async function coordProfitFor(uid) {
  const since = Date.now() - LOOKBACK_MS;
  const [tradeSnap, marketSnap] = await Promise.all([
    db.collection('trades')
      .where('timestamp', '>=', admin.firestore.Timestamp.fromMillis(since - WEEK_MS))
      .select('uid', 'ticker', 'action', 'priceImpact', 'source', 'timestamp', 'amount', 'totalValue')
      .get(),
    db.collection('market').doc('current').get(),
  ]);
  const prices = marketSnap.exists ? marketSnap.data().prices || {} : {};
  const rows = tradeSnap.docs.map((d) => { const t = d.data(); return { ...t, ts: toMs(t.timestamp) }; });

  const clusters = clusterTrades(rows.filter((r) => r.ts >= since)).filter((c) => c.uids.includes(uid));
  const trades = rows.filter((r) => r.uid === uid).map((t) => ({
    ticker: t.ticker, action: t.action, ts: t.ts,
    shares: Number(t.amount) || 0, value: Number(t.totalValue) || 0,
  })).filter((t) => t.shares > 0);

  const pushes = pushWindows(clusters).map((w) => ({
    ticker: w.ticker,
    days: [...new Set(w.days)].sort(),
    ...windowProfit(trades.filter((t) => t.ticker === w.ticker), w, prices[w.ticker] || 0),
  })).filter((p) => p.trades > 0);

  const total = pushes.reduce((s, p) => s + p.lockedIn + p.gainSince, 0);
  // Stocks the profit was made on, most profitable first: shares come from these first.
  const preferTickers = [...new Set(pushes.filter((p) => p.lockedIn + p.gainSince > 0)
    .sort((x, y) => (y.lockedIn + y.gainSince) - (x.lockedIn + x.gainSince)).map((p) => p.ticker))];
  return { pushes, suggested: round2(Math.max(0, total)), preferTickers, prices };
}

exports.getCoordProfit = cf({ timeoutSeconds: 120 }).https.onCall(async (data, context) => {
  requireAdmin(context);
  const uid = data?.uid;
  if (!uid || typeof uid !== 'string') throw new functions.https.HttpsError('invalid-argument', 'uid is required');
  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found');
  const { pushes, suggested, preferTickers, prices } = await coordProfitFor(uid);
  return {
    uid, pushes, suggested, preferTickers,
    preview: { ...planRemoval(userDoc.data(), suggested, prices, preferTickers), marginCallLine: LONG_MARGIN_CALL_THRESHOLD },
  };
});

/**
 * Remove `amount` of manipulation profit from a player, taken as shares of the
 * stocks they pushed first (see planRemoval), then other holdings, then cash,
 * then margin debt. `preview: true` only reports the plan. The player gets a
 * notice with the amount and a plain reason; the memo stays in the admin log.
 */
exports.adminRemoveCoordProfit = cf().https.onCall(async (data, context) => {
  requireAdmin(context);
  const { uid, preview } = data || {};
  const amount = round2(Number(data?.amount));
  const memo = String(data?.memo || '').replace(/[\x00-\x1f\x7f]/g, '').trim();
  // Only decides which holdings go first, so it is taken from the caller (the
  // panel passes what getCoordProfit found) rather than re-reading every trade.
  const preferTickers = (Array.isArray(data?.preferTickers) ? data.preferTickers : [])
    .filter((t) => typeof t === 'string' && /^[A-Z0-9]{1,10}$/.test(t)).slice(0, 10);
  if (!uid || typeof uid !== 'string') throw new functions.https.HttpsError('invalid-argument', 'uid is required');
  if (!(amount > 0) || !Number.isFinite(amount)) throw new functions.https.HttpsError('invalid-argument', 'Amount must be above 0');
  if (!preview && !memo) throw new functions.https.HttpsError('invalid-argument', 'A memo is required — say why.');
  if (memo.length > ADMIN_MEMO_MAX_LENGTH) throw new functions.https.HttpsError('invalid-argument', `Memo must be ${ADMIN_MEMO_MAX_LENGTH} characters or less`);

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');
  const result = await db.runTransaction(async (tx) => {
    const [snap, marketSnap] = await Promise.all([tx.get(userRef), tx.get(marketRef)]);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
    const u = snap.data();
    const prices = marketSnap.exists ? marketSnap.data().prices || {} : {};
    const plan = planRemoval(u, amount, prices, preferTickers);
    if (plan.toDebt > 0 && !u.marginEnabled) {
      throw new functions.https.HttpsError('failed-precondition',
        `They don't hold enough to cover it and margin is off: $${plan.toDebt.toLocaleString('en-US')} would be left over. Take less.`);
    }
    if (plan.toDebt > 0 && plan.equityRatioAfter <= LONG_MARGIN_LIQUIDATION_THRESHOLD) {
      throw new functions.https.HttpsError('failed-precondition',
        `That would put them at ${Math.round(plan.equityRatioAfter * 100)}% equity, below the ${Math.round(LONG_MARGIN_LIQUIDATION_THRESHOLD * 100)}% forced-sale line. Take less.`);
    }
    if (preview) return { preview: true, ...plan, marginCallLine: LONG_MARGIN_CALL_THRESHOLD };

    const now = Date.now();
    const update = {
      cash: round2((u.cash || 0) - plan.fromCash),
      portfolioValue: round2(Math.max(0, (u.portfolioValue || 0) - plan.fromShares - plan.fromCash)),
    };
    for (const step of plan.shares) {
      const left = remainingShares(u.holdings[step.ticker], step.shares);
      Object.assign(update, cohortRemoveUpdate(u, step.ticker, step.shares));
      if (left > 0) {
        update[`holdings.${step.ticker}`] = left;
      } else {
        // A closed position leaves nothing behind (see CLAUDE.md, fill lanes).
        for (const f of ['holdings', 'costBasis', 'lowestWhileHolding', 'ipoLockup', 'marginLockup']) {
          update[`${f}.${step.ticker}`] = FieldValue.delete();
        }
      }
    }
    if (plan.toDebt > 0) {
      update.marginUsed = plan.owedAfter;
      Object.assign(update, seasonMarginUpdate(u, plan.owedAfter, now));
    }
    tx.update(userRef, update);
    tx.set(db.collection('adminCashLog').doc(), {
      userId: uid,
      displayName: u.displayName || null,
      mode: 'remove_coord_profit',
      amount,
      sharesRemoved: plan.shares.map(({ ticker, shares, value }) => ({ ticker, shares, value, price: prices[ticker] || 0 })),
      previousCash: u.cash || 0,
      newCash: update.cash,
      addedDebt: plan.toDebt,
      delta: -amount,
      memo,
      at: admin.firestore.FieldValue.serverTimestamp(),
      by: context.auth.uid,
    });
    return { preview: false, ...plan, marginCallLine: LONG_MARGIN_CALL_THRESHOLD };
  });

  if (!result.preview) {
    const taken = [
      ...result.shares.map((x) => `${x.shares.toLocaleString('en-US')} $${x.ticker}`),
      ...(result.fromCash > 0 ? [`$${result.fromCash.toLocaleString('en-US')} cash`] : []),
    ].join(', ');
    await writeNotification(uid, {
      type: 'system',
      title: 'Profit removed',
      message: `$${amount.toLocaleString('en-US')} was removed from your account (${taken}): profit from planning trades with other players to move a price, which is against the rules.`
        + (result.toDebt > 0 ? ` $${result.toDebt.toLocaleString('en-US')} of it was added to your margin balance.` : ''),
    });
    console.log(`COORD PROFIT REMOVED: ${uid} $${amount} (debt ${result.toDebt})`);
  }
  return { uid, amount, ...result };
});

