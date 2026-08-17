'use strict';

// READ-ONLY: the DIRECT links for one account, measured properly.
//
//   node scripts/link-detail.cjs Slare [days]
//
// The grouping in household-roster.cjs chains accounts together: if A shares a
// connection with B and B with C, all three land in one "house" even when A and
// C have never touched. That over-merges badly. This shows only what the named
// account is DIRECTLY linked to, and how strongly.
//
// The measure that matters is not how many connections two accounts share, it is
// what SHARE OF EACH ONE'S LIFE happened on them. An account that did 95% of its
// trading on your connections lives at your place. An account that did 5% passed
// through once. Raw counts hide that completely.
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

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const pct = (n) => (n * 100).toFixed(0) + '%';
const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');

function networkKey(ip) {
  if (!ip || typeof ip !== 'string' || ip === 'unknown') return null;
  const a = ip.trim().toLowerCase();
  if (!a.includes(':')) return a;
  const g = a.split(':');
  if (g.length < ALT_IPV6_PREFIX_GROUPS) return a;
  return g.slice(0, ALT_IPV6_PREFIX_GROUPS).join(':') + '::/64';
}
const isVpn = (n) => /^104\.2[0-9]\./.test(n || '') || /^2a09:bac/.test(n || '')
  || /^172\.6[4-9]\./.test(n || '') || /^162\.15[89]\./.test(n || '');

async function main() {
  const target = process.argv[2];
  const days = Number(process.argv[3]) || 180;
  if (!target) { console.error('Usage: node scripts/link-detail.cjs <displayName> [days]'); process.exit(1); }

  const users = await db.collection('users')
    .select('displayName', 'isBot', 'isBanned', 'crew', 'cash', 'holdings', 'marginUsed', 'discordId', 'createdAt').get();
  const U = new Map();
  let uid = null;
  users.forEach((d) => {
    U.set(d.id, d.data());
    if ((d.data().displayName || '').toLowerCase() === target.toLowerCase()) uid = d.id;
  });
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
  const snap = await db.collection('trades').where('timestamp', '>', cutoff).select('uid', 'ip').get();

  const netsOf = new Map();          // uid -> Map(net -> trades)
  const usersOn = new Map();         // net -> Set(uid)
  let vpnSkipped = 0;
  snap.forEach((d) => {
    const t = d.data();
    const n = networkKey(t.ip);
    if (!t.uid || !n) return;
    if (isVpn(n)) { vpnSkipped++; return; }
    if (!netsOf.has(t.uid)) netsOf.set(t.uid, new Map());
    netsOf.get(t.uid).set(n, (netsOf.get(t.uid).get(n) || 0) + 1);
    if (!usersOn.has(n)) usersOn.set(n, new Set());
    usersOn.get(n).add(t.uid);
  });

  const mine = netsOf.get(uid) || new Map();
  const myTotal = [...mine.values()].reduce((a, b) => a + b, 0);
  const me = U.get(uid);

  console.log(`\n${me.displayName}   ${money(valueOf(me))}   ${me.crew || 'no crew'}`);
  console.log(`joined ${day(toMs(me.createdAt))}   ${me.discordId ? 'Discord ' + me.discordId : 'NO Discord'}`);
  console.log(`${myTotal} trades across ${mine.size} connections (${vpnSkipped} VPN trades excluded site-wide)\n`);

  const rows = [];
  for (const [other, theirNets] of netsOf) {
    if (other === uid || !U.has(other) || U.get(other).isBot) continue;
    const shared = [...theirNets.keys()].filter((n) => mine.has(n));
    if (!shared.length) continue;
    const theirTotal = [...theirNets.values()].reduce((a, b) => a + b, 0);
    const theirOnShared = shared.reduce((s, n) => s + theirNets.get(n), 0);
    const myOnShared = shared.reduce((s, n) => s + mine.get(n), 0);
    const priv = shared.filter((n) => usersOn.get(n).size === 2).length;
    rows.push({
      other, name: nm(other), value: valueOf(U.get(other)),
      shared: shared.length, priv,
      theirShare: theirTotal ? theirOnShared / theirTotal : 0,
      myShare: myTotal ? myOnShared / myTotal : 0,
      theirTotal, discord: !!U.get(other).discordId,
      created: toMs(U.get(other).createdAt), banned: !!U.get(other).isBanned,
    });
  }
  rows.sort((a, b) => b.theirShare - a.theirShare || b.priv - a.priv);

  console.log('DIRECTLY LINKED ACCOUNTS');
  console.log('"lives here" = share of THEIR trades that happened on your connections');
  console.log('"you there"  = share of YOUR trades that happened on those same ones\n');
  console.log('  ACCOUNT                  VALUE       THEIR TRADES  LIVES HERE  YOU THERE  SHARED  PRIVATE  DISCORD');
  for (const r of rows) {
    console.log(`  ${r.name.padEnd(24)} ${money(r.value).padStart(11)}  ${String(r.theirTotal).padStart(12)}  `
      + `${pct(r.theirShare).padStart(10)}  ${pct(r.myShare).padStart(9)}  ${String(r.shared).padStart(6)}  `
      + `${String(r.priv).padStart(7)}  ${r.discord ? 'yes' : 'NO'}${r.banned ? '  [BANNED]' : ''}`);
  }

  const belongs = rows.filter((r) => r.theirShare >= 0.8);
  console.log('\n---');
  if (belongs.length) {
    console.log(`Accounts that did 80%+ of their trading on ${me.displayName}'s connections:`);
    for (const r of belongs) console.log(`  ${r.name}  ${money(r.value)}  (${pct(r.theirShare)} of their ${r.theirTotal} trades)`);
    console.log('\nThese effectively only exist at this location.');
  } else {
    console.log(`No account did most of its trading on ${me.displayName}'s connections.`);
    console.log('Everyone linked here also plays substantially from elsewhere, which is');
    console.log('what you would expect from separate people who sometimes share a network.');
  }
  console.log('');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
