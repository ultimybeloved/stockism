'use strict';
// Concurrency probe for executeTrade against the LOCAL Firebase emulator.
// Never touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run loadtest:trades
//
// WHAT THIS MEASURES
// Every trade in the game writes the same two documents inside one transaction:
//   market/current      (the whole price map)
//   market/priceHistory (the whole history map)
// so two trades on completely unrelated tickers still collide. executeTrade runs
// with maxAttempts:1, so a collision is not retried server-side; it surfaces as
// an 'aborted' error and the browser retries once, 500ms later.
//
// This fires N genuinely simultaneous trades and reports how many survive.
//
// WHAT THIS DOES NOT MEASURE
// The emulator is not production Firestore. It does not model real per-document
// write throughput, cross-region latency, or the MAX_FN_INSTANCES cap (which is
// a Cloud Functions limit, not a database one, and cannot be reproduced here).
// Treat the SHAPE of the result as the finding — whether contention scales with
// concurrency, and whether unrelated tickers collide — not the absolute numbers.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { executeTrade } = require('../functions/services/trading');

// Clean tickers with no trailingFactors and no ETF membership, so a trade moves
// exactly one price and the result isn't muddied by propagation.
const TICKERS = ['SOPH', 'CROC', 'XIAO'];
const LEVELS = [1, 2, 5, 10, 20, 40];

let ipSeed = 0;
const ctx = (uid) => ({ auth: { uid }, rawRequest: { ip: `198.51.${Math.floor(++ipSeed / 250)}.${ipSeed % 250}` } });

const seedMarket = async () => {
  const prices = {};
  TICKERS.forEach((t, i) => { prices[t] = 80 + i; });
  await db.collection('market').doc('current').set({
    prices, launchedTickers: [], marketHalted: false, haltedTickers: {},
  });
  await db.collection('market').doc('priceHistory').set({});
};

const makeUsers = async (label, n) => {
  const uids = [];
  // Chunked so a 40-user setup doesn't fight the emulator's write path and skew
  // the timing of the burst that follows.
  let batch = db.batch();
  for (let i = 0; i < n; i++) {
    const uid = `load_${label}_${i}`;
    uids.push(uid);
    batch.set(db.collection('users').doc(uid), { displayName: uid, cash: 500000 });
    if ((i + 1) % 400 === 0) { await batch.commit(); batch = db.batch(); }
  }
  await batch.commit();
  return uids;
};

const classify = (err) => {
  const msg = String((err && err.message) || err);
  if (/busy|contention|ABORTED|aborted/i.test(msg)) return 'contention';
  if (/Too many|cooldown|wait/i.test(msg)) return 'throttled';
  return 'other';
};

/**
 * Fire n trades at once and report what came back.
 * sameTicker=false spreads them across TICKERS, which still share market/current.
 */
async function burst(n, sameTicker) {
  const label = `${sameTicker ? 'same' : 'diff'}${n}`;
  await seedMarket();
  const uids = await makeUsers(label, n);

  const calls = uids.map((uid, i) => {
    const ticker = sameTicker ? TICKERS[0] : TICKERS[i % TICKERS.length];
    return executeTrade.run({ ticker, action: 'buy', amount: 1 }, ctx(uid));
  });

  const started = Date.now();
  const results = await Promise.allSettled(calls);
  const elapsed = Date.now() - started;

  const out = { n, elapsed, success: 0, contention: 0, throttled: 0, other: 0, samples: [] };
  for (const r of results) {
    if (r.status === 'fulfilled') { out.success++; continue; }
    const kind = classify(r.reason);
    out[kind]++;
    if (out.samples.length < 2 && kind === 'other') {
      out.samples.push(String((r.reason && r.reason.message) || r.reason).slice(0, 120));
    }
  }
  return out;
}

const pct = (a, b) => (b === 0 ? '  n/a' : `${String(Math.round((a / b) * 100)).padStart(3)}%`);

const printRow = (r) => {
  const line = [
    String(r.n).padStart(3),
    String(r.success).padStart(7),
    pct(r.success, r.n),
    String(r.contention).padStart(10),
    String(r.throttled).padStart(9),
    String(r.other).padStart(5),
    `${String(r.elapsed).padStart(6)}ms`,
  ].join(' │ ');
  console.log(`  ${line}`);
  r.samples.forEach((s) => console.log(`        other: ${s}`));
};

const header = () => {
  console.log('    N │ success │ rate │ contention │ throttled │ other │   time');
  console.log('  ────┼─────────┼──────┼────────────┼───────────┼───────┼─────────');
};

(async () => {
  console.log('executeTrade concurrency probe (LOCAL EMULATOR — see header comment)\n');

  console.log('Simultaneous trades on the SAME ticker');
  header();
  const same = [];
  for (const n of LEVELS) same.push(await burst(n, true));
  same.forEach(printRow);

  console.log('\nSimultaneous trades on DIFFERENT tickers');
  console.log('(these share market/current, so contention here proves the price map is the bottleneck)');
  header();
  const diff = [];
  for (const n of LEVELS) diff.push(await burst(n, false));
  diff.forEach(printRow);

  const worst = [...same, ...diff].filter((r) => r.n >= 10);
  const anyContention = [...same, ...diff].some((r) => r.contention > 0);
  const diffContention = diff.some((r) => r.contention > 0);

  console.log('\nReading of the result');
  if (!anyContention) {
    console.log('  No contention at any level tested. The emulator serialises writes far more');
    console.log('  readily than production Firestore, so this is NOT evidence that production');
    console.log('  is safe — it means this harness cannot reproduce the limit. Judge the risk');
    console.log('  from the shared-document design, and confirm against real traffic.');
  } else {
    console.log(`  Contention appears under load. Worst observed success rate at N>=10: ` +
      `${Math.min(...worst.map((r) => Math.round((r.success / r.n) * 100)))}%.`);
    if (diffContention) {
      console.log('  Unrelated tickers collide too, which confirms market/current is the');
      console.log('  bottleneck rather than any single stock.');
    }
  }

  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
