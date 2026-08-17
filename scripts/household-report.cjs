'use strict';

// READ-ONLY deep dive on accounts that share a connection.
//
//   node scripts/household-report.cjs [days]        (default 90)
//
// The nightly scanner (services/altDetection.js) answers "who should I look
// at". This answers "what am I actually looking at" — it groups the flagged
// accounts into households, then for each pair inside a household lays out the
// evidence that separates a family sharing a router from one person running two
// accounts.
//
// The distinction matters because sharing an address is not an offence. What
// makes a pair actionable is coordination: two accounts on one connection that
// keep trading the SAME stock within minutes of each other are being operated
// as one position, whoever is typing.
//
// Writes nothing. Needs service-account-key.json in the repo root.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const {
  ALT_IPV6_PREFIX_GROUPS, ALT_CROWDED_NETWORK_LIMIT,
} = require('../functions/constants');

// Two trades in the same stock inside this window are treated as one action
// split across two accounts.
const COORD_WINDOW_MS = 30 * 60 * 1000;
// A handoff this fast means two sessions were live at once.
const CONCURRENT_MS = 10 * 1000;

const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');
const toMs = (ts) => (!ts ? 0
  : typeof ts === 'number' ? ts
    : ts._seconds ? ts._seconds * 1000
      : ts.seconds ? ts.seconds * 1000
        : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);

function networkKey(ip) {
  if (!ip || typeof ip !== 'string' || ip === 'unknown') return null;
  const addr = ip.trim().toLowerCase();
  if (!addr.includes(':')) return addr;
  const g = addr.split(':');
  if (g.length < ALT_IPV6_PREFIX_GROUPS) return addr;
  return g.slice(0, ALT_IPV6_PREFIX_GROUPS).join(':') + '::/64';
}

