'use strict';
// Isolates raw Firestore transaction contention from executeTrade's logic.
//
//   npm run loadtest:txn
//
// The full trade probe (loadtest-trades-emulator.cjs) showed near-total failure
// at every concurrency level, including N=2. Under optimistic concurrency one of
// two contenders should win, so that result needed checking against the database
// alone before anything was concluded about the trade engine.
//
// This does the minimum possible transaction — read one doc, write one field —
// at the same concurrency levels, once with maxAttempts:1 (what executeTrade
// uses) and once with the default. The gap between those two columns is what a
// server-side retry would buy.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const LEVELS = [2, 5, 10, 20, 40];
const ref = () => db.collection('loadtest').doc('counter');

async function burst(n, maxAttempts) {
  await ref().set({ count: 0 });

  const calls = Array.from({ length: n }, () =>
    db.runTransaction(async (tx) => {
      const snap = await tx.get(ref());
      tx.update(ref(), { count: (snap.data().count || 0) + 1 });
    }, { maxAttempts })
  );

  const started = Date.now();
  const results = await Promise.allSettled(calls);
  const elapsed = Date.now() - started;

  const success = results.filter((r) => r.status === 'fulfilled').length;
  const committed = (await ref().get()).data().count || 0;
  return { n, success, committed, elapsed };
}

const row = (r) => [
  String(r.n).padStart(3),
  String(r.success).padStart(7),
  `${String(Math.round((r.success / r.n) * 100)).padStart(3)}%`,
  String(r.committed).padStart(9),
  `${String(r.elapsed).padStart(6)}ms`,
].join(' │ ');

(async () => {
  console.log('Raw Firestore transaction contention, one document (LOCAL EMULATOR)\n');

  for (const maxAttempts of [1, 5]) {
    console.log(`maxAttempts: ${maxAttempts}${maxAttempts === 1 ? '   (what executeTrade uses today)' : '   (library default behaviour)'}`);
    console.log('    N │ success │ rate │ committed │   time');
    console.log('  ────┼─────────┼──────┼───────────┼─────────');
    for (const n of LEVELS) console.log(`  ${row(await burst(n, maxAttempts))}`);
    console.log('');
  }

  console.log('How to read this');
  console.log('  "committed" is the counter value afterwards, so it must equal "success".');
  console.log('  If maxAttempts:1 fails almost everything while maxAttempts:5 does not, the');
  console.log('  failures are retry policy, not a throughput ceiling. If BOTH collapse, the');
  console.log('  emulator is serialising far harder than production Firestore does and');
  console.log('  neither column predicts production.');

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
