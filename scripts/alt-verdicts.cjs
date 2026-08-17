'use strict';

// READ-ONLY. The full picture: who is working together, and which of those are
// one person rather than a group of friends.
//
//   node scripts/alt-verdicts.cjs [days] [minValue]     (default 180, 40000)
//
// Finds groups two independent ways and merges them:
//
//   1. CONNECTION — accounts that traded from the same network. Catches people
//      in one house. Misses anyone coordinating from separate homes.
//
//   2. BEHAVIOUR — accounts that keep trading the same stock in the same
//      ten-minute window far more often than chance allows. Catches coordination
//      across different cities, which the connection pass cannot see.
//
//      Chance matters here. Two people who both trade a popular stock all day
//      will overlap constantly without colluding, so every pair is scored
//      against how often they SHOULD overlap given how much each of them trades
//      that specific ticker. Only the ones far above their own baseline survive.
//
// Then it separates "one person with several accounts" from "several people
// cooperating". The strongest tell is whether two accounts are ever live at the
// same instant: one human at one keyboard alternates, two humans overlap.
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

const BUCKET_MS = 10 * 60 * 1000;   // co-trading window
const MAX_UIDS_PER_BUCKET = 8;      // above this it is a market-wide move, not a pair
const MIN_SHARED_BUCKETS = 8;       // too few overlaps to mean anything
const MIN_LIFT = 3;                 // times more often than their own baseline
const CONCURRENT_MS = 10 * 1000;    // two sessions live at once

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
const pk = (a, b) => [a, b].sort().join('|');

// Names like Vasco/vascoforce or DawnBane/DuskMane are chosen by one person.
function nameKinship(a, b) {
  const norm = (s) => (s || '').toLowerCase().replace(/[^a-z]/g, '');
  const x = norm(a); const y = norm(b);
  if (!x || !y || x === y) return 0;
  if (x.includes(y) || y.includes(x)) return 1;
  let i = 0;
  while (i < Math.min(x.length, y.length) && x[i] === y[i]) i++;
  return i >= 5 ? 0.7 : i >= 4 ? 0.4 : 0;
}

