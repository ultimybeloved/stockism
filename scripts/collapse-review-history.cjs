'use strict';

// Collapse one chapter review's price-history staircase into a single point.
//
//   node scripts/collapse-review-history.cjs           (dry run, writes nothing)
//   node scripts/collapse-review-history.cjs --apply
//
// Why: adjusting one stock drags every stock linked to it, so a review leaves a
// stock with a run of points inside the halt window — trailing, trailing, admin,
// trailing — that on the chart is indistinguishable from people trading through
// the halt. It caused a live argument on 2026-08-20. See the review split in
// functions/helpers.js for the other half of the fix.
//
// This NEVER changes a price. It removes the intermediate steps and keeps the
// last one exactly where it is, so the stock closes the review where the admin
// put it. Points that are not part of the review (real trades, the 20:56
// opening auction) are left alone.
//
// The detail is stashed at market/reviewDetail first, and to a local JSON file,
// so the admin raw-chart view can still show what actually happened.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const APPLY = process.argv.includes('--apply');
const REVIEW_SOURCES = new Set(['admin_adjust', 'trailing']);

// Most recent Thursday halt, 13:00-21:00 UTC. Mirrors getMostRecentHaltWindow.
function haltWindow() {
  const now = new Date();
  const day = now.getUTCDay();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d = new Date(now);
  if (!(day === 4 && mins >= 780)) d.setUTCDate(d.getUTCDate() - ((day - 4 + 7) % 7 || 7));
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { start: dayStart + 780 * 60 * 1000, end: dayStart + 1260 * 60 * 1000 };
}

(async () => {
  const { start, end } = haltWindow();
  console.log(`\nHalt window: ${new Date(start).toISOString()} -> ${new Date(end).toISOString()}`);
  console.log(APPLY ? 'MODE: APPLY (will write)\n' : 'MODE: dry run (writes nothing)\n');

  // Safety gate: the set/knock-on split has to already be saved server-side,
  // because collapsing destroys the detail it is derived from.
  const rcSnap = await db.collection('market').doc('reviewChanges').get();
  const rc = rcSnap.exists ? rcSnap.data() : null;
  if (!rc || rc.windowEnd !== end) {
    console.error('market/reviewChanges is missing or is for a different window.');
    console.error('Run Admin -> Market -> Rebuild Review Tab first, then re-run this.');
    process.exit(1);
  }
  const withSplit = Object.values(rc.changes || {}).filter((c) => typeof c.trailingChange === 'number').length;
  console.log(`reviewChanges: ${rc.tickerCount} tickers, ${withSplit} carry the set/knock-on split\n`);

  const histRef = db.collection('market').doc('priceHistory');
  const hist = (await histRef.get()).data() || {};

  const updates = {};
  const detail = {};
  let touched = 0;
  let removed = 0;

  for (const [ticker, points] of Object.entries(hist)) {
    if (!Array.isArray(points)) continue;
    const sorted = points.slice().sort((a, b) => a.timestamp - b.timestamp);

    const reviewPts = sorted.filter((p) =>
      p && p.timestamp >= start && p.timestamp <= end && REVIEW_SOURCES.has(p.source) && !p.collapsed);
    if (reviewPts.length < 2) continue; // already a single move, nothing to tidy

    const last = reviewPts[reviewPts.length - 1];
    // Tagged admin_adjust on purpose: isPriceProtected keys off that tag, and
    // the review's result must stay protected from bots and the market maker.
    // `collapsed` tells the review-split readers the detail is gone.
    const merged = { timestamp: last.timestamp, price: last.price, source: 'admin_adjust', collapsed: true };

    const kept = sorted.filter((p) => !reviewPts.includes(p));
    const next = [...kept, merged].sort((a, b) => a.timestamp - b.timestamp);

    // A collapse that moves the live price is a bug, not a tidy-up.
    const priceBefore = sorted[sorted.length - 1].price;
    const priceAfter = next[next.length - 1].price;
    if (priceBefore !== priceAfter) {
      console.error(`REFUSING ${ticker}: last price would change ${priceBefore} -> ${priceAfter}`);
      process.exit(1);
    }

    updates[ticker] = next;
    detail[ticker] = reviewPts;
    touched++;
    removed += reviewPts.length - 1;
    const pct = (((last.price - reviewPts[0].price) / reviewPts[0].price) * 100).toFixed(2);
    console.log(`  ${ticker.padEnd(6)} ${String(reviewPts.length).padStart(2)} points -> 1   `
      + `$${reviewPts[0].price} .. $${last.price}  (net ${pct >= 0 ? '+' : ''}${pct}% across the run)`);
  }

  console.log(`\n${touched} stocks would be tidied, ${removed} intermediate points folded away.`);
  if (!touched) { console.log('Nothing to do.'); process.exit(0); }

  if (!APPLY) { console.log('\nDry run. Re-run with --apply to write.'); process.exit(0); }

  const backup = path.join(__dirname, '..', `review-detail-${new Date(end).toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(backup, JSON.stringify({ windowStart: start, windowEnd: end, detail }, null, 2));
  console.log(`\nLocal backup written: ${backup}`);

  await db.collection('market').doc('reviewDetail').set({
    windowStart: start, windowEnd: end, savedAt: Date.now(), detail,
  });
  console.log('Stashed the detail at market/reviewDetail');

  await histRef.set(updates, { merge: true });
  console.log(`Collapsed ${touched} stocks in market/priceHistory.`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
