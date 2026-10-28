'use strict';

// Shop credit back pay (2026-10-28, Darth YG): $1,000 of shop credit for every
// mission a player claimed in the two weeks before mission milestones started
// paying credit. Same rate as the milestones ($25k per 25), spread so every
// player who played gets some. Bots and banned players are skipped.
//
//   npx tsx scripts/grant-mission-credit-backpay.cjs            (dry run, lists who gets what)
//   npx tsx scripts/grant-mission-credit-backpay.cjs --confirm  (pays it)
//
// Counts `mission_reward` ledger entries from SINCE up to the moment it runs,
// so run it right before the milestone code goes live, or claims made after
// that would be paid twice (back pay and milestone).
//
// Safe to re-run: each payout writes shopCreditGrants/{RUN}_{uid} in the same
// transaction, and a player who already has one is skipped.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) {
  console.error('No service-account-key.json in the repo root.');
  process.exit(1);
}
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const RUN = 'mission_backpay_2026_10';
const SINCE = Date.UTC(2026, 9, 14, 0, 0); // 2026-10-14 00:00 UTC
const PER_MISSION = 1000;
const CONFIRM = process.argv.includes('--confirm');
const money = (n) => '$' + Math.round(n).toLocaleString('en-US');

const main = async () => {
  const until = Date.now();
  const snap = await db.collection('ledger').where('type', '==', 'mission_reward').get();
  const counts = new Map();
  for (const d of snap.docs) {
    const e = d.data();
    const ms = e.timestamp?.toMillis?.() || 0;
    if (ms >= SINCE && ms <= until) counts.set(e.uid, (counts.get(e.uid) || 0) + 1);
  }

  const list = [];
  for (const [uid, n] of counts) {
    const u = (await db.collection('users').doc(uid).get()).data();
    if (!u || u.isBot || u.isBanned) continue;
    list.push({ uid, name: u.displayName || uid, missions: n, credit: n * PER_MISSION });
  }
  list.sort((a, b) => b.credit - a.credit);
  const total = list.reduce((s, r) => s + r.credit, 0);
  console.log(
    `Missions ${new Date(SINCE).toISOString()} to ${new Date(until).toISOString()}: ${list.length} players, ${money(total)}`,
  );
  for (const r of list)
    console.log(`  ${r.name.padEnd(22)} ${String(r.missions).padStart(3)} missions  ${money(r.credit)}`);
  if (!CONFIRM) {
    console.log('Dry run. Nothing paid. Re-run with --confirm to pay.');
    return;
  }

  // Credit, ledger entry and run marker in one transaction, then a notification.
  let paid = 0;
  for (const r of list) {
    const userRef = db.collection('users').doc(r.uid);
    const markRef = db.collection('shopCreditGrants').doc(`${RUN}_${r.uid}`);
    const done = await db.runTransaction(async (tx) => {
      const [user, mark] = await Promise.all([tx.get(userRef), tx.get(markRef)]);
      if (mark.exists || !user.exists) return false;
      const before = Number(user.data().shopCredit) || 0;
      tx.update(userRef, { shopCredit: before + r.credit });
      tx.set(db.collection('ledger').doc(), {
        uid: r.uid,
        type: 'mission_credit_backpay',
        account: 'credit',
        amount: r.credit,
        cashAfter: before + r.credit,
        ref: RUN,
        detail: { missions: r.missions },
        timestamp: FieldValue.serverTimestamp(),
      });
      tx.set(markRef, { uid: r.uid, missions: r.missions, credit: r.credit, at: FieldValue.serverTimestamp() });
      return true;
    });
    if (!done) continue;
    paid += r.credit;
    await userRef.collection('notifications').add({
      type: 'system',
      title: '🎁 Shop credit added',
      message: `Missions now pay shop credit. For the ${r.missions} missions you finished in the last two weeks, you got ${money(r.credit)} of shop credit. Spend it on anything in the shop, under Customize.`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      data: { amount: r.credit },
    });
  }
  console.log(`Paid ${money(paid)}.`);
};

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
