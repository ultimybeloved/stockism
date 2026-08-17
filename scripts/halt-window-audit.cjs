'use strict';

// READ-ONLY. Who has traded during the Thursday chapter-review halt.
//
//   node scripts/halt-window-audit.cjs
//
// The question this settles: when someone traded inside the halt window, was
// the halt simply not being enforced yet — in which case everyone could do it
// and nobody cheated — or did a handful of people get through a door that was
// shut for everybody else?
//
// So it groups every halt-window trade by the Thursday it happened on, and
// counts how many distinct accounts were trading that day. A date where the
// whole player base traded through the halt is a missing feature. A date where
// two accounts traded and nobody else did is something else.
//
// Halt is Thursday 13:00-21:00 UTC, unchanged since at least 2026-05-07.
//
// Writes nothing.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const HALT_DAY = 4;
const HALT_START_MIN = 780;
const HALT_END_MIN = 1260;

const m = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const toMs = (t) => (!t ? 0 : typeof t === 'number' ? t : t._seconds ? t._seconds * 1000 : t.seconds ? t.seconds * 1000 : 0);

function haltInfo(ms) {
  const d = new Date(ms);
  if (d.getUTCDay() !== HALT_DAY) return null;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (mins < HALT_START_MIN || mins >= HALT_END_MIN) return null;
  return { date: d.toISOString().slice(0, 10), minsIn: mins - HALT_START_MIN };
}

async function main() {
  const [users, all] = await Promise.all([
    db.collection('users').select('displayName', 'isBot').get(),
    db.collection('trades').select('uid', 'ticker', 'action', 'totalValue', 'timestamp', 'source', 'automated').get(),
  ]);
  const U = new Map();
  users.forEach((d) => U.set(d.id, d.data()));
  const nm = (u) => U.get(u)?.displayName || u.slice(0, 8);

  const byDate = new Map();
  const byUser = new Map();
  let total = 0;

  all.forEach((doc) => {
    const t = doc.data();
    const ts = toMs(t.timestamp);
    if (!ts || !t.uid) return;
    // Automated fills (auction, liquidation, dividends) are meant to run in the
    // window. Only player-initiated trades count here.
    if (t.automated || t.source) return;
    const info = haltInfo(ts);
    if (!info) return;
    if (U.get(t.uid)?.isBot) return;
    total++;
    if (!byDate.has(info.date)) byDate.set(info.date, new Map());
    const day = byDate.get(info.date);
    if (!day.has(t.uid)) day.set(t.uid, { n: 0, value: 0 });
    const e = day.get(t.uid);
    e.n++; e.value += Number(t.totalValue) || 0;
    if (!byUser.has(t.uid)) byUser.set(t.uid, { n: 0, value: 0, dates: new Set() });
    const b = byUser.get(t.uid);
    b.n++; b.value += Number(t.totalValue) || 0; b.dates.add(info.date);
  });

  console.log(`\n${total} player-initiated trades inside the Thursday halt window.\n`);
  console.log('BY DATE — how many people were trading through the halt that day');
  console.log('  DATE         ACCOUNTS  TRADES        VALUE   WHO');
  const dates = [...byDate.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [date, day] of dates) {
    const rows = [...day.entries()].sort((a, b) => b[1].value - a[1].value);
    const trades = rows.reduce((s, r) => s + r[1].n, 0);
    const value = rows.reduce((s, r) => s + r[1].value, 0);
    const who = rows.slice(0, 4).map(([u, e]) => `${nm(u)} (${e.n})`).join(', ');
    console.log(`  ${date}  ${String(rows.length).padStart(8)}  ${String(trades).padStart(6)}  ${m(value).padStart(11)}   ${who}`
      + (rows.length > 4 ? ` +${rows.length - 4} more` : ''));
  }

  console.log('\nBY ACCOUNT — who did it most');
  console.log('  ACCOUNT                TRADES      VALUE   DISTINCT THURSDAYS');
  const ranked = [...byUser.entries()].sort((a, b) => b[1].value - a[1].value);
  for (const [uid, b] of ranked.slice(0, 25)) {
    console.log(`  ${nm(uid).padEnd(22)} ${String(b.n).padStart(6)}  ${m(b.value).padStart(11)}   ${b.dates.size}`);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
