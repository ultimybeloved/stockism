'use strict';
// Heartbeats for scheduled jobs and player activity tracking.

const admin = require('firebase-admin');
const { reportError } = require('./sentry');
const { TRADE_TX_TYPES, TRADE_RECORD_ACTIONS } = require('./constants');
const db = admin.firestore();

// Where scheduled jobs record that they finished. One document, one field per
// job, so the watchdog reads a single doc instead of a counter collection.
const HEARTBEAT_DOC = () => admin.firestore().collection('admin').doc('heartbeats');

/**
 * Record that a scheduled job completed successfully.
 *
 * Call at the END of a job's success path only. A job that throws leaves its
 * heartbeat stale, which is exactly what scheduledJobWatchdog looks for.
 *
 * Deliberately fail-soft and awaited nowhere critical: monitoring must never be
 * the reason a payout run fails.
 *
 * @param {string} job - export name of the scheduled function, e.g. 'payDividends'
 */
async function recordHeartbeat(job) {
  try {
    await HEARTBEAT_DOC().set({ [job]: Date.now() }, { merge: true });
  } catch (err) {
    reportError(err, { where: 'recordHeartbeat', job });
  }
}

// Coerce any of our timestamp shapes (Firestore Timestamp, epoch ms number,
// or ISO string) to epoch ms; 0 if missing/unparseable.
function toMs(ts) {
  if (!ts) return 0;
  if (typeof ts === 'number') return ts;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (typeof ts.seconds === 'number') return ts.seconds * 1000;
  if (typeof ts === 'string') {
    const p = Date.parse(ts);
    return isNaN(p) ? 0 : p;
  }
  return 0;
}

// Most-recent activity for a user, used by the active-user metric.
//
// "Active" means opened the app, not just traded. lastSynced is the widest net:
// every signed-in client calls syncPortfolio ~30s into a session, so it stamps
// for lurkers who log in, look at charts, and never place an order — the
// players the old action-only count silently dropped. The rest are fallbacks so
// nobody is missed: lastActive (any write action), plus the older lastTradeTime
// / lastCheckin stamps for accounts that predate it. Signups stamp lastActive
// at creation, so brand-new accounts are covered too.
function getLastActiveMs(userData) {
  if (!userData) return 0;
  return Math.max(
    toMs(userData.lastSynced),
    toMs(userData.lastActive),
    toMs(userData.lastTradeTime),
    toMs(userData.lastCheckin),
  );
}

// Trades and cash volume in a window, for the daily and weekly market reports.
//
// Sourced from the trades collection rather than each user's transactionLog:
// that log only keeps a user's last 100 entries, so summing it undercounts
// anyone with a busy week. This query has no such cap. Bots don't write trade
// records, so their activity is still read from their logs — the cap can bite
// there on a 7-day window, but bots only affect volume, not player counts.
//
// Returns per-player trade counts too, so callers can rank the top traders.
async function sumMarketActivity({ sinceMs, users = [] }) {
  const snap = await db.collection('trades').where('timestamp', '>', new Date(sinceMs)).get();

  let trades = 0;
  let volume = 0;
  const tradesByUid = {};

  snap.forEach((doc) => {
    const t = doc.data();
    if (!TRADE_RECORD_ACTIONS.has(t.action)) return; // skip dividends / forced margin closes
    trades++;
    volume += t.totalValue || 0;
    if (t.uid) tradesByUid[t.uid] = (tradesByUid[t.uid] || 0) + 1;
  });

  users.forEach((u) => {
    if (!u.isBot) return;
    (u.transactionLog || []).forEach((tx) => {
      if (!TRADE_TX_TYPES.has(tx.type) || !(tx.timestamp > sinceMs)) return;
      trades++;
      volume += tx.totalCost || tx.totalRevenue || 0;
    });
  });

  return { trades, volume, tradesByUid };
}

// Fire-and-forget activity stamp. Called from player-action callables so the
// active-user metric reflects all actions, not just trades/check-ins. Never
// awaited — it must not affect the action's success.
//
// Pass a `feature` to also stamp `lastUsed.<feature>`. That rides along on the
// write this already performs, so per-feature usage costs nothing extra — which
// is the whole reason the usage report is built on this instead of its own
// counters. weeklyFeatureUsage reads the stamps back.
function touchLastActive(uid, feature) {
  if (!uid) return;
  const update = { lastActive: Date.now() };
  if (feature) update[`lastUsed.${feature}`] = Date.now();
  db.collection('users')
    .doc(uid)
    .update(update)
    .catch(() => {});
}

module.exports = { HEARTBEAT_DOC, recordHeartbeat, toMs, getLastActiveMs, sumMarketActivity, touchLastActive };
