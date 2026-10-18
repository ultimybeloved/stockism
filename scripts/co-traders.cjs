'use strict';

// READ-ONLY: who trades alongside a group of accounts.
//
//   node scripts/co-traders.cjs Stitch Madness Callmebot [--days 30]
//
// Names match exactly (case-insensitive). For every trade the group made, it
// finds other players who traded the same stock in the same direction within
// 10 minutes, then ranks those players by how often that happened. Also counts
// how often each player shared a coordinated-pressure flag with the group.
//
// Writes nothing.

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

const WINDOW_MS = 10 * 60 * 1000;
const UP = new Set(['buy', 'cover']);
const DOWN = new Set(['sell', 'short']);
const dir = (a) => (UP.has(a) ? 1 : DOWN.has(a) ? -1 : 0);
const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts : ts.toMillis ? ts.toMillis() : 0);
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

async function main() {
  const args = process.argv.slice(2);
  const di = args.indexOf('--days');
  const days = di >= 0 ? Number(args.splice(di, 2)[1]) : 30;
  const since = Date.now() - days * 86400000;

  const all = await db.collection('users').select('displayName', 'isBot').get();
  const nameOf = new Map();
  const nm = (u) => nameOf.get(u) || `(deleted ${u.slice(0, 6)})`;
  all.forEach((d) => nameOf.set(d.id, d.data().displayName || d.id.slice(0, 10)));
  const group = new Set();
  for (const q of args) {
    const hits = all.docs.filter(
      (d) => (d.data().displayName || '').toLowerCase() === q.toLowerCase() && !d.data().isBot,
    );
    if (!hits.length) console.log(`No match for "${q}"`);
    hits.forEach((d) => {
      group.add(d.id);
      console.log(`"${q}" -> ${d.data().displayName} (${d.id})`);
    });
  }
  const isBot = new Set(all.docs.filter((d) => d.data().isBot).map((d) => d.id));

  // Group trades.
  const groupTrades = [];
  for (const uid of group) {
    const s = await db
      .collection('trades')
      .where('uid', '==', uid)
      .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(since))
      .get();
    s.forEach((d) => {
      const t = d.data();
      if (dir(t.action)) groupTrades.push({ ...t, ts: toMs(t.timestamp) });
    });
  }
  console.log(`\nGroup trades in last ${days}d: ${groupTrades.length}`);

  // All trades on the tickers they touched.
  const tickers = [...new Set(groupTrades.map((t) => t.ticker))];
  const byTicker = new Map();
  for (const tk of tickers) {
    const s = await db
      .collection('trades')
      .where('ticker', '==', tk)
      .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(since))
      .get();
    byTicker.set(
      tk,
      s.docs.map((d) => {
        const t = d.data();
        return { ...t, ts: toMs(t.timestamp) };
      }),
    );
  }

  // Count distinct group trades each outsider shadowed (same stock, same direction, within window).
  const score = new Map();
  for (const g of groupTrades) {
    const seen = new Set();
    for (const o of byTicker.get(g.ticker) || []) {
      if (group.has(o.uid) || isBot.has(o.uid) || !o.uid || seen.has(o.uid)) continue;
      if (dir(o.action) !== dir(g.action) || Math.abs(o.ts - g.ts) > WINDOW_MS) continue;
      seen.add(o.uid);
      const s = score.get(o.uid) || { n: 0, tickers: new Set(), partners: new Map(), value: 0 };
      s.n++;
      s.tickers.add(g.ticker);
      s.partners.set(g.uid, (s.partners.get(g.uid) || 0) + 1);
      s.value += (Number(o.amount) || 0) * (Number(o.price) || 0);
      score.set(o.uid, s);
    }
  }
  // Their own total trade count, to tell shadowing from just trading a lot.
  const ownCount = async (uid) =>
    (
      await db
        .collection('trades')
        .where('uid', '==', uid)
        .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(since))
        .count()
        .get()
    ).data().count;

  // Coordinated-pressure flags shared with the group.
  const alerts = await db.collection('watchlist_alerts').where('type', '==', 'coordinated_pressure').get();
  const flags = new Map();
  alerts.forEach((d) => {
    const a = d.data();
    const u = a.participantUIDs || [a.watchedUID, a.relatedUID].filter(Boolean);
    if (!u.some((x) => group.has(x))) return;
    u.filter((x) => !group.has(x)).forEach((x) => flags.set(x, (flags.get(x) || 0) + 1));
  });

  const ranked = [...score.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25);
  console.log('\nTop co-traders (shadowed group trades | own trades | shared flags | stocks | with whom)');
  for (const [uid, s] of ranked) {
    const own = await ownCount(uid);
    const with_ = [...s.partners.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([p, n]) => `${nm(p)}x${n}`)
      .join(' ');
    console.log(
      `${String(s.n).padStart(4)} | ${String(own).padStart(4)} | ${String(flags.get(uid) || 0).padStart(2)} | ${nm(uid).padEnd(22)} ${money(s.value).padStart(12)} | ${[...s.tickers].slice(0, 6).join(',')} | ${with_}`,
    );
  }
  const flagOnly = [...flags.entries()].filter(([u]) => !score.has(u)).sort((a, b) => b[1] - a[1]);
  if (flagOnly.length)
    console.log('\nShared flags but no shadowing in window:', flagOnly.map(([u, n]) => `${nm(u)}x${n}`).join(', '));

  // Group members' current state.
  console.log('\nGroup members now');
  const snaps = await db.getAll(...[...group].map((u) => db.collection('users').doc(u)));
  for (const s of snaps) {
    const d = s.data() || {};
    console.log(
      `${(d.displayName || s.id).padEnd(22)} cash ${money(d.cash).padStart(12)}  portfolio ${money(d.portfolioValue).padStart(12)}  margin ${money(d.marginUsed)}  shorts ${Object.keys(d.shorts || {}).length}`,
    );
  }
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
