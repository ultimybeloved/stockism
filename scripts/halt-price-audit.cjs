'use strict';

// READ-ONLY. What moved prices during a chapter-review halt, and whether
// anything did so that we cannot account for.
//
//   npm run audit:halt              most recent Thursday halt
//   npm run audit:halt 2026-08-20   a specific halt day
//
// Nothing should move a price during a halt. Trades are blocked, and the bot
// trader, market maker, limit-order sweep and margin scanners all check the
// halt and skip. Everything that legitimately writes inside the window now
// carries a `source` tag, so an UNTAGGED point in here is the interesting case:
// it means something is moving prices during a halt that we have not accounted
// for.
//
// That distinction only became usable on 2026-08-21, when the daily drop and
// character seeding started tagging their points. Before that, the drop wrote
// untagged points and moved ~40 stocks straight through the 2026-08-20 review
// with nothing on screen or in the data saying so.
//
// Writes nothing.

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

const HALT_START_MIN = 780;  // 13:00 UTC
const HALT_END_MIN = 1260;   // 21:00 UTC

// When the tagging went in. Untagged points inside a halt before this are
// expected (they are almost certainly daily drops) and are reported as such.
const TAGGING_LANDED = Date.UTC(2026, 7, 21, 0, 5);

const utc = (ms) => new Date(ms).toISOString().replace('T', ' ').slice(0, 19);
const hhmmss = (ms) => new Date(ms).toISOString().slice(11, 19);
const toMs = (t) => (!t ? 0
  : typeof t === 'number' ? t
    : t._seconds ? t._seconds * 1000
      : t.seconds ? t.seconds * 1000 : 0);

function haltWindow(arg) {
  let d;
  if (arg) {
    d = new Date(`${arg}T00:00:00Z`);
    if (isNaN(d.getTime())) {
      console.error(`Not a date: ${arg}. Use YYYY-MM-DD.`);
      process.exit(1);
    }
    if (d.getUTCDay() !== 4) console.warn(`Warning: ${arg} is not a Thursday.\n`);
  } else {
    const now = new Date();
    const day = now.getUTCDay();
    const mins = now.getUTCHours() * 60 + now.getUTCMinutes();
    d = new Date(now);
    if (!(day === 4 && mins >= HALT_START_MIN)) {
      d.setUTCDate(d.getUTCDate() - ((day - 4 + 7) % 7 || 7));
    }
  }
  const dayStart = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  return { start: dayStart + HALT_START_MIN * 60000, end: dayStart + HALT_END_MIN * 60000 };
}

async function main() {
  const { start, end } = haltWindow(process.argv[2]);
  console.log(`\nHALT WINDOW  ${utc(start)} -> ${utc(end)} UTC\n`);

  // The collapse folds the review's own points away, so stitch the stash back
  // in or an already-tidied week looks emptier than it was.
  const live = (await db.collection('market').doc('priceHistory').get()).data() || {};
  const stashDoc = (await db.collection('market').doc('reviewDetail').get()).data();
  const history = { ...live };
  if (stashDoc && stashDoc.windowEnd === end) {
    for (const [ticker, points] of Object.entries(stashDoc.detail || {})) {
      history[ticker] = [...(history[ticker] || []).filter((p) => !p?.collapsed), ...points];
    }
    console.log('(review detail stitched back in from market/reviewDetail)\n');
  }

  const inWindow = [];
  for (const [ticker, points] of Object.entries(history)) {
    if (!Array.isArray(points)) continue;
    for (const p of points) {
      if (p && p.timestamp >= start && p.timestamp <= end) inWindow.push({ ticker, ...p });
    }
  }
  inWindow.sort((a, b) => a.timestamp - b.timestamp);

  const bySource = {};
  for (const p of inWindow) {
    const key = p.source === undefined ? 'UNTAGGED' : p.source;
    (bySource[key] = bySource[key] || []).push(p);
  }

  console.log(`${inWindow.length} price points written inside the halt:\n`);
  for (const [source, points] of Object.entries(bySource).sort((a, b) => b[1].length - a[1].length)) {
    const tickers = new Set(points.map((p) => p.ticker));
    console.log(`  ${String(points.length).padStart(4)}  ${source.padEnd(20)} ${tickers.size} ticker(s)`);
  }

  const untagged = bySource.UNTAGGED || [];
  if (untagged.length === 0) {
    console.log('\nVERDICT: nothing untagged. Every price move in the halt is accounted for.');
    return;
  }

  // Untagged points arrive in batches sharing one timestamp — one daily-drop
  // roll pays out several stocks at once. Group them and try to match a claim.
  const batches = new Map();
  for (const p of untagged) {
    (batches.get(p.timestamp) || batches.set(p.timestamp, []).get(p.timestamp)).push(p);
  }

  const notes = await db.collectionGroup('notifications').get();
  const claims = [];
  notes.forEach((doc) => {
    const n = doc.data();
    const ms = toMs(n.timestamp || n.createdAt);
    if (ms >= start - 120000 && ms <= end + 120000 && /Daily Stock/i.test(n.title || '')) {
      claims.push({ ms, message: n.message });
    }
  });

  console.log(`\n${untagged.length} UNTAGGED points in ${batches.size} batch(es):\n`);
  let unexplained = 0;
  for (const ts of [...batches.keys()].sort((a, b) => a - b)) {
    const batch = batches.get(ts);
    const claim = claims.find((c) => Math.abs(c.ms - ts) <= 15000);
    console.log(`  ${hhmmss(ts)}  ${String(batch.length).padStart(2)} ticker(s): ${batch.map((p) => p.ticker).join(', ')}`);
    if (claim) {
      console.log(`      matches a daily-drop claim at ${hhmmss(claim.ms)} - ${claim.message}`);
    } else {
      unexplained += 1;
      console.log('      NO matching claim');
    }
  }

  const preTagging = start < TAGGING_LANDED;
  console.log('');
  if (preTagging) {
    console.log('VERDICT: this halt predates source tagging (2026-08-21), so untagged points');
    console.log('here are expected and are almost certainly daily-drop claims. Not a signal.');
  } else if (unexplained > 0) {
    console.log(`VERDICT: ${unexplained} batch(es) with NO explanation. Something is moving`);
    console.log('prices during a halt that we have not accounted for. Worth chasing: find what');
    console.log('writes price history without a source tag and without checking the halt.');
  } else {
    console.log('VERDICT: every untagged batch matches a daily-drop claim. If the drop halt');
    console.log('gate is deployed, these should not exist at all - check that it is live.');
  }
}

main().then(() => process.exit(0)).catch((err) => { console.error(err); process.exit(1); });
