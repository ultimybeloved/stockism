'use strict';

// READ-ONLY map of which accounts share connections, and who each secondary
// account most likely belongs to.
//
//   node scripts/connection-map.cjs [days]     (default 120)
//
// Two outputs:
//   1. Every household, its accounts, and the exact connections that link them.
//   2. Attribution: for each throwaway or secondary account, the established
//      player whose connection it appeared on.
//
// How attribution works. A throwaway usually traded from exactly one connection
// in its whole life. Somebody else has been trading from that same connection
// for months, and it is where most of their own activity happens. That person is
// the owner of the router the throwaway was created behind. It is not proof of
// authorship, but it narrows a joke account to one household reliably.
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

// An account with no Discord, few connections and little money is a throwaway
// rather than somebody's main.
const SECONDARY_MAX_NETWORKS = 3;
const SECONDARY_MAX_VALUE = 100000;

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
// Addresses are personal data; the report only needs a stable label.
const label = (net, i) => `NET-${String(i).padStart(3, '0')}${net.includes('::/64') ? ' (home)' : ''}`;

async function main() {
  const days = Number(process.argv[2]) || 120;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snap = await db.collection('trades')
    .where('timestamp', '>', cutoff).select('uid', 'ip', 'timestamp').get();

  const accountsByNetwork = new Map();      // net -> Set(uid)
  const networksByAccount = new Map();      // uid -> Set(net)
  const countByAccountNetwork = new Map();  // `${uid}|${net}` -> trades
  const firstSeen = new Map();              // uid -> earliest trade ms

  snap.forEach((d) => {
    const t = d.data();
    const net = networkKey(t.ip);
    if (!t.uid || !net) return;
    if (!accountsByNetwork.has(net)) accountsByNetwork.set(net, new Set());
    accountsByNetwork.get(net).add(t.uid);
    if (!networksByAccount.has(t.uid)) networksByAccount.set(t.uid, new Set());
    networksByAccount.get(t.uid).add(net);
    const k = `${t.uid}|${net}`;
    countByAccountNetwork.set(k, (countByAccountNetwork.get(k) || 0) + 1);
    const ms = toMs(t.timestamp);
    if (!firstSeen.has(t.uid) || ms < firstSeen.get(t.uid)) firstSeen.set(t.uid, ms);
  });

  // Households via shared, non-crowded networks.
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
  for (const [, uids] of accountsByNetwork) {
    if (uids.size < 2 || uids.size > ALT_CROWDED_NETWORK_LIMIT) continue;
    const l = [...uids];
    for (let i = 1; i < l.length; i++) union(l[0], l[i]);
  }
  const groups = new Map();
  for (const uid of networksByAccount.keys()) {
    if (!parent.has(uid)) continue;
    const r = find(uid);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(uid);
  }
  const households = [...groups.values()].filter((m) => m.length > 1);

  const uids = [...new Set(households.flat())];
  const docs = await db.getAll(...uids.map((u) => db.collection('users').doc(u)),
    { fieldMask: ['displayName', 'isBot', 'isBanned', 'crew', 'cash', 'holdings', 'marginUsed', 'discordId', 'createdAt'] });
  const U = new Map();
  docs.forEach((d) => { if (d.exists && !d.data().isBot) U.set(d.id, d.data()); });

  const mkt = await db.collection('market').doc('current').get();
  const prices = (mkt.data() || {}).prices || {};
  const valueOf = (u) => {
    let v = u.cash || 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v - (u.marginUsed || 0);
  };
  const tradesOn = (uid, net) => countByAccountNetwork.get(`${uid}|${net}`) || 0;
  const totalTrades = (uid) => [...(networksByAccount.get(uid) || [])].reduce((s, n) => s + tradesOn(uid, n), 0);
  const homeNet = (uid) => [...(networksByAccount.get(uid) || [])]
    .sort((a, b) => tradesOn(uid, b) - tradesOn(uid, a))[0] || null;
  const name = (uid) => (U.get(uid)?.displayName) || uid.slice(0, 10);

  // Stable labels for every network that links two or more accounts.
  const netLabel = new Map();
  let ln = 0;
  for (const [net, set] of [...accountsByNetwork].sort((a, b) => b[1].size - a[1].size)) {
    const inHouse = [...set].filter((u) => U.has(u));
    if (inHouse.length > 1) netLabel.set(net, label(net, ++ln));
  }

  const out = [];
  out.push(`Connection map — last ${days} days, ${snap.size} trades carrying an address\n`);

  const ranked = households
    .map((m) => m.filter((u) => U.has(u)))
    .filter((m) => m.length > 1)
    .sort((a, b) => b.length - a.length);

  out.push(`${ranked.length} households containing 2 or more accounts.\n`);

  const attributions = [];

  ranked.forEach((members, idx) => {
    const hn = idx + 1;
    out.push('='.repeat(78));
    out.push(`HOUSEHOLD ${hn}  —  ${members.length} accounts`);
    out.push('='.repeat(78));
    out.push('  ACCOUNT                  VALUE        JOINED      DISCORD  TRADES  CONNECTIONS');

    const sorted = [...members].sort((a, b) => valueOf(U.get(b)) - valueOf(U.get(a)));
    for (const uid of sorted) {
      const u = U.get(uid);
      out.push(`  ${name(uid).padEnd(24)} ${money(valueOf(u)).padStart(11)}  ${day(toMs(u.createdAt))}  `
        + `${(u.discordId ? 'yes' : 'NO ').padEnd(7)} ${String(totalTrades(uid)).padStart(6)}  `
        + `${(networksByAccount.get(uid) || new Set()).size}`
        + `${u.isBanned ? '   [BANNED]' : ''}`);
    }

    out.push('\n  HOW THEY LINK');
    const shown = new Set();
    for (const uid of sorted) {
      for (const net of networksByAccount.get(uid) || []) {
        if (shown.has(net) || !netLabel.has(net)) continue;
        const here = [...accountsByNetwork.get(net)].filter((u) => members.includes(u));
        if (here.length < 2) continue;
        shown.add(net);
        const who = here.sort((a, b) => tradesOn(b, net) - tradesOn(a, net))
          .map((u) => `${name(u)} (${tradesOn(u, net)})`).join(', ');
        const exclusive = accountsByNetwork.get(net).size === here.length;
        out.push(`    ${netLabel.get(net).padEnd(16)} ${who}${exclusive ? '   <- nobody else uses this one' : ''}`);
      }
    }

    // Attribution for the small accounts in this household.
    for (const uid of sorted) {
      const u = U.get(uid);
      const nets = [...(networksByAccount.get(uid) || [])];
      const isSecondary = !u.discordId && nets.length <= SECONDARY_MAX_NETWORKS && valueOf(u) < SECONDARY_MAX_VALUE;
      if (!isSecondary) continue;

      const score = new Map();
      for (const net of nets) {
        for (const other of accountsByNetwork.get(net) || []) {
          if (other === uid || !U.has(other)) continue;
          score.set(other, (score.get(other) || 0) + tradesOn(other, net));
        }
      }
      const cands = [...score.entries()].sort((a, b) => b[1] - a[1]);
      if (!cands.length) continue;

      const [topUid, topScore] = cands[0];
      const runner = cands[1] ? cands[1][1] : 0;
      const top = U.get(topUid);
      const onTheirHome = nets.includes(homeNet(topUid));
      const predates = toMs(top.createdAt) < toMs(u.createdAt);
      const decisive = topScore >= runner * 3 || cands.length === 1;

      let confidence;
      if (nets.length === 1 && decisive && predates && onTheirHome) confidence = 'STRONG';
      else if (decisive && predates) confidence = 'LIKELY';
      else confidence = 'UNCLEAR';

      attributions.push({
        household: hn, uid, name: name(uid), value: valueOf(u), created: toMs(u.createdAt),
        owner: name(topUid), ownerValue: valueOf(top), confidence,
        nets: nets.length, topScore, runner, onTheirHome, predates,
        alternatives: cands.slice(1, 3).map(([c, s]) => `${name(c)} (${s})`),
      });
    }
    out.push('');
  });

  out.push('='.repeat(78));
  out.push('ATTRIBUTION — who each secondary account most likely belongs to');
  out.push('='.repeat(78));
  out.push('Secondary = no Discord linked, 3 or fewer connections, under $100k.');
  out.push('"Owner" is whoever else trades most from the same connection.\n');

  const order = { STRONG: 0, LIKELY: 1, UNCLEAR: 2 };
  attributions.sort((a, b) => order[a.confidence] - order[b.confidence] || b.value - a.value);

  for (const a of attributions) {
    out.push(`  ${a.confidence.padEnd(8)} ${a.name.padEnd(24)} -> ${a.owner}`);
    out.push(`           ${money(a.value).padStart(10)}  created ${day(a.created)}  household ${a.household}  ${a.nets} connection(s)`);
    out.push(`           ${a.topScore} trades by ${a.owner} on the same connection`
      + `${a.onTheirHome ? ', and it is their main one' : ''}`
      + `${a.predates ? '' : '  [note: owner account is NEWER, so it may be the other way round]'}`);
    if (a.alternatives.length) out.push(`           other accounts there: ${a.alternatives.join(', ')}`);
    out.push('');
  }

  out.push('STRONG  = one connection only, it is the owner\'s main one, owner predates it.');
  out.push('LIKELY  = one candidate dominates and predates it, but the account moved around.');
  out.push('UNCLEAR = several candidates on that connection, cannot separate them.\n');
  out.push('None of this proves who typed. It proves which router the account sat behind.');

  const text = out.join('\n');
  console.log(text);
  const dest = path.join(__dirname, '..', 'connection-map.txt');
  fs.writeFileSync(dest, text, 'utf8');
  console.error(`\n[written to ${dest}]`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
