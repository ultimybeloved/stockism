'use strict';

// READ-ONLY. Were halt-window trades unusually profitable?
//
//   node scripts/halt-window-profit.cjs
//
// The halt was not enforced before 2026-04-16, so anyone who tried could trade
// through a chapter review. Access being open to all means the door was not an
// exploit. But someone who had READ THE RAWS knew what the review was about to
// do to prices, and that advantage was not open to all.
//
// So this measures outcome rather than access. For every trade made inside a
// halt window, it compares the price paid to the price a week later, and scores
// the direction: a buy that rose, or a sell that fell, went the right way.
//
// A player guessing gets roughly half right. A player who already knew what the
// chapter said does not.
//
// Prices are reconstructed from every player's trade records, so this needs no
// price history and works back to the beginning.
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
const LOOKAHEAD_MS = 7 * 86400000;
const MIN_TRADES = 3;

const m = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const toMs = (t) => (!t ? 0 : typeof t === 'number' ? t : t._seconds ? t._seconds * 1000 : t.seconds ? t.seconds * 1000 : 0);
const inHalt = (ms) => {
  const d = new Date(ms);
  if (d.getUTCDay() !== HALT_DAY) return false;
  const mins = d.getUTCHours() * 60 + d.getUTCMinutes();
  return mins >= HALT_START_MIN && mins < HALT_END_MIN;
};

async function main() {
  const [users, all] = await Promise.all([
    db.collection('users').select('displayName', 'isBot', 'isBanned').get(),
    db.collection('trades').select('uid', 'ticker', 'action', 'amount', 'price', 'totalValue', 'timestamp', 'source', 'automated').get(),
  ]);
  const U = new Map();
  users.forEach((d) => U.set(d.id, d.data()));
  const nm = (u) => U.get(u)?.displayName || u.slice(0, 8);

  const byTicker = new Map();
  const rows = [];
  all.forEach((doc) => {
    const t = doc.data();
    const ts = toMs(t.timestamp);
    if (!ts || !t.uid || !t.ticker || !t.price) return;
    const rec = { ...t, ts };
    if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, []);
    byTicker.get(t.ticker).push(rec);
    rows.push(rec);
  });
  for (const arr of byTicker.values()) arr.sort((a, b) => a.ts - b.ts);

  const priceAt = (ticker, ms) => {
    const arr = byTicker.get(ticker) || [];
    let p = null;
    for (const t of arr) { if (t.ts > ms) break; p = t.price; }
    return p;
  };

  // Baseline: how often does ANY trade go the right way over a week? Without
  // this there is nothing to judge the halt trades against.
  let baseRight = 0; let baseTotal = 0;
  for (const t of rows) {
    const act = (t.action || '').toLowerCase();
    if (act !== 'buy' && act !== 'sell') continue;
    const after = priceAt(t.ticker, t.ts + LOOKAHEAD_MS);
    if (!after) continue;
    baseTotal++;
    const up = after > t.price;
    if ((act === 'buy' && up) || (act === 'sell' && !up)) baseRight++;
  }

  const per = new Map();
  for (const t of rows) {
    if (t.automated || t.source) continue;
    if (!inHalt(t.ts)) continue;
    if (U.get(t.uid)?.isBot) continue;
    const act = (t.action || '').toLowerCase();
    if (act !== 'buy' && act !== 'sell') continue;
    const after = priceAt(t.ticker, t.ts + LOOKAHEAD_MS);
    if (!after) continue;
    const up = after > t.price;
    const right = (act === 'buy' && up) || (act === 'sell' && !up);
    const move = (after - t.price) / t.price;
    const gain = act === 'buy' ? move * (Number(t.totalValue) || 0) : -move * (Number(t.totalValue) || 0);
    if (!per.has(t.uid)) per.set(t.uid, { n: 0, right: 0, value: 0, gain: 0, dates: new Set() });
    const b = per.get(t.uid);
    b.n++; if (right) b.right++;
    b.value += Number(t.totalValue) || 0;
    b.gain += gain;
    b.dates.add(new Date(t.ts).toISOString().slice(0, 10));
  }

  console.log(`\nBaseline: ${(baseRight / baseTotal * 100).toFixed(1)}% of all ${baseTotal.toLocaleString()} trades`);
  console.log('went the right way over the following week. That is the number to beat.\n');
  console.log('HALT-WINDOW TRADES BY ACCOUNT  (minimum ' + MIN_TRADES + ' trades)');
  console.log('  ACCOUNT                TRADES  RIGHT   HIT RATE      VALUE     IMPLIED GAIN  THURSDAYS');

  const ranked = [...per.entries()].filter(([, b]) => b.n >= MIN_TRADES)
    .sort((a, b) => b[1].gain - a[1].gain);
  for (const [uid, b] of ranked) {
    const rate = b.right / b.n;
    const flag = rate >= 0.75 && b.gain > 10000 ? '  <== well above baseline' : '';
    console.log(`  ${nm(uid).padEnd(22)} ${String(b.n).padStart(6)}  ${String(b.right).padStart(5)}  `
      + `${(rate * 100).toFixed(0).padStart(7)}%  ${m(b.value).padStart(11)}  ${m(b.gain).padStart(14)}  ${String(b.dates.size).padStart(6)}${flag}`);
  }

  const totalGain = [...per.values()].reduce((s, b) => s + b.gain, 0);
  console.log(`\n  Total implied gain across everyone: ${m(totalGain)}`);
  console.log('\n  "Implied gain" is the trade value times the price move over the next week.');
  console.log('  It is what the position was worth a week on, not realised profit — they');
  console.log('  may have sold earlier or held longer.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
