'use strict';

// READ-ONLY: everything known about one account's links.
//
//   node scripts/who-is.cjs sadako.sasaki [days]
//
// Lists every account that ever shared a connection or co-traded with the named
// player, ranked by how much each looks like the SAME PERSON rather than a
// friend. The distinction that does the work: two accounts one person runs are
// never live at the same instant, because there is one pair of hands.
//
// Writes nothing.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const { ALT_IPV6_PREFIX_GROUPS } = require('../functions/constants');
const BUCKET_MS = 10 * 60 * 1000;
const CONCURRENT_MS = 10 * 1000;

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');
const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

function networkKey(ip) {
  if (!ip || typeof ip !== 'string' || ip === 'unknown') return null;
  const a = ip.trim().toLowerCase();
  if (!a.includes(':')) return a;
  const g = a.split(':');
  if (g.length < ALT_IPV6_PREFIX_GROUPS) return a;
  return g.slice(0, ALT_IPV6_PREFIX_GROUPS).join(':') + '::/64';
}

async function main() {
  const target = process.argv[2];
  const days = Number(process.argv[3]) || 180;
  if (!target) { console.error('Usage: node scripts/who-is.cjs <displayName|uid> [days]'); process.exit(1); }

  const users = await db.collection('users')
    .select('displayName', 'isBot', 'isBanned', 'crew', 'cash', 'holdings', 'marginUsed', 'discordId', 'createdAt').get();
  const U = new Map();
  let uid = null;
  users.forEach((d) => {
    U.set(d.id, d.data());
    if ((d.data().displayName || '').toLowerCase() === target.toLowerCase()) uid = d.id;
  });
  if (!uid && U.has(target)) uid = target;
  if (!uid) { console.error(`No account named "${target}".`); process.exit(1); }

  const mkt = await db.collection('market').doc('current').get();
  const prices = (mkt.data() || {}).prices || {};
  const valueOf = (u) => {
    let v = u.cash || 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v - (u.marginUsed || 0);
  };
  const nm = (u) => U.get(u)?.displayName || u.slice(0, 10);

  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const snap = await db.collection('trades')
    .where('timestamp', '>', cutoff).select('uid', 'ip', 'ticker', 'timestamp').get();

  const accountsByNetwork = new Map();
  const events = new Map();  // uid -> [{ts, net, ticker}]
  snap.forEach((d) => {
    const t = d.data();
    if (!t.uid) return;
    const net = networkKey(t.ip);
    const ts = toMs(t.timestamp);
    if (net) {
      if (!accountsByNetwork.has(net)) accountsByNetwork.set(net, new Set());
      accountsByNetwork.get(net).add(t.uid);
    }
    if (!events.has(t.uid)) events.set(t.uid, []);
    events.get(t.uid).push({ ts, net, ticker: t.ticker });
  });

  const mine = events.get(uid) || [];
  const myNets = new Set(mine.map((e) => e.net).filter(Boolean));
  const netCount = (u, n) => (events.get(u) || []).filter((e) => e.net === n).length;
  const myHome = [...myNets].sort((a, b) => netCount(uid, b) - netCount(uid, a))[0];

  const me = U.get(uid);
  console.log(`\n${me.displayName}  ${money(valueOf(me))}`);
  console.log(`  joined ${day(toMs(me.createdAt))}  ${me.crew || 'no crew'}  ${me.discordId ? 'Discord linked' : 'NO Discord'}`);
  console.log(`  ${mine.length} trades from ${myNets.size} connections over ${days} days`);
  console.log(`  main connection carries ${netCount(uid, myHome)} of them\n`);

  // Everyone who ever appeared on one of their connections.
  const candidates = new Map();
  for (const n of myNets) {
    for (const other of accountsByNetwork.get(n) || []) {
      if (other === uid || !U.has(other) || U.get(other).isBot) continue;
      if (!candidates.has(other)) candidates.set(other, { shared: [], exclusive: 0, onMyHome: false });
      const c = candidates.get(other);
      c.shared.push(n);
      if (accountsByNetwork.get(n).size === 2) c.exclusive++;
      if (n === myHome) c.onMyHome = true;
    }
  }

  const rows = [];
  for (const [other, c] of candidates) {
    const theirs = events.get(other) || [];

    // Fastest alternation on a connection they both used.
    const merged = [...mine.map((e) => ({ ...e, who: 'me' })), ...theirs.map((e) => ({ ...e, who: 'them' }))]
      .filter((e) => c.shared.includes(e.net)).sort((a, b) => a.ts - b.ts);
    let fastest = Infinity;
    for (let i = 1; i < merged.length; i++) {
      if (merged[i].who !== merged[i - 1].who) fastest = Math.min(fastest, merged[i].ts - merged[i - 1].ts);
    }

    // Same stock, same ten minutes.
    const slots = new Set(theirs.map((e) => `${e.ticker}|${Math.floor(e.ts / BUCKET_MS)}`));
    const coTrades = mine.filter((e) => slots.has(`${e.ticker}|${Math.floor(e.ts / BUCKET_MS)}`)).length;

    const u = U.get(other);
    // Same person, or a friend? One person cannot be live twice at once.
    let sameHands;
    if (fastest === Infinity) sameHands = 'never overlapped';
    else if (fastest < CONCURRENT_MS) sameHands = `NO — live ${(fastest / 1000).toFixed(1)}s apart, two sets of hands`;
    else if (fastest < 60000) sameHands = `unclear — closest ${Math.round(fastest / 1000)}s`;
    else sameHands = `possible — never within ${Math.round(fastest / 60000)} min`;

    rows.push({
      other, name: nm(other), value: valueOf(u), created: toMs(u.createdAt),
      discord: !!u.discordId, crew: u.crew, banned: !!u.isBanned,
      shared: c.shared.length, exclusive: c.exclusive, onMyHome: c.onMyHome,
      theirTrades: theirs.length, coTrades, fastest, sameHands,
      concurrent: fastest < CONCURRENT_MS,
    });
  }

  rows.sort((a, b) => (a.concurrent - b.concurrent)
    || b.exclusive - a.exclusive || b.shared - a.shared);

  console.log('ACCOUNTS THAT SHARED A CONNECTION\n');
  for (const r of rows) {
    console.log(`  ${r.name}  ${money(r.value)}  joined ${day(r.created)}  ${r.crew || 'no crew'}  `
      + `${r.discord ? 'Discord' : 'NO Discord'}${r.banned ? '  [BANNED]' : ''}`);
    console.log(`     connections shared ${r.shared}${r.exclusive ? `, ${r.exclusive} private to just the two of you` : ''}`
      + `${r.onMyHome ? ', including their main one' : ''}`);
    console.log(`     co-traded ${r.coTrades} times   |   same person? ${r.sameHands}`);
    console.log('');
  }

  const maybe = rows.filter((r) => !r.concurrent && (r.exclusive > 0 || r.onMyHome));
  console.log('---');
  if (!maybe.length) {
    console.log('Nothing here looks like a second account. Every candidate was live at the');
    console.log('same moment as them at least once, which one person cannot do.');
  } else {
    console.log('Candidates for a second account (never live simultaneously, private connection):');
    for (const r of maybe) console.log(`  ${r.name}  ${money(r.value)}  ${r.sameHands}`);
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
