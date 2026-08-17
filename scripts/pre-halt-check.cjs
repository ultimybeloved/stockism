'use strict';

// READ-ONLY. Looks for trading on advance knowledge of a chapter.
//
//   node scripts/pre-halt-check.cjs Callmebot [more names...]
//
// The theory being tested: for a while, someone who had read the raws could
// trade in the hours before the market shut for chapter review, buying what was
// about to be revealed as strong and dumping what was about to be revealed as
// weak. The window they used has since been closed.
//
// What this measures, per account:
//   1. When they trade, by weekday and UTC hour, and how much of it lands in
//      what is NOW the halt window (Thursday 13:00-21:00 UTC).
//   2. Big position builds — single buys worth a large share of their book.
//   3. Rotations — selling a lot and buying one thing in the same session, which
//      is what conviction from advance knowledge looks like.
//   4. What the price then did, reconstructed from everyone else's trades in
//      that ticker afterwards.
//
// A buy in the last hours before a halt that then jumps on reopen is the
// signature. One instance is luck. A pattern is not.
//
// Writes nothing.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const HALT_DAY = 4;            // Thursday
const HALT_START_MIN = 780;    // 13:00 UTC
const HALT_END_MIN = 1260;     // 21:00 UTC
// A buy this large relative to their book is a conviction play, not a nibble.
const BIG_BUY_SHARE = 0.15;
const LOOKAHEAD_DAYS = 5;

const m = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const toMs = (t) => (!t ? 0 : typeof t === 'number' ? t : t._seconds ? t._seconds * 1000 : t.seconds ? t.seconds * 1000 : 0);
const stamp = (ms) => new Date(ms).toISOString().slice(0, 16).replace('T', ' ');
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const inHaltWindow = (ms) => {
  const d = new Date(ms);
  if (d.getUTCDay() !== HALT_DAY) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= HALT_START_MIN && mins < HALT_END_MIN;
};
// The run-up: Thursday before the halt begins.
const inPreHalt = (ms, hours) => {
  const d = new Date(ms);
  if (d.getUTCDay() !== HALT_DAY) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins < HALT_START_MIN && mins >= HALT_START_MIN - hours * 60;
};

