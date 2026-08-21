'use strict';

// READ-ONLY. Real activity for the accounts spam-name-audit.cjs flagged.
//
//   node scripts/spam-name-detail.cjs
//
// lastActive is unset on most of these docs, so it proves nothing. Trades carry
// real timestamps, so ask the trades collection instead. Also checks what else
// in the database points at each account, so a delete does not leave a hole.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const UIDS = require('./spam-name-targets.cjs');

const toMs = (ts) => (!ts ? 0 : typeof ts === 'number' ? ts
  : ts._seconds ? ts._seconds * 1000 : ts.seconds ? ts.seconds * 1000
    : typeof ts.toMillis === 'function' ? ts.toMillis() : 0);
const day = (ms) => (ms ? new Date(ms).toISOString().slice(0, 10) : 'never');
const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const mk = await db.collection('market').doc('current').get();
  const prices = (mk.data() || {}).prices || {};

  console.log('\nACTIVITY AND DATABASE FOOTPRINT\n' + '='.repeat(78) + '\n');

  for (const uid of UIDS) {
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) { console.log('  ' + uid + '  ALREADY GONE\n'); continue; }
    const u = doc.data();

    const [first, recent, notif, hist, limits, pre] = await Promise.all([
      db.collection('trades').where('uid', '==', uid).orderBy('timestamp', 'asc').limit(1).get(),
      // Pull a window rather than just the newest record. The newest is almost
      // always a scheduled dividend, which makes a long-abandoned account look
      // active; only a real buy/sell counts as somebody logging in.
      db.collection('trades').where('uid', '==', uid).orderBy('timestamp', 'desc').limit(30).get(),
      db.collection('users').doc(uid).collection('notifications').count().get().catch(() => null),
      db.collection('users').doc(uid).collection('portfolioHistory').count().get().catch(() => null),
      db.collection('limitOrders').where('uid', '==', uid).where('status', '==', 'OPEN').get(),
      db.collection('preMarketOrders').where('uid', '==', uid).where('status', '==', 'QUEUED').get(),
    ]);

    const firstT = first.empty ? 0 : toMs(first.docs[0].data().timestamp);
    const humanDocs = recent.docs.filter((d) => {
      const t = d.data();
      return t.source !== 'scheduled' && t.action !== 'dividend' && t.type !== 'dividend';
    });
    const lastT = humanDocs.length ? toMs(humanDocs[0].data().timestamp) : 0;
    const lastAnyT = recent.empty ? 0 : toMs(recent.docs[0].data().timestamp);
    const payoutOnly = lastAnyT && lastAnyT !== lastT;

    const holds = Object.entries(u.holdings || {}).filter(([, s]) => s > 0)
      .map(([t, s]) => t + ' ' + s + ' (' + money((prices[t] || 0) * s) + ')');

    console.log('  ' + (u.displayName || '?'));
    console.log('     trades ' + (u.totalTrades || 0)
      + '   first ' + day(firstT) + '   LAST REAL TRADE ' + day(lastT)
      + (payoutOnly ? '   (nothing since but scheduled payouts, newest ' + day(lastAnyT) + ')' : ''));
    console.log('     cash ' + money(u.cash) + '   margin ' + money(u.marginUsed || 0)
      + '   crew ' + (u.crew || 'none') + (u.isBanned ? '   [BANNED]' : ''));
    if (holds.length) console.log('     holdings: ' + holds.join(', '));
    console.log('     subcollections: ' + (notif ? notif.data().count : '?') + ' notifications, '
      + (hist ? hist.data().count : '?') + ' portfolioHistory');
    if (!limits.empty || !pre.empty) {
      console.log('     OPEN ORDERS: ' + limits.size + ' limit, ' + pre.size + ' pre-market');
    }
    console.log('');
  }

  // Anything that caches a member count would go stale on a raw doc delete.
  const stats = await db.collection('crewStats').get().catch(() => null);
  if (stats && !stats.empty) {
    console.log('='.repeat(78));
    console.log('\ncrewStats docs exist (' + stats.size + '). Fields on the first one:');
    console.log('  ' + Object.keys(stats.docs[0].data()).join(', ') + '\n');
  } else {
    console.log('='.repeat(78) + '\n\nNo crewStats collection.\n');
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
