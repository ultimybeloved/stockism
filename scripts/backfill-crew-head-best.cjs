'use strict';

// One-off: gives today's crew heads their crew-head record (users.crewHeadBest)
// from the reign they're on now, so the trophy case has it even if they lose
// the crown at the next rankings. From 2026-10-22 the weekly crew rankings keep
// the record themselves. Past heads with no record show 1 week (the Crowned
// achievement), which needs no write.
//
//   node scripts/backfill-crew-head-best.cjs          (dry run)
//   node scripts/backfill-crew-head-best.cjs --apply  (writes)

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

async function main() {
  const apply = process.argv.includes('--apply');
  const snap = await db.collection('users').where('isCrewHead', '==', true).get();
  const rows = snap.docs
    .map((d) => {
      const u = d.data();
      return {
        ref: d.ref,
        name: u.displayName,
        crew: u.crew || null,
        weeks: u.crewHeadStreak || 1,
        had: u.crewHeadBest?.weeks || 0,
      };
    })
    .filter((r) => r.crew && r.weeks > r.had);
  console.log(`${snap.size} crew heads, ${rows.length} need a record`);
  for (const r of rows) console.log(`  ${r.name} (${r.crew}): ${r.weeks} weeks`);
  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }
  const batch = db.batch();
  for (const r of rows) batch.update(r.ref, { crewHeadBest: { weeks: r.weeks, crew: r.crew } });
  await batch.commit();
  console.log(`Wrote ${rows.length} records.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
