'use strict';

// READ-ONLY. Week-by-week history of one account, lined up against the dates
// exploits were patched.
//
//   node scripts/account-forensics.cjs Stitch
//
// Looks for weeks where the account gained far more than its own normal, then
// shows what it was trading and whether a fix shipped around then. A spike that
// lands just before a patch is worth reading the trades of; a spike on its own
// is usually just a good week.
//
// The gain figure is net worth change from the portfolioHistory subcollection,
// which is written on every trade and every scheduled snapshot.
//
// Writes nothing.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

// Economy-relevant fixes, from the repo's own commit log. Cosmetic and UI fixes
// are left out — only things that changed what a player could extract.
const FIXES = [
  ['2026-06-05', 'Cap trade preview impact'],
  ['2026-06-06', 'Fix bankruptcy detection and bailout safety'],
  ['2026-06-10', 'Harden signup against alt rings'],
  ['2026-06-11', 'Tighten trade limits'],
  ['2026-06-17', 'Backend safety caps'],
  ['2026-06-18', 'Block account recycling exploit'],
  ['2026-06-18', 'Close economy exploits'],
  ['2026-06-21', 'Cap event market buys to invested amount'],
  ['2026-06-22', 'Fix audit issues'],
  ['2026-07-01', 'Close cap gap'],
  ['2026-07-06', 'Trading tests and fix'],
  ['2026-07-18', 'Exploit audit: 5 holes closed'],
  ['2026-07-22', 'Fix price history archiving'],
  ['2026-07-28', 'Fix margin liquidation bugs'],
  ['2026-07-29', 'Long-hold exit discount'],
  ['2026-07-29', 'Stop banned users trading'],
  ['2026-08-04', 'Fix discord link exploit'],
  ['2026-08-04', 'Tighten margin gate'],
  ['2026-08-09', 'Harden ladder against alt accounts'],
];

const m = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const toMs = (t) => (!t ? 0 : typeof t === 'number' ? t : t._seconds ? t._seconds * 1000 : t.seconds ? t.seconds * 1000 : 0);
const dayStr = (ms) => new Date(ms).toISOString().slice(0, 10);
const weekOf = (ms) => { const d = new Date(ms); d.setUTCDate(d.getUTCDate() - d.getUTCDay()); return d.toISOString().slice(0, 10); };

async function main() {
  const target = process.argv[2];
  if (!target) { console.error('Usage: node scripts/account-forensics.cjs <displayName>'); process.exit(1); }

  const users = await db.collection('users').select('displayName').get();
  let uid = null;
  users.forEach((d) => { if ((d.data().displayName || '').toLowerCase() === target.toLowerCase()) uid = d.id; });
  if (!uid) { console.error(`No account named "${target}".`); process.exit(1); }

  const [histSnap, tradeSnap, ladderSnap] = await Promise.all([
    db.collection('users').doc(uid).collection('portfolioHistory').get(),
    db.collection('trades').where('uid', '==', uid).get(),
    db.collection('ladderGameUsers').doc(uid).get(),
  ]);

  const hist = [];
  histSnap.forEach((d) => { const h = d.data(); if (h.timestamp) hist.push({ ts: toMs(h.timestamp) || h.timestamp, v: h.value || 0 }); });
  hist.sort((a, b) => a.ts - b.ts);

  const trades = [];
  tradeSnap.forEach((d) => { const t = d.data(); trades.push({ ...t, ts: toMs(t.timestamp) }); });
  trades.sort((a, b) => a.ts - b.ts);

  console.log(`\n${target}`);
  console.log(`  ${hist.length} history points, ${trades.length} trades`);
  if (hist.length) console.log(`  ${dayStr(hist[0].ts)} ${m(hist[0].v)}  ->  ${dayStr(hist[hist.length - 1].ts)} ${m(hist[hist.length - 1].v)}`);
  if (ladderSnap.exists) {
    const L = ladderSnap.data();
    console.log(`  ladder: ${L.gamesPlayed || 0} games, won ${m(L.totalWon)} lost ${m(L.totalLost)}, net ${m((L.totalWon || 0) - (L.totalLost || 0))}`);
  }

  // Weekly buckets: last value of each week, plus trade activity.
  const weeks = new Map();
  for (const h of hist) {
    const w = weekOf(h.ts);
    if (!weeks.has(w)) weeks.set(w, { end: 0, endTs: 0, trades: 0, volume: 0, tickers: new Map(), pnl: 0 });
    const b = weeks.get(w);
    if (h.ts >= b.endTs) { b.end = h.v; b.endTs = h.ts; }
  }
  for (const t of trades) {
    const w = weekOf(t.ts);
    if (!weeks.has(w)) weeks.set(w, { end: 0, endTs: 0, trades: 0, volume: 0, tickers: new Map(), pnl: 0 });
    const b = weeks.get(w);
    b.trades++;
    b.volume += Number(t.totalValue) || 0;
    b.pnl += Number(t.pnl) || 0;
    if (t.ticker) b.tickers.set(t.ticker, (b.tickers.get(t.ticker) || 0) + 1);
  }

  const ordered = [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const rows = [];
  let prev = null;
  for (const [w, b] of ordered) {
    const gain = prev === null ? b.end : b.end - prev;
    if (b.end > 0) prev = b.end;
    rows.push({ week: w, end: b.end, gain, trades: b.trades, volume: b.volume, pnl: b.pnl,
      top: [...b.tickers.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map((e) => e[0]) });
  }

  // A week is a standout if its gain is more than three times the median
  // positive week. Median rather than mean so one huge week does not hide the
  // rest behind its own size.
  const positives = rows.filter((r) => r.gain > 0).map((r) => r.gain).sort((a, b) => a - b);
  const median = positives.length ? positives[Math.floor(positives.length / 2)] : 0;
  const threshold = median * 3;

  console.log(`\n  median positive week ${m(median)} — flagging anything above ${m(threshold)}\n`);
  console.log('  WEEK        END VALUE        CHANGE   TRADES     VOLUME   TOP TICKERS');
  for (const r of rows) {
    const flag = r.gain > threshold && r.gain > 0;
    console.log(`  ${r.week}  ${m(r.end).padStart(12)}  ${m(r.gain).padStart(12)}  ${String(r.trades).padStart(6)}  `
      + `${m(r.volume).padStart(11)}   ${r.top.join(', ').padEnd(20)}${flag ? '  <== STANDOUT' : ''}`);
    // Any fix that shipped during this week.
    const wStart = new Date(r.week).getTime();
    const wEnd = wStart + 7 * 86400000;
    for (const [d, label] of FIXES) {
      const fx = new Date(d).getTime();
      if (fx >= wStart && fx < wEnd) console.log(`  ${' '.repeat(12)}   patch ${d}: ${label}`);
    }
  }

  console.log('\n  STANDOUT WEEKS');
  const standouts = rows.filter((r) => r.gain > threshold && r.gain > 0);
  if (!standouts.length) console.log('    none — growth was steady, no single week carried it');
  for (const r of standouts) {
    console.log(`    ${r.week}  gained ${m(r.gain)} on ${r.trades} trades (${m(r.volume)} volume)  ${r.top.join(', ')}`);
    const wStart = new Date(r.week).getTime();
    const near = FIXES.filter(([d]) => {
      const fx = new Date(d).getTime();
      return fx >= wStart - 7 * 86400000 && fx < wStart + 14 * 86400000;
    });
    if (near.length) for (const [d, label] of near) console.log(`        near-patch ${d}: ${label}`);
    else console.log('        no economy patch within a week either side');
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
