'use strict';

// READ-ONLY roster of accounts that share a physical connection, built for
// eyeballing against what you already know about your players.
//
//   node scripts/household-roster.cjs [days]      (default 180)
//
// For every pair it answers the one question the data CAN settle: were these two
// accounts ever live at the same instant?
//
//   * Yes  -> two sets of hands. Roommates, siblings, a couple, friends on one
//             wifi. Not one person, unless they run two browsers.
//   * No   -> could be one person alternating between logins.
//
// Every account is listed with its Discord ID and the date that Discord account
// was created, because Discord IDs encode their own creation time. A Discord
// made the same week as the game account was made to get past the wall, and is
// worth nothing as proof of a separate human.
//
// VPN exits are excluded. Cloudflare WARP hands out a different address per
// signup, so matching two accounts on one is meaningless.
//
// Writes nothing.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const { ALT_IPV6_PREFIX_GROUPS, ALT_CROWDED_NETWORK_LIMIT } = require('../functions/constants');

const CONCURRENT_MS = 10 * 1000;
const DISCORD_EPOCH = 1420070400000n;

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');
const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const discordMade = (id) => { try { return Number((BigInt(id) >> 22n) + DISCORD_EPOCH); } catch { return 0; } };

function networkKey(ip) {
  if (!ip || typeof ip !== 'string' || ip === 'unknown') return null;
  const a = ip.trim().toLowerCase();
  if (!a.includes(':')) return a;
  const g = a.split(':');
  if (g.length < ALT_IPV6_PREFIX_GROUPS) return a;
  return g.slice(0, ALT_IPV6_PREFIX_GROUPS).join(':') + '::/64';
}
// Cloudflare WARP and similar consumer VPNs. A shared exit proves nothing.
const isVpn = (n) => /^104\.2[0-9]\./.test(n || '') || /^2a09:bac/.test(n || '')
  || /^172\.6[4-9]\./.test(n || '') || /^162\.15[89]\./.test(n || '');

