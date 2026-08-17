'use strict';

// READ-ONLY. Resolves "which of these two does that account belong to".
//
//   node scripts/whose-connection.cjs Slare definethereal. -- sadako.sasaki peaklady_41877
//
// The problem this fixes: "share of their trades made from X's connections" does
// NOT identify a person. It identifies a LOCATION. When two accounts already
// share most of their connections with each other, a third account living there
// scores high against BOTH of them, and that looks like two separate findings
// when it is one.
//
// So this splits the connections three ways — used only by A, only by B, or by
// both — and asks where the third account's trades actually landed. Only the
// exclusive columns can attribute anything. If a third account lives entirely on
// connections A and B share, the data cannot tell you whose it is, and saying
// otherwise is invention.
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
  const args = process.argv.slice(2);
  const sep = args.indexOf('--');
  if (sep < 1) {
    console.error('Usage: node scripts/whose-connection.cjs <A> <B> -- <account> [account...]');
    process.exit(1);
  }
  const [aName, bName] = args.slice(0, sep);
  const subjects = args.slice(sep + 1);

  const users = await db.collection('users').select('displayName', 'isBot').get();
  const byName = new Map();
  users.forEach((d) => byName.set((d.data().displayName || '').toLowerCase(), d.id));
  const idOf = (n) => byName.get((n || '').toLowerCase());

  const A = idOf(aName); const B = idOf(bName);
  if (!A || !B) { console.error('Could not resolve both anchor accounts.'); process.exit(1); }

  const snap = await db.collection('trades').select('uid', 'ip').get();
  const netsOf = new Map();
  snap.forEach((d) => {
    const t = d.data();
    const n = networkKey(t.ip);
    if (!t.uid || !n || isVpn(n)) return;
    if (!netsOf.has(t.uid)) netsOf.set(t.uid, new Map());
    netsOf.get(t.uid).set(n, (netsOf.get(t.uid).get(n) || 0) + 1);
  });

  const na = new Set((netsOf.get(A) || new Map()).keys());
  const nb = new Set((netsOf.get(B) || new Map()).keys());
  const onlyA = [...na].filter((n) => !nb.has(n));
  const onlyB = [...nb].filter((n) => !na.has(n));
  const both = [...na].filter((n) => nb.has(n));

  const tradesOn = (id, nets) => nets.reduce((s, n) => s + ((netsOf.get(id) || new Map()).get(n) || 0), 0);

  console.log(`\n${aName} uses ${na.size} connections. ${bName} uses ${nb.size}.`);
  console.log(`  only ${aName}: ${onlyA.length}`);
  console.log(`  only ${bName}: ${onlyB.length}`);
  console.log(`  shared by both: ${both.length}`);
  console.log(`\n${aName} does ${pctS(tradesOn(A, both), tradesOn(A, [...na]))} of its own trading on the shared set.`);
  console.log(`${bName} does ${pctS(tradesOn(B, both), tradesOn(B, [...nb]))} of its own trading on the shared set.\n`);

  console.log('WHERE EACH ACCOUNT ACTUALLY TRADED\n');
  console.log(`  ACCOUNT              TOTAL   ONLY-${aName.toUpperCase().slice(0, 8).padEnd(8)}  ONLY-${bName.toUpperCase().slice(0, 8).padEnd(8)}  SHARED    ELSEWHERE   VERDICT`);

  for (const s of subjects) {
    const id = idOf(s);
    if (!id) { console.log(`  ${s}: unknown account`); continue; }
    const mine = netsOf.get(id) || new Map();
    const total = [...mine.values()].reduce((x, y) => x + y, 0);
    const inA = tradesOn(id, onlyA);
    const inB = tradesOn(id, onlyB);
    const inBoth = tradesOn(id, both);
    const elsewhere = total - inA - inB - inBoth;

    let verdict;
    if (inA + inB === 0) verdict = 'CANNOT TELL — only ever on connections they share';
    else if (inA > inB * 3) verdict = `leans ${aName}`;
    else if (inB > inA * 3) verdict = `leans ${bName}`;
    else verdict = 'CANNOT TELL — present on both exclusively';

    console.log(`  ${s.padEnd(20)} ${String(total).padStart(5)}   ${(inA + ' (' + pctS(inA, total) + ')').padEnd(14)}  `
      + `${(inB + ' (' + pctS(inB, total) + ')').padEnd(14)}  ${(inBoth + ' (' + pctS(inBoth, total) + ')').padEnd(9)} `
      + `${(elsewhere + ' (' + pctS(elsewhere, total) + ')').padEnd(11)} ${verdict}`);
  }
  console.log('\nOnly the two exclusive columns can attribute anything. Trades in the shared');
  console.log('column are compatible with either owner and must not be counted for both.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
