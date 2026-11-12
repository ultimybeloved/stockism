'use strict';

// One-off (2026-11-12): removes the automated movers' source tags from every
// world-readable chart point, live (market/priceHistory) and archived
// (market/current/price_history/{ticker}). The tags let anyone total each
// stock's bot drift. Prices and timestamps are untouched; only the `source`
// field goes, and only when it is one of PRIVATE_POINT_SOURCES.
//
// Deploy botTrader and marketMakerCycle first, so no new tagged points arrive.
//
//   npx tsx scripts/strip-bot-point-tags.cjs          (dry run, counts)
//   npx tsx scripts/strip-bot-point-tags.cjs --apply  (writes)
//
// --apply also seeds the admin Bots screen's moveLog from the last 48 hours of
// tagged points, when the log is still empty, so the screen isn't blank.

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');
const { PRIVATE_POINT_SOURCES } = require('../functions/src/shared/constants/market');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const PRIVATE = new Set(PRIVATE_POINT_SOURCES);
const MOVE_WINDOW_MS = 48 * 60 * 60 * 1000;

const strip = (p) => {
  if (!p || !PRIVATE.has(p.source)) return p;
  const { source: _drop, ...rest } = p;
  return rest;
};
const countTagged = (pts) => (Array.isArray(pts) ? pts.filter((p) => p && PRIVATE.has(p.source)).length : 0);

async function main() {
  const apply = process.argv.includes('--apply');
  const liveRef = db.doc('market/priceHistory');
  const archiveCol = db.collection('market').doc('current').collection('price_history');

  // Moves for the admin Bots screen, read before anything is stripped.
  const liveSnap = await liveRef.get();
  const live = liveSnap.data() || {};
  const now = Date.now();
  const seeded = [];
  for (const [ticker, pts] of Object.entries(live)) {
    if (!Array.isArray(pts)) continue;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if ((p.source === 'bot' || p.source === 'bot_guard') && p.timestamp >= now - MOVE_WINDOW_MS)
        seeded.push({ at: p.timestamp, ticker, from: pts[i - 1].price, to: p.price, guard: p.source === 'bot_guard' });
    }
  }
  seeded.sort((a, b) => b.at - a.at);

  let liveTagged = 0;
  for (const pts of Object.values(live)) liveTagged += countTagged(pts);

  const archiveSnaps = await archiveCol.get();
  let archiveTagged = 0;
  let archiveDocs = 0;
  for (const d of archiveSnaps.docs) {
    const n = countTagged(d.data().history);
    if (n) {
      archiveTagged += n;
      archiveDocs++;
    }
  }
  console.log(`Live: ${liveTagged} tagged points. Archive: ${archiveTagged} tagged points in ${archiveDocs} stocks.`);
  console.log(`Bots screen seed: ${seeded.length} moves from the last 48h.`);
  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }

  // Seed the move log first, while the tags still exist (only if empty).
  const stateRef = db.doc('botState/storylines');
  await db.runTransaction(async (tx) => {
    const s = (await tx.get(stateRef)).data() || {};
    if (!Array.isArray(s.moveLog) || !s.moveLog.length)
      tx.set(stateRef, { moveLog: seeded.slice(0, 300) }, { merge: true });
  });

  // Live doc in one transaction: trades append to it with arrayUnion, and the
  // transaction makes them wait or retry rather than be overwritten.
  await db.runTransaction(async (tx) => {
    const data = (await tx.get(liveRef)).data() || {};
    const update = {};
    for (const [ticker, pts] of Object.entries(data)) {
      if (countTagged(pts)) update[ticker] = pts.map(strip);
    }
    if (Object.keys(update).length) tx.update(liveRef, update);
  });

  let done = 0;
  for (const d of archiveSnaps.docs) {
    if (!countTagged(d.data().history)) continue;
    await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(d.ref)).data() || {};
      tx.update(d.ref, { history: (fresh.history || []).map(strip) });
    });
    done++;
  }

  const [liveAfter, archiveAfter] = await Promise.all([liveRef.get(), archiveCol.get()]);
  let left = 0;
  for (const pts of Object.values(liveAfter.data() || {})) left += countTagged(pts);
  for (const d of archiveAfter.docs) left += countTagged(d.data().history);
  console.log(`Stripped live + ${done} archive docs. Tagged points left: ${left}.`);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
