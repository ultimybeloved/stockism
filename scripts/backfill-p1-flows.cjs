// One-time: preseason P1 was pinned before two season fixes.
//
// 1. Prediction bets and payouts now book as flows (predictionFlowUpdate), so
//    they are neither a loss nor a gain. Those made between pinning and the
//    deploy are booked here: pool bets by placedAt, payouts by the time of their
//    "Prediction Payout" notification. Long-term market trades keep no history,
//    so they can't be replayed.
// 2. Money in now counts toward capital only for the time held (grantedDays).
//    The baseline gets a grantedDays reading; everything that came in before
//    this runs is treated as arriving halfway between pinning and now.
//
// Usage: node scripts/backfill-p1-flows.cjs --cutoff=<deploy ms> [--write]
// Without --write it only prints. Safe to re-run: a baseline that already has
// grantedDays is skipped.
const path = require('path');
const admin = require(path.resolve(__dirname, '../functions/node_modules/firebase-admin'));
admin.initializeApp({ credential: admin.credential.cert(require(path.resolve(__dirname, '../service-account-key.json'))) });
const db = admin.firestore();
const { FieldValue } = admin.firestore;

const DAY_MS = 24 * 60 * 60 * 1000;
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const cutoff = Number(arg('cutoff'));
const write = process.argv.includes('--write');
const round2 = (n) => Math.round(n * 100) / 100;

(async () => {
  if (!(cutoff > 0)) throw new Error('Pass --cutoff=<ms> (when the prediction flow functions were deployed)');
  const season = (await db.collection('market').doc('season').get()).data();
  if (season?.status !== 'active' || season.id !== 'P1') throw new Error(`Expected active P1, found ${season?.id}`);

  const snap = await db.collection('users').select('seasonBaseline', 'displayName').get();
  let written = 0; let skipped = 0;
  const report = [];
  for (const d of snap.docs) {
    const b = d.data().seasonBaseline;
    if (b?.seasonId !== 'P1') continue;
    if (b.grantedDays !== undefined) { skipped++; continue; }

    const notes = await d.ref.collection('notifications').where('title', '==', 'Prediction Payout').get();
    const paidAt = {};
    notes.forEach((n) => { const x = n.data(); if (x.data?.predictionId) paidAt[x.data.predictionId] = x.createdAt?.toMillis?.(); });

    const result = await db.runTransaction(async (tx) => {
      const u = (await tx.get(d.ref)).data();
      const base = u.seasonBaseline;
      if (base?.seasonId !== 'P1' || base.grantedDays !== undefined) return null;
      const now = Date.now();

      // Prediction flows between pinning and the deploy, with when they happened.
      const flows = [];
      for (const [id, bet] of Object.entries(u.bets || {})) {
        if (bet.placedAt >= base.pinnedAt && bet.placedAt < cutoff && bet.amount > 0) flows.push({ amount: -bet.amount, t: bet.placedAt });
        const t = paidAt[id];
        if (bet.paid && bet.payout > 0 && t >= base.pinnedAt && t < cutoff) flows.push({ amount: round2(bet.payout), t });
      }
      const predTotal = round2(flows.reduce((s, f) => s + f.amount, 0));
      const predDays = flows.reduce((s, f) => s + f.amount * (f.t / DAY_MS), 0);

      // Everything else that came in since pinning, timed at the midpoint.
      const counter = u.grantedDays || 0;
      const otherSince = (u.grantedValue || 0) - (base.granted || 0);
      const midDays = ((base.pinnedAt + now) / 2) / DAY_MS;
      const baselineDays = counter - otherSince * midDays;

      const update = { 'seasonBaseline.grantedDays': baselineDays };
      if (flows.length) {
        update.grantedValue = FieldValue.increment(predTotal);
        update.predictionFlowValue = FieldValue.increment(predTotal);
        update.grantedDays = FieldValue.increment(predDays);
      }
      if (write) tx.update(d.ref, update);
      return { name: u.displayName, baseline: base.value, predTotal, flows: flows.length, otherSince: round2(otherSince) };
    });
    if (!result) { skipped++; continue; }
    written++;
    if (result.flows) report.push(result);
  }
  report.sort((a, b) => Math.abs(b.predTotal) - Math.abs(a.predTotal));
  for (const r of report) console.log(`${r.name.padEnd(24)} base $${r.baseline.toFixed(0).padStart(9)}  prediction flows ${r.predTotal >= 0 ? '+' : ''}$${r.predTotal.toFixed(2)} (${r.flows})`);
  console.log(`${write ? 'Written' : 'Would write'} ${written}, skipped ${skipped}, with prediction flows ${report.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
