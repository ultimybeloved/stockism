// One-time, after the side-flow split: for about a day, ladder and prediction
// flows also bumped the grantedDays clock (and backfill-p1-flows.cjs put
// prediction flows on it). The clock is grants only now, so each P1 baseline
// is re-pinned against it: every grant since pinning (money in minus ladder and
// prediction flows) is treated as arriving halfway between pinning and now,
// the same approximation the first backfill used.
//
// Run AFTER the functions deploy that stops flows touching the clock.
// Usage: node scripts/backfill-p1-grant-clock.cjs [--write]
// Without --write it only prints. Safe to re-run: marked baselines are skipped.
const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '../service-account-key.json'))) });
const db = admin.firestore();

const DAY_MS = 24 * 60 * 60 * 1000;
const write = process.argv.includes('--write');
const MARK = 'grantClock2';

(async () => {
  const season = (await db.collection('market').doc('season').get()).data();
  if (season?.status !== 'active' || season.id !== 'P1') throw new Error(`Expected active P1, found ${season?.id}`);

  const snap = await db.collection('users').select('seasonBaseline').get();
  let written = 0; let skipped = 0;
  const big = [];
  for (const d of snap.docs) {
    const b = d.data().seasonBaseline;
    if (b?.seasonId !== 'P1') continue;
    if (b[MARK]) { skipped++; continue; }
    const r = await db.runTransaction(async (tx) => {
      const u = (await tx.get(d.ref)).data();
      const base = u.seasonBaseline;
      if (base?.seasonId !== 'P1' || base[MARK]) return null;
      const now = Date.now();
      const side = ((u.ladderFlowValue || 0) - (base.ladderFlow || 0))
        + ((u.predictionFlowValue || 0) - (base.predictionFlow || 0));
      const grants = (u.grantedValue || 0) - (base.granted || 0) - side;
      const midDays = ((base.pinnedAt + now) / 2) / DAY_MS;
      if (write) {
        tx.update(d.ref, {
          'seasonBaseline.grantedDays': (u.grantedDays || 0) - Math.max(0, grants) * midDays,
          'seasonBaseline.predictionFlow': base.predictionFlow || 0,
          [`seasonBaseline.${MARK}`]: true,
        });
      }
      return { name: u.displayName, grants, side };
    });
    if (!r) { skipped++; continue; }
    written++;
    if (Math.abs(r.side) >= 1000) big.push(r);
  }
  big.sort((a, b) => Math.abs(b.side) - Math.abs(a.side));
  for (const r of big) console.log(`${String(r.name).padEnd(24)} grants $${r.grants.toFixed(0).padStart(7)}  ladder+prediction $${r.side.toFixed(0).padStart(8)}`);
  console.log(`${write ? 'Written' : 'Would write'} ${written}, skipped ${skipped}`);
})().catch((e) => { console.error(e); process.exit(1); });
