'use strict';

// READ-ONLY audit of harassment / joke / throwaway account names.
//
//   node scripts/spam-name-audit.cjs
//
// Writes nothing. Every Firestore call below is a .get().
//
// Two ways an account gets flagged:
//
//   TARGETED  the name contains a real player's name plus a degrading word
//             ("StitchSlaveCallmebot"). The list of real player names is
//             derived from the data, not hardcoded, so it stays current.
//   SLUR      the name contains a word that is abusive on its own, whoever
//             it is aimed at.
//
// Flagging is only half the answer. The other half is whether the account is a
// throwaway, so each row also carries trades, net worth vs starting cash, age,
// and last activity. A rude name on an account that actually plays is a rename
// problem, not a delete problem.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const { STARTING_CASH, UNVERIFIED_STARTING_CASH } = require('../functions/constants');

// Abusive on its own, whoever it names.
const SLUR = [
  'rape', 'rvpe', 'rapes', 'raped', 'rapist', 'molest', 'pedo',
  'cum', 'coom', 'cock', 'penis', 'dick', 'porn', 'hentai',
  'nigg', 'fag', 'retard', 'whore', 'slut', 'cuck', 'tranny',
  'kys', 'killurself', 'killyourself',
];

// Degrading only in context. Flags when wrapped around a real player's name.
const DEGRADING = [
  'slave', 'peg', 'pegs', 'pegged', 'submissive', 'bottom', 'dog', 'rat',
  'suck', 'sucks', 'lick', 'licks', 'finger', 'fingers', 'owns', 'owned',
  'bitch', 'simp', 'toy', 'pet', 'servant', 'worship', 'lover', 'wife',
  'husband', 'smells', 'stinks', 'ugly', 'trash', 'loser', 'eater',
  'bucket', 'gay', 'kisser', 'breath', 'fart', 'poop', 'baby', 'son',
];

// Leetspeak and padding, so N1CumBucket and StchFingers both normalise.
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const deleet = (s) => norm(s)
  .replace(/0/g, 'o').replace(/1/g, 'i').replace(/3/g, 'e').replace(/4/g, 'a')
  .replace(/5/g, 's').replace(/7/g, 't').replace(/8/g, 'b').replace(/9/g, 'g')
  .replace(/2/g, '').replace(/6/g, '');

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : '?');
const ago = (ms) => (ms ? Math.floor((Date.now() - ms) / 86400000) + 'd ago' : 'never');

function hits(name, words) {
  const a = norm(name); const b = deleet(name);
  return words.filter((w) => a.includes(w) || b.includes(deleet(w)));
}

