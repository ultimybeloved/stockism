'use strict';

// READ-ONLY. Runs the link-detail analysis across many accounts at once.
//
//   node scripts/link-report.cjs [topN] [days] [extra names...]
//   node scripts/link-report.cjs 20 180 KingSlare .unk_b Ayin
//
// Same measure as link-detail.cjs: for each account, which OTHER accounts did
// most of their trading from this account's connections. That fraction is what
// separates "this account only exists at your house" from "we crossed paths".
// Raw shared-connection counts badly overstate the second case.
//
// Only DIRECT links are shown. No chaining, because chaining merged four
// unrelated groups into one "house" last time.
//
// Writes nothing. Output also saved to link-report.txt (gitignored).

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const { ALT_IPV6_PREFIX_GROUPS } = require('../functions/constants');

// Their trading is essentially all at this location.
const BELONGS_THRESHOLD = 0.8;
// Enough trades that the fraction means something.
const MIN_TRADES_FOR_CONFIDENCE = 20;
const DISCORD_EPOCH = 1420070400000n;

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const pctS = (n) => (n * 100).toFixed(0) + '%';
const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '-');
const discordMade = (id) => { try { return Number((BigInt(id) >> 22n) + DISCORD_EPOCH); } catch { return 0; } };

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
  const topN = Number(process.argv[2]) || 20;
  const days = Number(process.argv[3]) || 180;
  const extra = process.argv.slice(4);

  const users = await db.collection('users')
    .select('displayName', 'isBot', 'isBanned', 'crew', 'cash', 'holdings', 'marginUsed', 'discordId', 'createdAt').get();
  const U = new Map();
  const byName = new Map();
  users.forEach((d) => {
    U.set(d.id, d.data());
    byName.set((d.data().displayName || '').toLowerCase(), d.id);
  });

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

  const netsOf = new Map();
  const usersOn = new Map();
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

  // Top N by value, real players only.
  const ranked = [...U.entries()]
    .filter(([, u]) => !u.isBot && !u.isBanned)
    .map(([id, u]) => ({ id, v: valueOf(u) }))
    .sort((a, b) => b.v - a.v);

  const targets = ranked.slice(0, topN).map((r) => r.id);
  for (const e of extra) {
    const id = byName.get(e.toLowerCase());
    if (!id) { console.error(`  (unknown account "${e}")`); continue; }
    if (!targets.includes(id)) targets.push(id);
  }

  const out = [];
  out.push(`Direct-link report — top ${topN} by net worth${extra.length ? ` plus ${extra.join(', ')}` : ''}.`);
  out.push(`Last ${days} days, ${snap.size} trades, ${vpnSkipped} discarded as VPN exits.\n`);
  out.push('"lives here" = share of THAT account\'s trades made from this account\'s');
  out.push('connections. High means the account effectively only exists at this location.');
  out.push('Low means they crossed paths, nothing more.\n');
  out.push('Only direct links. Nothing is chained through a third account.\n');

  const allBelongs = [];

  for (const uid of targets) {
    const me = U.get(uid);
    const mine = netsOf.get(uid) || new Map();
    const myTotal = [...mine.values()].reduce((a, b) => a + b, 0);
    const made = me.discordId ? discordMade(me.discordId) : 0;
    const joined = toMs(me.createdAt);
    const gap = made ? Math.round((joined - made) / 86400000) : null;

    out.push('='.repeat(94));
    out.push(`${me.displayName}   ${money(valueOf(me))}   ${me.crew || 'no crew'}   joined ${day(joined)}`);
    out.push(`  ${myTotal} trades across ${mine.size} connections   |   `
      + `${me.discordId ? `Discord made ${day(made)} (${gap}d before signup)` : 'NO DISCORD'}`);
    out.push('='.repeat(94));

    if (!myTotal) { out.push('  no trades in window — nothing to link\n'); continue; }

    const rows = [];
    for (const [other, theirNets] of netsOf) {
      if (other === uid || !U.has(other) || U.get(other).isBot) continue;
      const shared = [...theirNets.keys()].filter((n) => mine.has(n));
      if (!shared.length) continue;
      const theirTotal = [...theirNets.values()].reduce((a, b) => a + b, 0);
      const theirOnShared = shared.reduce((s, n) => s + theirNets.get(n), 0);
      const myOnShared = shared.reduce((s, n) => s + mine.get(n), 0);
      const ou = U.get(other);
      const oMade = ou.discordId ? discordMade(ou.discordId) : 0;
      const oJoined = toMs(ou.createdAt);
      rows.push({
        name: nm(other), value: valueOf(ou),
        theirTotal, theirShare: theirTotal ? theirOnShared / theirTotal : 0,
        myShare: myTotal ? myOnShared / myTotal : 0,
        shared: shared.length,
        priv: shared.filter((n) => usersOn.get(n).size === 2).length,
        discord: ou.discordId ? (oMade ? `${day(oMade)}` : 'yes') : 'NONE',
        freshDiscord: oMade ? Math.abs(oJoined - oMade) < 7 * 86400000 : false,
        banned: !!ou.isBanned,
      });
    }
    if (!rows.length) { out.push('  no other account has ever traded from these connections\n'); continue; }
    rows.sort((a, b) => b.theirShare - a.theirShare);

    out.push('  LINKED ACCOUNT            VALUE     THEIR TRADES  LIVES HERE  YOU THERE  SHARED  PRIV  DISCORD MADE');
    for (const r of rows) {
      out.push(`  ${r.name.padEnd(24)} ${money(r.value).padStart(10)}  ${String(r.theirTotal).padStart(12)}  `
        + `${pctS(r.theirShare).padStart(10)}  ${pctS(r.myShare).padStart(9)}  ${String(r.shared).padStart(6)}  `
        + `${String(r.priv).padStart(4)}  ${r.discord}${r.freshDiscord ? '  <- made for this' : ''}`
        + `${r.banned ? '  [BANNED]' : ''}`);
    }

    const belongs = rows.filter((r) => r.theirShare >= BELONGS_THRESHOLD);
    const solid = belongs.filter((r) => r.theirTotal >= MIN_TRADES_FOR_CONFIDENCE);
    const thin = belongs.filter((r) => r.theirTotal < MIN_TRADES_FOR_CONFIDENCE);
    if (solid.length) {
      out.push(`\n  LIKELY ${me.displayName.toUpperCase()}'S:`);
      for (const r of solid) {
        out.push(`    ${r.name}  ${money(r.value)}  — ${pctS(r.theirShare)} of their ${r.theirTotal} trades here`
          + `${r.discord === 'NONE' ? ', no Discord' : r.freshDiscord ? ', Discord made for it' : ''}`);
        allBelongs.push({ owner: me.displayName, ...r });
      }
    }
    if (thin.length) {
      out.push(`\n  too few trades to call: ${thin.map((r) => `${r.name} (${r.theirTotal})`).join(', ')}`);
    }
    if (!solid.length && !thin.length) out.push('\n  nothing looks like a second account of theirs.');
    out.push('');
  }

  out.push('='.repeat(94));
  out.push('EVERY SECOND ACCOUNT FOUND');
  out.push('='.repeat(94));
  allBelongs.sort((a, b) => b.value - a.value);
  for (const b of allBelongs) {
    out.push(`  ${b.name.padEnd(24)} ${money(b.value).padStart(10)}  ->  ${b.owner.padEnd(20)}`
      + `  ${pctS(b.theirShare)} of ${b.theirTotal} trades`);
  }
  out.push(`\n  ${allBelongs.length} accounts total.`);
  out.push('\nA high percentage means the account only ever plays from that location.');
  out.push('That is one person with two logins, OR a family member who only plays at home.');
  out.push('The data cannot tell those apart. A missing or purpose-made Discord tips it.\n');

  const text = out.join('\n');
  console.log(text);
  fs.writeFileSync(path.join(__dirname, '..', 'link-report.txt'), text, 'utf8');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