async function main() {
  const names = process.argv.slice(2);
  if (!names.length) { console.error('Usage: node scripts/pre-halt-check.cjs <name> [name...]'); process.exit(1); }

  const users = await db.collection('users').select('displayName', 'isBot').get();
  const byName = new Map(); const nameOf = new Map();
  users.forEach((d) => { byName.set((d.data().displayName || '').toLowerCase(), d.id); nameOf.set(d.id, d.data().displayName); });

  const all = await db.collection('trades').select('uid', 'ticker', 'action', 'amount', 'price', 'totalValue', 'timestamp').get();
  const byTicker = new Map();
  const byUid = new Map();
  all.forEach((doc) => {
    const t = doc.data();
    const ts = toMs(t.timestamp);
    if (!t.ticker || !ts) return;
    const rec = { ...t, ts };
    if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, []);
    byTicker.get(t.ticker).push(rec);
    if (!byUid.has(t.uid)) byUid.set(t.uid, []);
    byUid.get(t.uid).push(rec);
  });
  for (const arr of byTicker.values()) arr.sort((a, b) => a.ts - b.ts);

  // Price at a moment = the last trade price on or before it, from anyone.
  const priceAt = (ticker, ms) => {
    const arr = byTicker.get(ticker) || [];
    let p = null;
    for (const t of arr) { if (t.ts > ms) break; if (t.price) p = t.price; }
    return p;
  };

  for (const name of names) {
    const uid = byName.get(name.toLowerCase());
    if (!uid) { console.log(`\n${name}: unknown account`); continue; }
    const trades = (byUid.get(uid) || []).sort((a, b) => a.ts - b.ts);
    if (!trades.length) { console.log(`\n${name}: no trades`); continue; }

    console.log('\n' + '='.repeat(80));
    console.log(`${name} — ${trades.length} trades`);
    console.log('='.repeat(80));

    // When do they trade?
    const byDay = new Array(7).fill(0);
    const preHalt2 = []; const preHalt6 = []; const insideHalt = [];
    for (const t of trades) {
      byDay[new Date(t.ts).getUTCDay()]++;
      if (inHaltWindow(t.ts)) insideHalt.push(t);
      else if (inPreHalt(t.ts, 2)) preHalt2.push(t);
      else if (inPreHalt(t.ts, 6)) preHalt6.push(t);
    }
    console.log('  trades by weekday (UTC):  ' + byDay.map((c, i) => `${DAYS[i]} ${c}`).join('  '));
    console.log(`  inside what is NOW the halt window: ${insideHalt.length}`);
    console.log(`  Thursday within 2h before the halt: ${preHalt2.length}`);
    console.log(`  Thursday 2-6h before the halt:      ${preHalt6.length}`);

    if (insideHalt.length) {
      console.log('\n  TRADES INSIDE THE CURRENT HALT WINDOW (not possible today):');
      for (const t of insideHalt.slice(-15)) {
        console.log(`    ${stamp(t.ts)} UTC  ${String(t.action).padEnd(5)} ${String(t.ticker).padEnd(6)} `
          + `${String(t.amount).padStart(9)} sh  ${m(t.totalValue).padStart(12)}  @ ${m(t.price)}`);
      }
    }

    // Big conviction buys, and what happened next.
    let book = 0;
    const events = [];
    for (const t of trades) {
      const v = Number(t.totalValue) || 0;
      const act = (t.action || '').toLowerCase();
      if (act === 'buy') {
        if (book > 0 && v / book >= BIG_BUY_SHARE) events.push({ ...t, share: v / book });
        book += v;
      } else if (act === 'sell') book = Math.max(0, book - v);
    }

    if (events.length) {
      console.log('\n  BIG POSITION BUILDS  (>=15% of book in one buy)');
      console.log('  WHEN (UTC)          DAY  TICKER   VALUE        PRICE AT BUY   +5 DAYS      MOVE   TIMING');
      for (const e of events.slice(-25)) {
        const after = priceAt(e.ticker, e.ts + LOOKAHEAD_DAYS * 86400000);
        const move = (after && e.price) ? ((after - e.price) / e.price) * 100 : null;
        const d = new Date(e.ts);
        const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
        let timing = '';
        if (inHaltWindow(e.ts)) timing = 'INSIDE HALT WINDOW';
        else if (d.getUTCDay() === HALT_DAY && mins < HALT_START_MIN) {
          timing = `${((HALT_START_MIN - mins) / 60).toFixed(1)}h before halt`;
        }
        console.log(`  ${stamp(e.ts)}  ${DAYS[d.getUTCDay()]}  ${String(e.ticker).padEnd(6)} `
          + `${m(e.totalValue).padStart(11)}  ${m(e.price).padStart(12)}  ${(after ? m(after) : '-').padStart(11)}  `
          + `${(move === null ? '-' : (move >= 0 ? '+' : '') + move.toFixed(1) + '%').padStart(7)}   ${timing}`);
      }
    }

    // Rotations: sold a lot then bought one thing, same day.
    const dayMap = new Map();
    for (const t of trades) {
      const k = new Date(t.ts).toISOString().slice(0, 10);
      if (!dayMap.has(k)) dayMap.set(k, { sold: 0, bought: 0, buys: new Map(), ts: t.ts });
      const b = dayMap.get(k);
      const v = Number(t.totalValue) || 0;
      const act = (t.action || '').toLowerCase();
      if (act === 'sell') b.sold += v;
      if (act === 'buy') { b.bought += v; b.buys.set(t.ticker, (b.buys.get(t.ticker) || 0) + v); }
    }
    const rotations = [...dayMap.entries()]
      .filter(([, b]) => b.sold > 50000 && b.bought > 50000 && b.buys.size <= 2)
      .sort((a, b) => b[1].bought - a[1].bought);
    if (rotations.length) {
      console.log('\n  ROTATIONS  (sold heavily and concentrated into one or two names the same day)');
      for (const [d, b] of rotations.slice(0, 12)) {
        const wd = DAYS[new Date(b.ts).getUTCDay()];
        const into = [...b.buys.entries()].sort((x, y) => y[1] - x[1]).map(([t, v]) => `${t} ${m(v)}`).join(', ');
        console.log(`    ${d} (${wd})  sold ${m(b.sold).padStart(11)}  ->  ${into}`);
      }
    }
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
