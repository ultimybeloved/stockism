'use strict';

// One-off: writes ladderGameUsers/{uid}.netWinnings (totalWon - totalLost) on
// every ladder doc, so the net-winnings board can sort on it. Every game sets
// it from 2026-10-20 on (ladderCore).
//
// Run AFTER playLadderGame and discordInteractions are deployed: the old game
// code rewrites the whole doc and would drop the field again.
//
//   node scripts/backfill-ladder-net.cjs          (dry run, prints the top 10)
//   node scripts/backfill-ladder-net.cjs --apply  (writes)

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
  const snap = await db.collection('ladderGameUsers').get();
  const rows = snap.docs.map((d) => {
    const x = d.data();
    return { ref: d.ref, id: d.id, net: (x.totalWon || 0) - (x.totalLost || 0), had: x.netWinnings };
  });
  const changed = rows.filter((r) => r.had !== r.net);
  console.log(`${rows.length} ladder docs, ${changed.length} need netWinnings`);
  for (const r of [...rows].sort((a, b) => b.net - a.net).slice(0, 10)) console.log(`  ${r.id}  ${r.net}`);

  if (!apply) {
    console.log('Dry run. Re-run with --apply to write.');
    return;
  }
  for (let i = 0; i < changed.length; i += 400) {
    const batch = db.batch();
    // update, not set: a game committing at the same moment keeps its stats.
    for (const r of changed.slice(i, i + 400)) batch.update(r.ref, { netWinnings: r.net });
    await batch.commit();
  }
  console.log(`Wrote ${changed.length} docs.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
