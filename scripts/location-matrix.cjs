'use strict';

// READ-ONLY. Raw location data for a set of accounts, side by side.
//
//   node scripts/location-matrix.cjs Slare sadako.sasaki peaklady_41877 definethereal.
//
// One row per connection, one column per account, showing how many trades each
// account made from it. This is the underlying data every other script in here
// summarises, shown without interpretation so the summaries can be checked.
//
// IPv6 is collapsed to its /64 prefix, which is the household. VPN exits are
// marked rather than hidden, since a match on one means nothing.
//
// Ends with a pairwise breakdown: for each pair, how much of each one's life
// happened on connections the other also used, and the closest they were ever
// active together. Under ten seconds means two sessions were open at once —
// which has been wrong twice on known answers, so treat it as weak.
//
// Writes nothing. Also saved to location-matrix.txt (gitignored).

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const { ALT_IPV6_PREFIX_GROUPS } = require('../functions/constants');

const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '-');
const pctS = (n, d) => (d ? ((n / d) * 100).toFixed(0) + '%' : '-');

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
  const names = process.argv.slice(2);
  if (names.length < 2) { console.error('Usage: node scripts/location-matrix.cjs <name> <name> [...]'); process.exit(1); }

  const users = await db.collection('users').select('displayName', 'createdAt', 'discordId').get();
  const byName = new Map();
  const meta = new Map();
  users.forEach((d) => {
    byName.set((d.data().displayName || '').toLowerCase(), d.id);
    meta.set(d.id, d.data());
  });

  const ids = [];
  for (const n of names) {
    const id = byName.get(n.toLowerCase());
    if (!id) { console.error(`unknown account "${n}"`); process.exit(1); }
    ids.push(id);
  }

  const snap = await db.collection('trades').select('uid', 'ip', 'timestamp').get();
  const grid = new Map();          // net -> Map(uid -> count)
  const othersOn = new Map();      // net -> Set(uid) including accounts not listed
  const times = new Map();         // uid -> [{ts, net}]
  snap.forEach((d) => {
    const t = d.data();
    const n = networkKey(t.ip);
    if (!t.uid || !n) return;
    if (!othersOn.has(n)) othersOn.set(n, new Set());
    othersOn.get(n).add(t.uid);
    if (!ids.includes(t.uid)) return;
    if (!grid.has(n)) grid.set(n, new Map());
    grid.get(n).set(t.uid, (grid.get(n).get(t.uid) || 0) + 1);
    if (!times.has(t.uid)) times.set(t.uid, []);
    times.get(t.uid).push({ ts: toMs(t.timestamp), net: n });
  });

  const out = [];
  const short = names.map((n) => n.slice(0, 12));
  const totals = ids.map((id) => [...grid.values()].reduce((s, m) => s + (m.get(id) || 0), 0));

  out.push('\nACCOUNTS');
  ids.forEach((id, i) => {
    const m = meta.get(id);
    out.push(`  ${names[i].padEnd(18)} joined ${day(toMs(m.createdAt))}  ${m.discordId ? 'Discord ' + m.discordId : 'NO Discord'}  `
      + `${totals[i]} trades`);
  });

  const rows = [...grid.entries()]
    .map(([net, m]) => ({ net, counts: ids.map((id) => m.get(id) || 0), outsiders: othersOn.get(net).size - ids.filter((id) => m.get(id)).length }))
    .sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0));

  out.push(`\nCONNECTIONS — ${rows.length} in total, most active first`);
  out.push(`  ${'CONNECTION'.padEnd(34)} ${short.map((s) => s.padStart(13)).join('')}  OTHERS`);
  for (const r of rows) {
    out.push(`  ${(r.net + (isVpn(r.net) ? ' [VPN]' : '')).padEnd(34)} `
      + r.counts.map((c) => String(c || '.').padStart(13)).join('')
      + `  ${r.outsiders || ''}`);
  }
  out.push(`  ${'TOTAL'.padEnd(34)} ${totals.map((t) => String(t).padStart(13)).join('')}`);
  out.push('\n  "." = never traded there.  OTHERS = how many accounts outside this list also used it.');

  out.push('\nPAIRWISE');
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = ids[i]; const b = ids[j];
      const shared = rows.filter((r) => r.counts[i] > 0 && r.counts[j] > 0);
      if (!shared.length) { out.push(`\n  ${names[i]} + ${names[j]}: no connection in common`); continue; }
      const aOn = shared.reduce((s, r) => s + r.counts[i], 0);
      const bOn = shared.reduce((s, r) => s + r.counts[j], 0);
      const priv = shared.filter((r) => r.outsiders === 0).length;

      const merged = [...(times.get(a) || []).map((e) => ({ ...e, w: 'a' })),
        ...(times.get(b) || []).map((e) => ({ ...e, w: 'b' }))]
        .filter((e) => shared.some((r) => r.net === e.net)).sort((x, y) => x.ts - y.ts);
      let fastest = Infinity;
      for (let k = 1; k < merged.length; k++) if (merged[k].w !== merged[k - 1].w) fastest = Math.min(fastest, merged[k].ts - merged[k - 1].ts);

      out.push(`\n  ${names[i]} + ${names[j]}`);
      out.push(`    ${shared.length} connections in common, ${priv} used by nobody else`);
      out.push(`    ${names[i]}: ${aOn} of ${totals[i]} trades there (${pctS(aOn, totals[i])})`);
      out.push(`    ${names[j]}: ${bOn} of ${totals[j]} trades there (${pctS(bOn, totals[j])})`);
      out.push(`    closest they were ever active: ${fastest === Infinity ? 'never alternated'
        : fastest < 10000 ? `${(fastest / 1000).toFixed(1)}s`
          : fastest < 60000 ? `${Math.round(fastest / 1000)}s`
            : fastest < 3600000 ? `${Math.round(fastest / 60000)} min` : `${Math.round(fastest / 3600000)} hr`}`);
    }
  }
  out.push('');

  const text = out.join('\n');
  console.log(text);
  fs.writeFileSync(path.join(__dirname, '..', 'location-matrix.txt'), text, 'utf8');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