async function main() {
  const [snap, mk] = await Promise.all([
    db.collection('users').select(
      'displayName', 'displayNameLower', 'cash', 'holdings', 'shorts', 'marginUsed',
      'portfolioValue', 'totalTrades', 'createdAt', 'lastActive', 'discordId',
      'isBot', 'isBanned', 'isAdmin', 'signupIp', 'crew',
    ).get(),
    db.collection('market').doc('current').get(),
  ]);
  const prices = (mk.data() || {}).prices || {};

  const users = [];
  snap.forEach((d) => users.push({ uid: d.id, ...d.data() }));

  const netWorth = (u) => {
    let v = u.cash || 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v - (u.marginUsed || 0);
  };

  // "Real player" = a human account that has actually traded. Their names are
  // what the harassment names are built out of.
  const real = users.filter((u) => !u.isBot && !u.isBanned && (u.totalTrades || 0) >= 3);
  const realNames = real
    .map((u) => ({ uid: u.uid, name: u.displayName, key: norm(u.displayName) }))
    .filter((r) => r.key.length >= 4);

  const flagged = [];
  for (const u of users) {
    if (u.isBot || u.isAdmin) continue;
    const name = u.displayName || '';
    if (!name) continue;

    const slurs = hits(name, SLUR);
    const degrading = hits(name, DEGRADING);

    // Whose name is buried inside this one?
    const targets = realNames.filter((r) => r.uid !== u.uid
      && norm(name).length > r.key.length && norm(name).includes(r.key));

    let reason = null;
    if (slurs.length) reason = 'slur: ' + slurs.join(', ');
    else if (targets.length && degrading.length) {
      reason = 'targets ' + targets.map((t) => t.name).join(' + ') + ' - ' + degrading.join(', ');
    }
    if (!reason) continue;

    const nw = netWorth(u);
    const start = u.discordId ? STARTING_CASH : UNVERIFIED_STARTING_CASH;
    flagged.push({
      uid: u.uid, name, reason,
      trades: u.totalTrades || 0,
      nw, start, growth: nw - start,
      cash: u.cash || 0,
      positions: Object.values(u.holdings || {}).filter((s) => s > 0).length,
      shorts: Object.values(u.shorts || {}).filter((s) => s && (s.shares || s) > 0).length,
      created: toMs(u.createdAt), last: toMs(u.lastActive),
      discord: !!u.discordId, banned: !!u.isBanned, crew: u.crew || null,
      ip: u.signupIp || null,
      targets: targets.map((t) => t.name),
    });
  }

  // Throwaways first: no trades, no growth.
  const dead = (f) => f.trades === 0 && Math.abs(f.growth) < 0.01;
  flagged.sort((a, b) => (dead(b) - dead(a)) || a.trades - b.trades || a.nw - b.nw);

  console.log('\nScanned ' + users.length + ' accounts. ' + flagged.length + ' flagged.\n');
  console.log('='.repeat(78));

  const show = (title, rows) => {
    if (!rows.length) return;
    console.log('\n' + title + '  (' + rows.length + ')\n');
    for (const f of rows) {
      console.log('  ' + f.name);
      console.log('     ' + f.reason);
      console.log('     net ' + money(f.nw) + ' (start ' + money(f.start) + ', '
        + (f.growth >= 0 ? '+' : '') + money(f.growth) + ')'
        + '   ' + f.trades + ' trades   ' + f.positions + ' positions'
        + (f.shorts ? '   ' + f.shorts + ' shorts' : ''));
      console.log('     joined ' + day(f.created) + '   active ' + ago(f.last)
        + '   ' + (f.discord ? 'Discord linked' : 'no Discord')
        + (f.crew ? '   ' + f.crew : '') + (f.banned ? '   [ALREADY BANNED]' : ''));
      console.log('     ' + f.uid + '   ip ' + (f.ip || 'unknown'));
      console.log('');
    }
  };

  show('NO ACTIVITY - pure throwaways', flagged.filter(dead));
  show('HAS ACTIVITY - traded or grew', flagged.filter((f) => !dead(f)));

  // Who is making these?
  const byIp = new Map();
  for (const f of flagged) {
    if (!f.ip) continue;
    if (!byIp.has(f.ip)) byIp.set(f.ip, []);
    byIp.get(f.ip).push(f.name);
  }
  const rings = [...byIp.entries()].filter(([, n]) => n.length > 1).sort((a, b) => b[1].length - a[1].length);
  if (rings.length) {
    console.log('='.repeat(78));
    console.log('\nSIGNUP IPs MAKING MORE THAN ONE OF THESE\n');
    for (const [ip, names] of rings) console.log('  ' + names.length + 'x  ' + ip + '\n     ' + names.join(', ') + '\n');
  }

  console.log('='.repeat(78));
  console.log('\nUIDs, ready to paste into the delete script:\n');
  console.log(flagged.map((f) => "  '" + f.uid + "', // " + f.name).join('\n'));
  console.log('');

  // The signup filter only shields names on the protected list. That list is
  // hand-curated (deliberately - see helpers.js), so it goes stale as the board
  // moves. Say so out loud rather than letting it quietly stop covering people.
  // Read the list as text. Requiring helpers.js would pull in functions/'s own
  // copy of firebase-admin, which is a different module instance from this
  // script's and has no initialized app.
  const helpersSrc = fs.readFileSync(path.join(__dirname, '..', 'functions', 'helpers.js'), 'utf8');
  const block = helpersSrc.match(/const PROTECTED_PLAYER_NAMES = \[([\s\S]*?)\];/);
  const PROTECTED_PLAYER_NAMES = block
    ? [...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
    : [];
  if (!PROTECTED_PLAYER_NAMES.length) {
    console.log('\nCould not read PROTECTED_PLAYER_NAMES from functions/helpers.js - skipping coverage check.\n');
    return;
  }
  const top = users
    .filter((u) => !u.isBot && !u.isBanned && u.displayName)
    .sort((a, b) => (b.portfolioValue || 0) - (a.portfolioValue || 0))
    .slice(0, 25);
  const missing = top.filter((u) => {
    const k = norm(u.displayName);
    return k.length >= 4 && !PROTECTED_PLAYER_NAMES.includes(k);
  });
  console.log('='.repeat(78));
  if (missing.length) {
    console.log('\nTOP-25 PLAYERS NOT COVERED BY THE SIGNUP FILTER\n');
    console.log('  Add these to PROTECTED_PLAYER_NAMES in functions/helpers.js (lowercase,');
    console.log('  letters and digits only), then redeploy createUser and changeDisplayName:\n');
    for (const u of missing) {
      console.log("    '" + norm(u.displayName) + "',   // " + u.displayName
        + '  $' + Math.round(u.portfolioValue || 0).toLocaleString('en-US'));
    }
    console.log('');
  } else {
    console.log('\nEvery top-25 player is covered by the signup filter.\n');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