async function main() {
  const days = Number(process.argv[2]) || 180;
  const minValue = Number(process.argv[3]) || 40000;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const snap = await db.collection('trades')
    .where('timestamp', '>', cutoff)
    .select('uid', 'ip', 'ticker', 'timestamp').get();

  const accountsByNetwork = new Map();
  const networksByAccount = new Map();
  const netTradeCount = new Map();
  const events = [];

  snap.forEach((d) => {
    const t = d.data();
    if (!t.uid) return;
    const ts = toMs(t.timestamp);
    const net = networkKey(t.ip);
    if (net) {
      if (!accountsByNetwork.has(net)) accountsByNetwork.set(net, new Set());
      accountsByNetwork.get(net).add(t.uid);
      if (!networksByAccount.has(t.uid)) networksByAccount.set(t.uid, new Set());
      networksByAccount.get(t.uid).add(net);
      netTradeCount.set(`${t.uid}|${net}`, (netTradeCount.get(`${t.uid}|${net}`) || 0) + 1);
    }
    if (t.ticker) events.push({ uid: t.uid, ticker: t.ticker, ts, net });
  });
  events.sort((a, b) => a.ts - b.ts);

  // ---- pass 2: behavioural co-trading, scored against chance ----
  const buckets = new Map();                 // `${ticker}|${slot}` -> Set(uid)
  const perTickerSlots = new Map();          // ticker -> Set(slot)
  const perTickerUidSlots = new Map();       // `${ticker}|${uid}` -> Set(slot)

  for (const e of events) {
    const slot = Math.floor(e.ts / BUCKET_MS);
    const bk = `${e.ticker}|${slot}`;
    if (!buckets.has(bk)) buckets.set(bk, new Set());
    buckets.get(bk).add(e.uid);
    if (!perTickerSlots.has(e.ticker)) perTickerSlots.set(e.ticker, new Set());
    perTickerSlots.get(e.ticker).add(slot);
    const uk = `${e.ticker}|${e.uid}`;
    if (!perTickerUidSlots.has(uk)) perTickerUidSlots.set(uk, new Set());
    perTickerUidSlots.get(uk).add(slot);
  }

  const observed = new Map();  // pair -> shared bucket count
  const pairTickers = new Map();
  for (const [bk, uids] of buckets) {
    if (uids.size < 2 || uids.size > MAX_UIDS_PER_BUCKET) continue;
    const ticker = bk.split('|')[0];
    const l = [...uids];
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) {
        const key = pk(l[i], l[j]);
        observed.set(key, (observed.get(key) || 0) + 1);
        if (!pairTickers.has(key)) pairTickers.set(key, new Map());
        const m = pairTickers.get(key);
        m.set(ticker, (m.get(ticker) || 0) + 1);
      }
    }
  }

  const behavioural = new Map(); // pair -> {observed, expected, lift, tickers}
  for (const [key, obs] of observed) {
    if (obs < MIN_SHARED_BUCKETS) continue;
    const [a, b] = key.split('|');
    let expected = 0;
    for (const ticker of pairTickers.get(key).keys()) {
      const total = (perTickerSlots.get(ticker) || new Set()).size;
      const sa = (perTickerUidSlots.get(`${ticker}|${a}`) || new Set()).size;
      const sb = (perTickerUidSlots.get(`${ticker}|${b}`) || new Set()).size;
      if (total > 0) expected += (sa * sb) / total;
    }
    if (expected <= 0) continue;
    const lift = obs / expected;
    if (lift < MIN_LIFT) continue;
    behavioural.set(key, {
      observed: obs, expected, lift,
      tickers: [...pairTickers.get(key).entries()].sort((x, y) => y[1] - x[1]).slice(0, 5).map((e) => e[0]),
    });
  }

  // ---- merge both passes into groups ----
  const parent = new Map();
  const find = (x) => { if (!parent.has(x)) parent.set(x, x); while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };

  const connectionPairs = new Set();
  for (const [, uids] of accountsByNetwork) {
    if (uids.size < 2 || uids.size > ALT_CROWDED_NETWORK_LIMIT) continue;
    const l = [...uids];
    for (let i = 0; i < l.length; i++) {
      for (let j = i + 1; j < l.length; j++) connectionPairs.add(pk(l[i], l[j]));
      if (i > 0) union(l[0], l[i]);
    }
  }
  for (const key of behavioural.keys()) { const [a, b] = key.split('|'); union(a, b); }

  const groups = new Map();
  for (const uid of new Set([...networksByAccount.keys(), ...events.map((e) => e.uid)])) {
    if (!parent.has(uid)) continue;
    const r = find(uid);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(uid);
  }

  const allUids = [...new Set([...groups.values()].flat())];
  const docs = await db.getAll(...allUids.map((u) => db.collection('users').doc(u)), {
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

  const byUid = new Map();
  for (const e of events) {
    if (!byUid.has(e.uid)) byUid.set(e.uid, []);
    byUid.get(e.uid).push(e);
  }

  // Fastest alternation on a shared connection. Under ten seconds, two sessions
  // were live at once.
  function fastestSwitch(a, b) {
    const shared = [...(networksByAccount.get(a) || [])].filter((n) => (networksByAccount.get(b) || new Set()).has(n));
    if (!shared.length) return Infinity;
    const merged = [...(byUid.get(a) || []).map((e) => ({ ...e, who: a })),
      ...(byUid.get(b) || []).map((e) => ({ ...e, who: b }))]
      .filter((e) => shared.includes(e.net)).sort((x, y) => x.ts - y.ts);
    let best = Infinity;
    for (let i = 1; i < merged.length; i++) {
      if (merged[i].who !== merged[i - 1].who) best = Math.min(best, merged[i].ts - merged[i - 1].ts);
    }
    return best;
  }

  // How much of this looks like ONE person rather than two cooperating.
  function altScore(a, b) {
    const ua = U.get(a); const ub = U.get(b);
    const netsA = networksByAccount.get(a) || new Set();
    const netsB = networksByAccount.get(b) || new Set();
    const shared = [...netsA].filter((n) => netsB.has(n));
    const exclusive = shared.filter((n) => accountsByNetwork.get(n).size === 2);
    const beh = behavioural.get(pk(a, b));
    const fast = fastestSwitch(a, b);
    const kin = nameKinship(ua.displayName, ub.displayName);

    let score = 0;
    const why = [];

    if (exclusive.length >= 3) { score += 30; why.push(`${exclusive.length} private connections shared`); }
    else if (exclusive.length >= 1) { score += 20; why.push(`${exclusive.length} private connection shared`); }
    else if (shared.length) { score += 8; why.push(`${shared.length} connections shared`); }

    if (kin >= 1) { score += 25; why.push('one name contains the other'); }
    else if (kin >= 0.7) { score += 15; why.push('names share a long prefix'); }
    else if (kin >= 0.4) { score += 7; why.push('names look related'); }

    if (fast === Infinity && shared.length) { score += 15; why.push('never traded in the same session'); }
    else if (fast >= 60000) { score += 12; why.push('never within a minute of each other'); }
    else if (fast >= CONCURRENT_MS) { score += 4; why.push(`closest was ${Math.round(fast / 1000)}s apart`); }
    else { score -= 25; why.push(`live at the same second (${(fast / 1000).toFixed(1)}s apart) — points to two people`); }

    if (beh) {
      if (beh.lift >= 10) { score += 20; why.push(`trades the same stocks ${beh.lift.toFixed(0)}x more than chance`); }
      else { score += 12; why.push(`trades the same stocks ${beh.lift.toFixed(1)}x more than chance`); }
    }

    if (!ua.discordId || !ub.discordId) { score += 10; why.push('one side has no Discord linked'); }
    if (!ua.discordId && !ub.discordId) { score += 5; why.push('neither has Discord'); }

    const gap = Math.abs(toMs(ua.createdAt) - toMs(ub.createdAt));
    if (gap < 3 * 24 * 60 * 60 * 1000) { score += 8; why.push('created within days of each other'); }

    return { score: Math.max(0, Math.min(99, score)), why, exclusive: exclusive.length, shared: shared.length, beh, fast };
  }

  const out = [];
  const real = [...groups.values()].map((m) => m.filter((u) => U.has(u))).filter((m) => m.length > 1);
  real.sort((a, b) => b.reduce((s, u) => s + valueOf(U.get(u)), 0) - a.reduce((s, u) => s + valueOf(U.get(u)), 0));

  out.push(`Groups found in the last ${days} days.`);
  out.push(`${snap.size} trades examined. ${real.length} groups of 2 or more accounts.`);
  out.push(`Connection links: ${connectionPairs.size} pairs. Behaviour-only links: `
    + `${[...behavioural.keys()].filter((k) => !connectionPairs.has(k)).length} pairs.\n`);

  const verdicts = [];

  real.forEach((members, i) => {
    const worth = members.reduce((s, u) => s + valueOf(U.get(u)), 0);
    const sorted = [...members].sort((a, b) => valueOf(U.get(b)) - valueOf(U.get(a)));
    out.push('='.repeat(78));
    out.push(`GROUP ${i + 1} — ${members.length} accounts, ${money(worth)} between them`);
    out.push('='.repeat(78));
    for (const u of sorted) {
      const d = U.get(u);
      out.push(`  ${nm(u).padEnd(24)} ${money(valueOf(d)).padStart(11)}  ${day(toMs(d.createdAt))}  `
        + `${(d.crew || 'no crew').padEnd(15)} ${d.discordId ? 'discord' : 'NO discord'}${d.isBanned ? '  [BANNED]' : ''}`);
    }
    out.push('');
    for (let x = 0; x < sorted.length; x++) {
      for (let y = x + 1; y < sorted.length; y++) {
        const a = sorted[x]; const b = sorted[y];
        const key = pk(a, b);
        const linkedByNet = connectionPairs.has(key);
        const beh = behavioural.get(key);
        if (!linkedByNet && !beh) continue;
        const v = altScore(a, b);
        const how = linkedByNet && beh ? 'same connection AND same trades'
          : linkedByNet ? 'same connection' : 'same trades, different connections';
        out.push(`  ${nm(a)} + ${nm(b)}  [${how}]  alt likelihood ${v.score}%`);
        out.push(`     ${v.why.join('; ')}`);
        if (beh) out.push(`     overlapped ${beh.observed} times, expected ${beh.expected.toFixed(1)} — stocks: ${beh.tickers.join(', ')}`);
        out.push('');

        if (valueOf(U.get(a)) >= minValue && valueOf(U.get(b)) >= minValue) {
          verdicts.push({ a, b, ...v, group: i + 1, va: valueOf(U.get(a)), vb: valueOf(U.get(b)) });
        }
      }
    }
  });

  out.push('='.repeat(78));
  out.push(`ALT VERDICTS — over 60% likelihood, both accounts worth ${money(minValue)}+`);
  out.push('='.repeat(78));
  const strong = verdicts.filter((v) => v.score > 60).sort((x, y) => y.score - x.score);
  if (!strong.length) out.push('  None meet both bars.');
  for (const v of strong) {
    out.push(`\n  ${v.score}%   ${nm(v.a)} (${money(v.va)})  +  ${nm(v.b)} (${money(v.vb)})   group ${v.group}`);
    for (const w of v.why) out.push(`          - ${w}`);
  }
  out.push('\nScore is my judgement from the listed signals, not a calibrated probability.');
  out.push('A negative signal (two sessions live at once) pushes a pair DOWN, because');
  out.push('that points at two real people rather than one person with two logins.\n');

  const text = out.join('\n');
  console.log(text);
  // Its own filename — connection-map.cjs owns connection-map.txt.
  fs.writeFileSync(path.join(__dirname, '..', 'alt-verdicts.txt'), text, 'utf8');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