async function main() {
  const days = Number(process.argv[2]) || 180;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snap = await db.collection('trades')
    .where('timestamp', '>', cutoff).select('uid', 'ip', 'timestamp').get();

  const byNetwork = new Map();
  const netsOf = new Map();
  const evOf = new Map();
  let vpnTrades = 0;

  snap.forEach((d) => {
    const t = d.data();
    const n = networkKey(t.ip);
    if (!t.uid || !n) return;
    if (isVpn(n)) { vpnTrades++; return; }
    if (!byNetwork.has(n)) byNetwork.set(n, new Set());
    byNetwork.get(n).add(t.uid);
    if (!netsOf.has(t.uid)) netsOf.set(t.uid, new Set());
    netsOf.get(t.uid).add(n);
    if (!evOf.has(t.uid)) evOf.set(t.uid, []);
    evOf.get(t.uid).push({ ts: toMs(t.timestamp), net: n });
  });

  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [, uids] of byNetwork) {
    if (uids.size < 2 || uids.size > ALT_CROWDED_NETWORK_LIMIT) continue;
    const l = [...uids];
    for (let i = 1; i < l.length; i++) union(l[0], l[i]);
  }
  const groups = new Map();
  for (const uid of netsOf.keys()) {
    if (!parent.has(uid)) continue;
    const r = find(uid);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(uid);
  }

  const uids = [...new Set([...groups.values()].flat())];
  const docs = await db.getAll(...uids.map((u) => db.collection('users').doc(u)), {
    fieldMask: ['displayName', 'isBot', 'isBanned', 'crew', 'cash', 'holdings', 'marginUsed', 'discordId', 'createdAt'],
  });
  const U = new Map();
  docs.forEach((d) => { if (d.exists && !d.data().isBot) U.set(d.id, d.data()); });

  const mkt = await db.collection('market').doc('current').get();
  const prices = (mkt.data() || {}).prices || {};
  const valueOf = (u) => {
    let v = u.cash || 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v - (u.marginUsed || 0);
  };
  const nm = (u) => U.get(u)?.displayName || u.slice(0, 10);

  function pairInfo(a, b) {
    const na = netsOf.get(a) || new Set();
    const nb = netsOf.get(b) || new Set();
    const shared = [...na].filter((n) => nb.has(n));
    const priv = shared.filter((n) => byNetwork.get(n).size === 2);
    const merged = [...(evOf.get(a) || []).map((e) => ({ ...e, w: 'a' })),
      ...(evOf.get(b) || []).map((e) => ({ ...e, w: 'b' }))]
      .filter((e) => shared.includes(e.net)).sort((x, y) => x.ts - y.ts);
    let fastest = Infinity;
    for (let i = 1; i < merged.length; i++) if (merged[i].w !== merged[i - 1].w) fastest = Math.min(fastest, merged[i].ts - merged[i - 1].ts);
    return { shared: shared.length, priv: priv.length, fastest };
  }

  const out = [];
  out.push(`Shared-connection roster — last ${days} days.`);
  out.push(`${snap.size} trades read, ${vpnTrades} discarded as VPN exits.\n`);
  out.push('WARNING — the overlap test has been checked against two known answers and');
  out.push('got both wrong. Stitch + Slayerr (confessed) reads TWO PEOPLE at 12s apart.');
  out.push('Callmebot + BigBoyRandy (confirmed one person) reads TWO PEOPLE at 7s apart.');
  out.push('Running two browser windows defeats it completely. Treat TWO PEOPLE as weak');
  out.push('evidence at best, and never as a clearance.\n');
  out.push('Read the verdicts as:');
  out.push('  TWO PEOPLE  = both were live within seconds. WEAK. Consistent with');
  out.push('                roommates or family, and equally with one person on two tabs.');
  out.push('  ONE PERSON? = they never overlapped. Consistent with one person swapping');
  out.push('                logins, but also with two people who use the PC at different times.');
  out.push('  Discord date is when the DISCORD account was made. Same week as the game');
  out.push('  signup means it was made to clear the wall and proves nothing.\n');

  const ranked = [...groups.values()].map((m) => m.filter((u) => U.has(u)))
    .filter((m) => m.length > 1)
    .sort((a, b) => b.reduce((s, u) => s + valueOf(U.get(u)), 0) - a.reduce((s, u) => s + valueOf(U.get(u)), 0));

  ranked.forEach((members, i) => {
    const worth = members.reduce((s, u) => s + valueOf(U.get(u)), 0);
    out.push('='.repeat(96));
    out.push(`HOUSE ${i + 1} — ${members.length} accounts, ${money(worth)}`);
    out.push('='.repeat(96));
    out.push('  ACCOUNT                  VALUE      CREW            JOINED      DISCORD ID            DISCORD MADE  FLAG');
    for (const u of [...members].sort((a, b) => valueOf(U.get(b)) - valueOf(U.get(a)))) {
      const d = U.get(u);
      const joined = toMs(d.createdAt);
      const made = d.discordId ? discordMade(d.discordId) : 0;
      const gap = made ? Math.round((joined - made) / 86400000) : null;
      const flag = !d.discordId ? 'NO DISCORD'
        : (gap !== null && gap < 7 && gap > -7) ? 'DISCORD MADE FOR THIS'
          : '';
      out.push(`  ${nm(u).padEnd(24)} ${money(valueOf(d)).padStart(10)}  ${(d.crew || 'no crew').padEnd(15)} `
        + `${day(joined)}  ${(d.discordId || '-').padEnd(20)}  ${(made ? day(made) : '-').padEnd(12)}  ${flag}`
        + `${d.isBanned ? ' [BANNED]' : ''}`);
    }
    out.push('');
    const sorted = [...members].sort((a, b) => valueOf(U.get(b)) - valueOf(U.get(a)));
    for (let x = 0; x < sorted.length; x++) {
      for (let y = x + 1; y < sorted.length; y++) {
        const info = pairInfo(sorted[x], sorted[y]);
        if (!info.shared) continue;
        const verdict = info.fastest === Infinity ? 'ONE PERSON? never overlapped'
          : info.fastest < CONCURRENT_MS ? `TWO PEOPLE  live ${(info.fastest / 1000).toFixed(1)}s apart`
            : info.fastest < 60000 ? `TWO PEOPLE? closest ${Math.round(info.fastest / 1000)}s`
              : `ONE PERSON? never within ${info.fastest < 3600000 ? Math.round(info.fastest / 60000) + ' min' : Math.round(info.fastest / 3600000) + ' hr'}`;
        out.push(`    ${verdict.padEnd(34)} ${nm(sorted[x])} + ${nm(sorted[y])}`
          + `   (${info.shared} connections${info.priv ? `, ${info.priv} private` : ''})`);
      }
    }
    out.push('');
  });

  const text = out.join('\n');
  console.log(text);
  fs.writeFileSync(path.join(__dirname, '..', 'household-roster.txt'), text, 'utf8');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
