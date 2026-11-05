'use strict';

// Takes the free Crew Fund missions (grant-crew-fund-goddog.cjs, 2026-10-30)
// back out of God Dog's rivalry for the week of 2026-10-29. The grant counted
// as a finished mission, so every member it touched became "active" and God
// Dog's score collapsed. Cash, mission totals, and shop credit are not touched.
//
//   npx tsx scripts/fix-goddog-rivalry.cjs            (dry run)
//   npx tsx scripts/fix-goddog-rivalry.cjs --confirm  (applies it)
//
// Safe to re-run: each player is marked with rivalryGrantRemoved.

const fs = require('fs');
const path = require('path');
const admin = require('../functions/node_modules/firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const { RIVALRY } = require('../functions/src/shared/crews');

const CREW = 'GOD_DOG';
const WEEK = '2026-10-29';
const CONFIRM = process.argv.includes('--confirm');
const del = () => admin.firestore.FieldValue.delete();

const main = async () => {
  const ledger = await db.collection('ledger').where('ref', '==', 'CREW_FUND').get();
  const grants = {};
  for (const d of ledger.docs) {
    const e = d.data();
    if (e.type !== 'mission_reward' || e.detail?.grantedBy !== 'admin') continue;
    grants[e.uid] = (grants[e.uid] || 0) + 1;
  }
  const boardRef = db.collection('rivalries').doc(WEEK);
  const before = (await boardRef.get()).data()?.crews?.[CREW] || {};
  const active = new Set(Object.keys(before.active || {}));
  const qualified = new Set(Object.keys(before.qualified || {}));
  console.log(
    `Grants found: ${Object.values(grants).reduce((a, b) => a + b, 0)} for ${Object.keys(grants).length} players`,
  );
  console.log(`Board now: ${qualified.size} qualified of ${active.size} active`);

  const tally = { changed: 0, stillActive: 0, skipped: 0, lostQualified: 0 };
  for (const [uid, count] of Object.entries(grants)) {
    const userRef = db.collection('users').doc(uid);
    const out = await db.runTransaction(async (tx) => {
      const u = (await tx.get(userRef)).data();
      const wp = u?.weeklyMissions?.[WEEK];
      if (!wp || wp.rivalryGrantRemoved || wp.rivalry?.crew !== CREW) return null;
      const next = Math.max(0, (wp.rivalry.count || 0) - count);
      if (CONFIRM) {
        tx.update(userRef, {
          [`weeklyMissions.${WEEK}.rivalry`]: { crew: CREW, count: next },
          [`weeklyMissions.${WEEK}.rivalryGrantRemoved`]: true,
        });
      }
      return { next, wasQualified: (wp.rivalry.count || 0) >= RIVALRY.qualifyMissions };
    });
    if (!out) {
      tally.skipped++;
      continue;
    }
    tally.changed++;
    if (out.next > 0) tally.stillActive++;
    else active.delete(uid);
    if (out.next < RIVALRY.qualifyMissions) {
      if (out.wasQualified) tally.lostQualified++;
      qualified.delete(uid);
    }
    if (CONFIRM) {
      const clear = {};
      if (out.next <= 0) clear[`crews.${CREW}.active.${uid}`] = del();
      if (out.next < RIVALRY.qualifyMissions) clear[`crews.${CREW}.qualified.${uid}`] = del();
      if (Object.keys(clear).length) await boardRef.update(clear);
    }
  }
  console.log(`Players changed: ${tally.changed}, skipped: ${tally.skipped}`);
  console.log(`Kept a real mission: ${tally.stillActive}, dropped below 5: ${tally.lostQualified}`);
  console.log(`Board after: ${qualified.size} qualified of ${active.size} active`);
  if (!CONFIRM) console.log('Dry run. Nothing changed. Re-run with --confirm to apply.');
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