async function main() {
  const days = Number(process.argv[2]) || 90;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snap = await db.collection('trades')
    .where('timestamp', '>', cutoff)
    .select('uid', 'ip', 'ticker', 'action', 'amount', 'totalValue', 'timestamp')
    .get();

  const trades = [];
  const accountsByNetwork = new Map();
  const networksByAccount = new Map();

  snap.forEach((d) => {
    const t = d.data();
    const net = networkKey(t.ip);
    if (!t.uid || !net) return;
    trades.push({ ...t, net, ts: toMs(t.timestamp) });
    if (!accountsByNetwork.has(net)) accountsByNetwork.set(net, new Set());
    accountsByNetwork.get(net).add(t.uid);
    if (!networksByAccount.has(t.uid)) networksByAccount.set(t.uid, new Set());
    networksByAccount.get(t.uid).add(net);
  });
  trades.sort((a, b) => a.ts - b.ts);

  // Households: union accounts that met on a network small enough to mean
  // something. Crowded networks (carriers, schools, VPN exits) are skipped or
  // everyone ends up in one useless blob.
  const parent = new Map();
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); }
    return x;
  };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  for (const [, uids] of accountsByNetwork) {
    if (uids.size < 2 || uids.size > ALT_CROWDED_NETWORK_LIMIT) continue;
    const list = [...uids];
    for (let i = 1; i < list.length; i++) union(list[0], list[i]);
  }

  const households = new Map();
  for (const uid of networksByAccount.keys()) {
    if (!parent.has(uid)) continue;
    const root = find(uid);
    if (!households.has(root)) households.set(root, []);
    households.get(root).push(uid);
  }
  const real = [...households.values()].filter((m) => m.length > 1);

  // Account detail for everyone involved.
  const uids = [...new Set(real.flat())];
  const docs = await db.getAll(...uids.map((u) => db.collection('users').doc(u)), {
    fieldMask: ['displayName', 'isBot', 'isBanned', 'crew', 'cash', 'holdings',
      'marginUsed', 'discordId', 'createdAt'],
  });
  const U = new Map();
  docs.forEach((d) => { if (d.exists) U.set(d.id, d.data()); });

  const marketSnap = await db.collection('market').doc('current').get();
  const prices = (marketSnap.data() || {}).prices || {};
  const valueOf = (u) => {
    let v = u.cash || 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v - (u.marginUsed || 0);
  };

  const tradesByUid = new Map();
  for (const t of trades) {
    if (!tradesByUid.has(t.uid)) tradesByUid.set(t.uid, []);
    tradesByUid.get(t.uid).push(t);
  }

  // Evidence for one pair.
  function assess(a, b) {
    const netsA = networksByAccount.get(a) || new Set();
    const netsB = networksByAccount.get(b) || new Set();
    const shared = [...netsA].filter((n) => netsB.has(n));
    const exclusive = shared.filter((n) => accountsByNetwork.get(n).size === 2);
    const quiet = shared.filter((n) => accountsByNetwork.get(n).size <= ALT_CROWDED_NETWORK_LIMIT);

    const ta = tradesByUid.get(a) || [];
    const tb = tradesByUid.get(b) || [];

    // Same stock, close together — the two accounts acting as one position.
    const coordinated = [];
    for (const x of ta) {
      for (const y of tb) {
        if (x.ticker !== y.ticker) continue;
        const gap = Math.abs(x.ts - y.ts);
        if (gap <= COORD_WINDOW_MS) {
          coordinated.push({ ticker: x.ticker, gap, a: x.action, b: y.action, ts: Math.min(x.ts, y.ts) });
        }
      }
    }
    const coordTickers = [...new Set(coordinated.map((c) => c.ticker))];

    // Fastest switch between the two accounts on a shared connection. Under ten
    // seconds means two sessions were open at the same moment, which points at
    // two people rather than one person swapping logins.
    let fastest = Infinity;
    const merged = [...ta.map((t) => ({ ...t, who: a })), ...tb.map((t) => ({ ...t, who: b }))]
      .filter((t) => shared.includes(t.net))
      .sort((x, y) => x.ts - y.ts);
    for (let i = 1; i < merged.length; i++) {
      if (merged[i].who !== merged[i - 1].who) fastest = Math.min(fastest, merged[i].ts - merged[i - 1].ts);
    }

    const ua = U.get(a) || {};
    const ub = U.get(b) || {};
    const hA = Object.keys(ua.holdings || {}).filter((t) => ua.holdings[t] > 0);
    const hB = new Set(Object.keys(ub.holdings || {}).filter((t) => ub.holdings[t] > 0));
    const sharedHoldings = hA.filter((t) => hB.has(t));

    // Confidence. Coordination is what lifts a pair out of "might be family".
    let verdict;
    if (coordTickers.length && exclusive.length) verdict = 'ACTING AS ONE';
    else if (coordTickers.length >= 2) verdict = 'ACTING AS ONE';
    else if (exclusive.length >= 3) verdict = 'SAME OPERATOR LIKELY';
    else if (coordinated.length) verdict = 'COORDINATED, LOW VOLUME';
    else if (quiet.length >= 3) verdict = 'SAME HOUSEHOLD';
    else verdict = 'SAME HOUSEHOLD, WEAK';

    return {
      shared: shared.length, exclusive: exclusive.length, quiet: quiet.length,
      coordinated: coordinated.length, coordTickers, sharedHoldings,
      fastest, verdict,
    };
  }

  console.log(`\nWindow: last ${days} days · ${trades.length} trades with an address · ${real.length} households\n`);

  real.sort((x, y) => y.length - x.length);

  let hn = 0;
  for (const members of real) {
    hn++;
    const named = members.filter((m) => U.has(m) && !U.get(m).isBot);
    if (named.length < 2) continue;

    console.log('='.repeat(74));
    console.log(`HOUSEHOLD ${hn} — ${named.length} accounts`);
    console.log('='.repeat(74));

    for (const uid of named.sort((a, b) => valueOf(U.get(b)) - valueOf(U.get(a)))) {
      const u = U.get(uid);
      const nets = networksByAccount.get(uid) || new Set();
      console.log(`  ${(u.displayName || uid).padEnd(24)} ${money(valueOf(u)).padStart(13)}`
        + `  joined ${day(toMs(u.createdAt))}`
        + `  ${(u.crew || 'no crew').padEnd(14)}`
        + `  ${nets.size} network(s)`
        + `  ${u.discordId ? 'discord' : 'NO discord'}`
        + `${u.isBanned ? '  [BANNED]' : ''}`);
    }

    console.log('');
    const pairs = [];
    for (let i = 0; i < named.length; i++) {
      for (let j = i + 1; j < named.length; j++) {
        const ev = assess(named[i], named[j]);
        if (!ev.shared) continue;
        pairs.push({ a: named[i], b: named[j], ...ev });
      }
    }
    const rank = { 'ACTING AS ONE': 0, 'SAME OPERATOR LIKELY': 1, 'COORDINATED, LOW VOLUME': 2, 'SAME HOUSEHOLD': 3, 'SAME HOUSEHOLD, WEAK': 4 };
    pairs.sort((x, y) => rank[x.verdict] - rank[y.verdict] || y.exclusive - x.exclusive);

    for (const p of pairs) {
      const na = U.get(p.a).displayName || p.a;
      const nb = U.get(p.b).displayName || p.b;
      console.log(`  ${p.verdict}`);
      console.log(`    ${na} + ${nb}`);
      console.log(`      networks shared ${p.shared}, of which ${p.exclusive} used by nobody else`);
      console.log(`      trades in the same stock within 30 min: ${p.coordinated}`
        + `${p.coordTickers.length ? ` (${p.coordTickers.slice(0, 6).join(', ')})` : ''}`);
      console.log(`      both currently holding: ${p.sharedHoldings.length ? p.sharedHoldings.slice(0, 6).join(', ') : 'nothing in common'}`);
      console.log(`      fastest switch between them: ${
        p.fastest === Infinity ? 'never alternated'
          : p.fastest < CONCURRENT_MS ? `${(p.fastest / 1000).toFixed(1)}s — two sessions at once, likely two people`
            : p.fastest < 60000 ? `${(p.fastest / 1000).toFixed(0)}s`
              : `${Math.round(p.fastest / 60000)} min`}`);
      console.log('');
    }
  }

  console.log('Shared connection alone is not proof. "ACTING AS ONE" means the two');
  console.log('accounts traded the same stock within half an hour of each other on a');
  console.log('connection nobody else uses — that is the pattern worth acting on.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
