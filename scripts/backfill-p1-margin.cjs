// One-time: preseason P1 was pinned before margin was averaged over the season.
// Players who already owed margin get a tally saying they owed their current
// debt since they were pinned. Skips anyone whose debt has changed since the
// deploy (they already have a tally). Safe to re-run: it never overwrites one.
const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '../service-account-key.json'))) });
const db = admin.firestore();

(async () => {
  const season = (await db.collection('market').doc('season').get()).data();
  if (season?.status !== 'active' || season.id !== 'P1') throw new Error(`Expected active P1, found ${season?.id}`);
  const snap = await db.collection('users').select('marginUsed', 'seasonBaseline', 'seasonMargin').get();
  let written = 0; let skipped = 0; let total = 0;
  for (const d of snap.docs) {
    const u = d.data();
    if (!(u.marginUsed > 0) || u.seasonBaseline?.seasonId !== 'P1') continue;
    const done = await db.runTransaction(async (tx) => {
      const fresh = (await tx.get(d.ref)).data();
      if (fresh.seasonMargin?.seasonId === 'P1') return false;
      const amount = Math.round(fresh.marginUsed * 100) / 100;
      tx.update(d.ref, { seasonMargin: { seasonId: 'P1', dd: 0, amount, at: fresh.seasonBaseline.pinnedAt } });
      total += amount;
      return true;
    });
    if (done) written++; else skipped++;
  }
  console.log(`Written ${written}, already had a tally ${skipped}, debt covered $${total.toFixed(2)}`);
})().catch((e) => { console.error(e); process.exit(1); });
