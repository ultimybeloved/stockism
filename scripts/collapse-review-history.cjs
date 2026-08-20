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

// Where the single collapsed point is stamped: 20:54 UTC, the same instant for
// every stock, so the whole review reads as ONE event rather than as bursts of
// activity at whatever times the adjustments happened to be made.
//
// It has to sit before 20:55 (pre-market lock) and 20:56 (the opening auction),
// or the review would appear to land AFTER the fills that were priced off it.
const STAMP_MINUTE = 20 * 60 + 54;

// Most recent Thursday halt, 13:00-21:00 UTC. Mirrors getMostRecentHaltWindow.
function haltWindow() {
  const now = new Date();
  const day = now.getUTCDay();
  const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
  const d = new Date(now);
  if (!(day === 4 && mins >= 780)) d.setUTCDate(d.getUTCDate() - ((day - 4 + 7) % 7 || 7));
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return {
    start: dayStart + 780 * 60 * 1000,
    end: dayStart + 1260 * 60 * 1000,
    stamp: dayStart + STAMP_MINUTE * 60 * 1000,
  };
}

(async () => {
  const { start, end, stamp } = haltWindow();
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

  // Work out the rewrite for one snapshot of the history doc.
  const plan = (hist) => {
    const updates = {};
    const detail = {};
    const lines = [];
    let removed = 0;

    for (const [ticker, points] of Object.entries(hist)) {
      if (!Array.isArray(points)) continue;
      const sorted = points.slice().sort((a, b) => a.timestamp - b.timestamp);

      const reviewPts = sorted.filter((p) =>
        p && p.timestamp >= start && p.timestamp <= end && REVIEW_SOURCES.has(p.source) && !p.collapsed);
      if (reviewPts.length < 2) continue; // already a single move, nothing to tidy

      const last = reviewPts[reviewPts.length - 1];
      const kept = sorted.filter((p) => !reviewPts.includes(p));

      // Never let the collapsed point jump ahead of a real trade that was
      // already inside the window. Nothing trades during a halt, so in practice
      // this only guards the odd adjustment made after the 20:56 auction.
      const firstTradeInWindow = kept.find((p) => p.timestamp >= start && p.timestamp <= end);
      const at = firstTradeInWindow
        ? Math.min(stamp, firstTradeInWindow.timestamp - 1)
        : stamp;

      // Tagged admin_adjust on purpose: isPriceProtected keys off that tag, and
      // the review's result must stay protected from bots and the market maker.
      // `collapsed` tells the review-split readers the detail is gone.
      const merged = { timestamp: at, price: last.price, source: 'admin_adjust', collapsed: true };

      const next = [...kept, merged].sort((a, b) => a.timestamp - b.timestamp);

      // A collapse that moves the live price is a bug, not a tidy-up.
      const priceBefore = sorted[sorted.length - 1].price;
      const priceAfter = next[next.length - 1].price;
      if (priceBefore !== priceAfter) {
        throw new Error(`REFUSING ${ticker}: last price would change ${priceBefore} -> ${priceAfter}`);
      }

      updates[ticker] = next;
      detail[ticker] = reviewPts;
      removed += reviewPts.length - 1;
      const pct = (((last.price - reviewPts[0].price) / reviewPts[0].price) * 100).toFixed(2);
      lines.push(`  ${ticker.padEnd(6)} ${String(reviewPts.length).padStart(2)} points -> 1   `
        + `$${reviewPts[0].price} .. $${last.price}  (net ${pct >= 0 ? '+' : ''}${pct}% across the run)`);
    }

    return { updates, detail, lines, removed };
  };

  if (!APPLY) {
    const { lines, removed } = plan((await histRef.get()).data() || {});
    lines.forEach((l) => console.log(l));
    console.log('');
    console.log(`${lines.length} stocks would be tidied, ${removed} intermediate points folded away.`);
    console.log(lines.length ? 'Dry run. Re-run with --apply to write.' : 'Nothing to do.');
    process.exit(0);
  }

  // The doc this rewrites is the same one every trade appends to, via arrayUnion
  // inside a transaction. Reading it, rewriting arrays and writing back outside
  // a transaction would silently drop any point a trade added in between, so the
  // whole read-modify-write goes in one. Contention makes Firestore retry rather
  // than lose the trade's point, which is why this is safe to run mid-session
  // instead of halting the market for it.
  let result;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(histRef);
    result = plan(snap.data() || {});
    if (Object.keys(result.updates).length === 0) return;

    tx.set(db.collection('market').doc('reviewDetail'), {
      windowStart: start, windowEnd: end, savedAt: Date.now(), detail: result.detail,
    });
    tx.set(histRef, result.updates, { merge: true });
  });

  result.lines.forEach((l) => console.log(l));
  if (result.lines.length === 0) { console.log('Nothing to do.'); process.exit(0); }

  const backup = path.join(__dirname, '..', `review-detail-${new Date(end).toISOString().slice(0, 10)}.json`);
  fs.writeFileSync(backup, JSON.stringify({ windowStart: start, windowEnd: end, detail: result.detail }, null, 2));

  console.log('');
  console.log(`${result.lines.length} stocks tidied, ${result.removed} intermediate points folded away.`);
  console.log('Detail stashed at market/reviewDetail');
  console.log(`Local backup: ${backup}`);
})().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
