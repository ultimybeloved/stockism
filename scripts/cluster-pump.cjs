'use strict';

// READ-ONLY: what a group of linked accounts did to the market, treating them
// as one trader.
//
//   node scripts/cluster-pump.cjs Slare definethereal. sadako.sasaki ...
//
// Accepts display names or uids. For every stock the group holds or traded, it
// chains the recorded per-trade price impact of the WHOLE group to work out
// where that stock would sit if none of them had ever touched it, then splits
// the difference between what the group is holding and what everyone else is.
//
// This is the group version of scripts/alt-audit.cjs. Use it to answer "what
// did this cluster actually cost the market" before deciding what to do.
//
// Writes nothing.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const money2 = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pct = (n) => (Number(n) * 100).toFixed(1) + '%';
const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');

// buy and cover lift the price, sell and short push it down.
const UP = { buy: true, cover: true, sell: false, short: false };

async function main() {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('Usage: node scripts/cluster-pump.cjs <name-or-uid> [more...]');
    process.exit(1);
  }

  // Resolve display names to uids.
  const all = await db.collection('users').select('displayName', 'isBot').get();
  const byName = new Map();
  all.forEach((d) => byName.set((d.data().displayName || '').toLowerCase(), d.id));

  const uids = [];
  for (const a of args) {
    if (byName.has(a.toLowerCase())) uids.push(byName.get(a.toLowerCase()));
    else if (all.docs.some((d) => d.id === a)) uids.push(a);
    else console.error(`  (skipping unknown account "${a}")`);
  }
  if (!uids.length) { console.error('No accounts resolved.'); process.exit(1); }

  const [userDocs, mkt] = await Promise.all([
    db.getAll(...uids.map((u) => db.collection('users').doc(u)),
      { fieldMask: ['displayName', 'cash', 'holdings', 'costBasis', 'marginUsed', 'crew', 'grantedValue', 'isBanned'] }),
    db.collection('market').doc('current').get(),
  ]);
  const prices = (mkt.data() || {}).prices || {};
  const U = new Map();
  userDocs.forEach((d) => { if (d.exists) U.set(d.id, d.data()); });

  // Every trade these accounts ever made.
  const tradeSnaps = await Promise.all(
    uids.map((u) => db.collection('trades').where('uid', '==', u).get()));
  const trades = [];
  tradeSnaps.forEach((s, i) => s.forEach((d) => {
    trades.push({ uid: uids[i], ...d.data(), ts: toMs(d.data().timestamp) });
  }));
  trades.sort((a, b) => a.ts - b.ts);

  const nameOf = (u) => U.get(u)?.displayName || u.slice(0, 10);
  const valueOf = (u) => {
    let v = u.cash || 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v - (u.marginUsed || 0);
  };

  console.log('\n' + '='.repeat(76));
  console.log(`GROUP — ${uids.length} accounts, ${trades.length} trades`);
  console.log('='.repeat(76));
  let groupWorth = 0;
  for (const u of uids.sort((a, b) => valueOf(U.get(b)) - valueOf(U.get(a)))) {
    const d = U.get(u);
    groupWorth += valueOf(d);
    console.log(`  ${nameOf(u).padEnd(22)} ${money(valueOf(d)).padStart(11)}  ${(d.crew || 'no crew').padEnd(14)}`
      + `  margin ${money(d.marginUsed).padStart(10)}${d.isBanned ? '  [BANNED]' : ''}`);
  }
  console.log(`  ${'COMBINED'.padEnd(22)} ${money(groupWorth).padStart(11)}`);

  // Group trading per ticker.
  const byTicker = new Map();
  for (const t of trades) {
    if (!t.ticker) continue;
    if (!byTicker.has(t.ticker)) byTicker.set(t.ticker, []);
    byTicker.get(t.ticker).push(t);
  }

  // Everyone else, for float share and collateral damage.
  const holders = new Map(); // ticker -> {group, others, otherCount}
  const usersSnap = await db.collection('users').select('holdings', 'isBot', 'isBanned', 'displayName').get();
  usersSnap.forEach((d) => {
    const u = d.data();
    if (u.isBot) return;
    for (const [tk, sh] of Object.entries(u.holdings || {})) {
      if (!(sh > 0)) continue;
      if (!holders.has(tk)) holders.set(tk, { group: 0, others: 0, otherCount: 0 });
      const h = holders.get(tk);
      if (uids.includes(d.id)) h.group += sh;
      else { h.others += sh; h.otherCount++; }
    }
  });

  const rows = [];
  for (const [ticker, ts] of byTicker) {
    let multiplier = 1;
    let bought = 0; let sold = 0; let spent = 0; let received = 0;
    const actors = new Set();
    for (const t of ts) {
      const imp = Number(t.priceImpact) || 0;
      const dir = UP[(t.action || '').toLowerCase()];
      if (imp && dir !== undefined) multiplier *= dir ? 1 + imp : 1 - imp;
      const act = (t.action || '').toLowerCase();
      if (act === 'buy') { bought += Number(t.amount) || 0; spent += Number(t.totalValue) || 0; }
      if (act === 'sell') { sold += Number(t.amount) || 0; received += Number(t.totalValue) || 0; }
      actors.add(t.uid);
    }
    const live = prices[ticker] || 0;
    if (!live || multiplier <= 0) continue;
    const counterfactual = live / multiplier;
    const perShare = live - counterfactual;
    const h = holders.get(ticker) || { group: 0, others: 0, otherCount: 0 };
    rows.push({
      ticker, multiplier, live, counterfactual, perShare,
      groupShares: h.group, otherShares: h.others, otherCount: h.otherCount,
      groupPump: h.group * perShare, othersPump: h.others * perShare,
      trades: ts.length, actors: actors.size, bought, sold, spent, received,
      first: day(ts[0].ts), last: day(ts[ts.length - 1].ts),
    });
  }
  rows.sort((a, b) => Math.abs(b.groupPump) - Math.abs(a.groupPump));

  console.log('\n' + '='.repeat(76));
  console.log('WHAT THEY DID TO EACH STOCK');
  console.log('='.repeat(76));

  let totalGroupPump = 0; let totalOthersPump = 0;
  for (const r of rows.slice(0, 12)) {
    if (Math.abs(r.multiplier - 1) < 0.005 && r.groupShares === 0) continue;
    totalGroupPump += r.groupPump;
    totalOthersPump += r.othersPump;
    const floatShare = (r.groupShares + r.otherShares) > 0
      ? r.groupShares / (r.groupShares + r.otherShares) : 0;
    console.log(`\n  ${r.ticker}   ${r.trades} trades by ${r.actors} of them, ${r.first} -> ${r.last}`);
    console.log(`     bought ${r.bought.toFixed(1)} sh for ${money(r.spent)}, sold ${r.sold.toFixed(1)} sh for ${money(r.received)}`);
    console.log(`     price now                  ${money2(r.live)}`);
    console.log(`     price without the group    ${money2(r.counterfactual)}`);
    console.log(`     they moved it              ${(r.multiplier - 1) >= 0 ? '+' : ''}${pct(r.multiplier - 1)}`);
    console.log(`     they hold                  ${r.groupShares.toFixed(1)} sh  = ${pct(floatShare)} of the stock`);
    console.log(`     pump inside their own book ${money(r.groupPump)}`);
    console.log(`     pump carried by ${String(r.otherCount).padStart(3)} others   ${money(r.othersPump)}`);
  }

  console.log('\n' + '='.repeat(76));
  console.log('BOTTOM LINE');
  console.log('='.repeat(76));
  console.log(`  Group net worth                      ${money(groupWorth)}`);
  console.log(`  Of that, price they created themselves ${money(totalGroupPump)}`
    + `  (${groupWorth > 0 ? pct(totalGroupPump / groupWorth) : 'n/a'} of their wealth)`);
  console.log(`  Paper gains their pumping handed to other players ${money(totalOthersPump)}`);
  console.log('\n  Removing their shares by admin action does not move any price.');
  console.log('  Letting them sell into the market does. That is the whole risk.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
