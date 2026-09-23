'use strict';
// What the coordination scan DOES about a cluster, as opposed to finding one.
//
// INTERNAL MODULE — required by coordDetection.js, never listed in
// servicePaths.js.
//
// Two things, both deliberately mild so an innocent player caught in a cluster
// loses nothing but a little time:
//
//   Group block   everyone in a TIGHT downward cluster gets the personal wash
//                 rule and the short-after-dump block on that stock, as if they
//                 had made the heavy sell themselves. The personal rules are per
//                 account, so a group splits a raid (A dumps, B shorts, C buys
//                 the dip) and none of them trips anything. Selling and covering
//                 are never blocked.
//   All in        a participant in an UPWARD cluster with most of their holdings
//                 in that one stock, on borrowed money. Reported to the admin,
//                 never blocked: it is the setup for a pump, not proof of one.
//
// Anything heavier (Platinum/Diamond exclusion, removing profits) is the
// admin's call, in seasonExclusions.js and coordReview.js.

const admin = require('firebase-admin');
const db = admin.firestore();

const {
  COORD_ALL_IN_SHARE,
  COORD_ALL_IN_BORROWED,
  WASH_RULE_COOLDOWN_MS,
} = require('../constants');

const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts : ts.toMillis ? ts.toMillis() : 0);

/**
 * Stamp the buy-back and short blocks on every participant of every tight
 * downward cluster that is still inside the block window. Runs on every scan,
 * not just fresh clusters, so someone who joins a cluster after it was first
 * reported is still caught. Only ever moves a stamp later, never earlier.
 *
 * @returns {Promise<Array<{uid, ticker}>>} who was newly blocked
 */
async function applyGroupBlocks(clusters, now = Date.now()) {
  const wanted = [];
  for (const c of clusters) {
    if (c.direction !== 'down' || !c.tight) continue;
    c.uids.forEach((uid, i) => {
      const at = c.lastMs?.[i] || c.startedAt;
      if (now - at < WASH_RULE_COOLDOWN_MS) wanted.push({ uid, ticker: c.ticker, at });
    });
  }
  if (!wanted.length) return [];

  const refs = [...new Set(wanted.map((w) => w.uid))].map((uid) => db.collection('users').doc(uid));
  const docs = await db.getAll(...refs, { fieldMask: ['lastHeavySell', 'lastHeavyExit'] });
  const byUid = new Map(docs.filter((d) => d.exists).map((d) => [d.id, d.data()]));

  const blocked = [];
  const batch = db.batch();
  for (const { uid, ticker, at } of wanted) {
    const u = byUid.get(uid);
    if (!u) continue;
    const update = {};
    const stamp = admin.firestore.Timestamp.fromMillis(at);
    if (toMs(u.lastHeavySell?.[ticker]) < at) update[`lastHeavySell.${ticker}`] = stamp;
    if (toMs(u.lastHeavyExit?.[ticker]) < at) update[`lastHeavyExit.${ticker}`] = stamp;
    if (!Object.keys(update).length) continue;
    batch.update(db.collection('users').doc(uid), update);
    blocked.push({ uid, ticker });
  }
  if (blocked.length) await batch.commit();
  return blocked;
}

/**
 * For each upward cluster, the participants who are all in on that stock with
 * borrowed money. Mutates each cluster with `allIn: [{ uid, share, borrowed }]`.
 */
async function markAllIn(clusters, prices) {
  const ups = clusters.filter((c) => c.direction === 'up');
  if (!ups.length) return;
  const refs = [...new Set(ups.flatMap((c) => c.uids))].map((uid) => db.collection('users').doc(uid));
  const docs = await db.getAll(...refs, { fieldMask: ['holdings', 'marginUsed', 'portfolioValue'] });
  const byUid = new Map(docs.filter((d) => d.exists).map((d) => [d.id, d.data()]));

  for (const c of ups) {
    c.allIn = [];
    for (const uid of c.uids) {
      const u = byUid.get(uid);
      if (!u) continue;
      const values = Object.entries(u.holdings || {}).map(([t, sh]) => [t, (Number(sh) || 0) * (prices?.[t] || 0)]);
      const total = values.reduce((s, [, v]) => s + v, 0);
      const inIt = values.find(([t]) => t === c.ticker)?.[1] || 0;
      const share = total > 0 ? inIt / total : 0;
      const borrowed = (u.portfolioValue || 0) > 0 ? (u.marginUsed || 0) / u.portfolioValue : 0;
      if (share >= COORD_ALL_IN_SHARE && borrowed >= COORD_ALL_IN_BORROWED) {
        c.allIn.push({ uid, share: Math.round(share * 100) / 100, borrowed: Math.round(borrowed * 100) / 100 });
      }
    }
  }
}

module.exports = { applyGroupBlocks, markAllIn };
