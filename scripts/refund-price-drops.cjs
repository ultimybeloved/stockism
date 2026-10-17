'use strict';

// Refunds the 2026-10 shop price drops: anyone who paid more for an item than
// it costs now gets the difference back as cash, with a ledger entry and a
// notification. The player who PAID gets it, so a gift refunds the giver.
//
//   node scripts/refund-price-drops.cjs                        (dry run, writes a report)
//   node scripts/refund-price-drops.cjs --confirm              (pays the ledger-backed refunds)
//   node scripts/refund-price-drops.cjs --include-unrecorded   (also items owned with no purchase record)
//
// What counts as paid, from the money ledger:
// - cosmetic_purchase: the amount paid. A featured (25% off) buy is refunded
//   against this week's discounted new price, so the discount isn't paid twice.
// - bundle_purchase: the bundle price split across its items by list price,
//   refunded against the bundle-discounted new price.
// - cosmetic_gift_sent: same rules, paid back to the giver.
// The ledger only goes back to 2026-10-10. Items owned with no record could
// have been bought or granted, so they are only listed (as "unrecorded") and
// only paid with --include-unrecorded, at the old list price.
//
// Safe to re-run: each payout writes shopRefunds/{RUN}_{uid} in the same
// transaction and a player who already has one is skipped.

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

const RUN = 'price_drop_2026_10';
const CONFIRM = process.argv.includes('--confirm');
const UNRECORDED = process.argv.includes('--include-unrecorded');
const BUNDLE_DISCOUNT = 0.2;
const FEATURED_DISCOUNT = 0.25;

// Prices right before the drop, and now.
const DROPS = {};
for (const c of ['gold', 'crimson', 'neon', 'pink', 'sapphire', 'violet', 'cyan', 'orange', 'silver']) {
  DROPS[`glow_${c}`] = { old: 15000, now: 5000 };
  DROPS[`glow_pulse_${c}`] = { old: 50000, now: 10000 };
}
for (const c of ['royal', 'inferno', 'frost', 'blush', 'verdant', 'gilded', 'midnight', 'onyx', 'lagoon']) {
  DROPS[`backdrop_${c}`] = { old: 25000, now: 5000 };
}
for (const c of ['steel', 'jade', 'ruby']) DROPS[`frame_${c}`] = { old: 30000, now: 5000 };
DROPS.frame_bullbear = { old: 80000, now: 50000 };
const DROPPED = Object.keys(DROPS);

// List prices at purchase time, to split a bundle's price across its items:
// the old price of anything that changed, the catalog price for the rest.
const RAISED = { name_shimmer: 40000, name_rainbow: 60000 };
const CATALOG = Object.fromEntries(
  [
    ...fs
      .readFileSync(path.join(__dirname, '..', 'functions', 'src', 'shared', 'constants', 'cosmetics.ts'), 'utf8')
      .matchAll(/^\s+([a-z0-9_]+): \{ type: '\w+', price: (\d+)/gm),
  ].map((m) => [m[1], Number(m[2])]),
);
const listPriceThen = (id) => DROPS[id]?.old ?? RAISED[id] ?? CATALOG[id] ?? 0;
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

const main = async () => {
  // 1. Every recorded payment for a dropped item.
  const payments = []; // { payer, owner, id, paid, kind }
  for (const type of ['cosmetic_purchase', 'bundle_purchase', 'cosmetic_gift_sent']) {
    const snap = await db.collection('ledger').where('type', '==', type).get();
    for (const doc of snap.docs) {
      const e = doc.data();
      const paid = -Number(e.amount) || 0;
      if (paid <= 0) continue;
      const items = Array.isArray(e.detail?.items) ? e.detail.items : [e.ref];
      const owner = type === 'cosmetic_gift_sent' ? e.detail?.to : e.uid;
      const bundle = type === 'bundle_purchase' || (type === 'cosmetic_gift_sent' && items.length > 1);
      const featured = !!e.detail?.featured;
      const total = items.reduce((s, id) => s + listPriceThen(id), 0) || 1;
      for (const id of items) {
        if (!DROPS[id]) continue;
        const share = bundle ? (paid * listPriceThen(id)) / total : paid;
        const nowPaid = DROPS[id].now * (bundle ? 1 - BUNDLE_DISCOUNT : featured ? 1 - FEATURED_DISCOUNT : 1);
        payments.push({
          payer: e.uid,
          owner,
          id,
          paid: share,
          refund: Math.max(0, Math.round(share - nowPaid)),
          kind: type,
          ledgerId: doc.id,
        });
      }
    }
  }

  // 2. Owners of dropped items with no payment on record.
  const owners = new Map(); // uid -> { name, items:Set }
  for (let i = 0; i < DROPPED.length; i += 30) {
    const snap = await db
      .collection('users')
      .where('ownedCosmetics', 'array-contains-any', DROPPED.slice(i, i + 30))
      .get();
    for (const doc of snap.docs) {
      const d = doc.data();
      const o = owners.get(doc.id) || { name: d.displayName || doc.id, items: new Set() };
      for (const id of d.ownedCosmetics || []) if (DROPS[id]) o.items.add(id);
      owners.set(doc.id, o);
    }
  }
  // admin grants are free, never refunded
  const granted = new Set();
  const grants = await db.collection('ledger').where('type', '==', 'admin_grant_cosmetic').get();
  for (const doc of grants.docs) granted.add(`${doc.data().uid}|${doc.data().ref}`);
  const recorded = new Set(payments.map((p) => `${p.owner}|${p.id}`));
  const unrecorded = [];
  for (const [uid, o] of owners) {
    for (const id of o.items) {
      const key = `${uid}|${id}`;
      if (!recorded.has(key) && !granted.has(key))
        unrecorded.push({
          payer: uid,
          owner: uid,
          id,
          paid: DROPS[id].old,
          refund: DROPS[id].old - DROPS[id].now,
          kind: 'unrecorded',
        });
    }
  }

  // 3. Per payer totals.
  const names = new Map([...owners].map(([uid, o]) => [uid, o.name]));
  const rows = [...payments, ...(UNRECORDED ? unrecorded : [])].filter((p) => p.refund > 0);
  const byPayer = new Map();
  for (const p of rows) {
    const r = byPayer.get(p.payer) || { uid: p.payer, total: 0, lines: [] };
    r.total += p.refund;
    r.lines.push(p);
    byPayer.set(p.payer, r);
  }
  for (const uid of byPayer.keys()) {
    if (!names.has(uid)) names.set(uid, (await db.collection('users').doc(uid).get()).data()?.displayName || uid);
  }
  const list = [...byPayer.values()].sort((a, b) => b.total - a.total);

  const report = {
    run: RUN,
    at: new Date().toISOString(),
    recorded: { players: list.length, total: list.reduce((s, r) => s + r.total, 0) },
    unrecorded: {
      players: new Set(unrecorded.map((u) => u.owner)).size,
      items: unrecorded.length,
      total: unrecorded.reduce((s, u) => s + u.refund, 0),
      included: UNRECORDED,
    },
    payouts: list.map((r) => ({
      uid: r.uid,
      name: names.get(r.uid),
      total: r.total,
      lines: r.lines.map((l) => ({
        id: l.id,
        paid: Math.round(l.paid),
        refund: l.refund,
        how: l.kind,
        owner: l.owner === r.uid ? undefined : names.get(l.owner) || l.owner,
      })),
    })),
    unrecordedOwners: [...new Set(unrecorded.map((u) => u.owner))].map((uid) => ({
      uid,
      name: names.get(uid),
      items: unrecorded.filter((u) => u.owner === uid).map((u) => u.id),
      wouldGet: unrecorded.filter((u) => u.owner === uid).reduce((s, u) => s + u.refund, 0),
    })),
  };
  const out = path.join(__dirname, '..', `refund-${RUN}.json`);
  fs.writeFileSync(out, JSON.stringify(report, null, 2));
  console.log(
    `Recorded purchases: ${list.length} players, ${money(report.recorded.total)}${UNRECORDED ? ' (unrecorded included)' : ''}`,
  );
  console.log(
    `Unrecorded owners: ${report.unrecorded.players} players, ${report.unrecorded.items} items, ${money(report.unrecorded.total)} if paid`,
  );
  for (const r of list.slice(0, 40))
    console.log(
      `  ${String(names.get(r.uid)).padEnd(22)} ${money(r.total).padStart(10)}  ${r.lines.map((l) => l.id).join(', ')}`,
    );
  console.log(`Report: ${out}`);
  if (!CONFIRM) {
    console.log('Dry run. Nothing paid. Re-run with --confirm to pay.');
    return;
  }

  // 4. Pay: cash, ledger entry, run marker, then a notification.
  let paid = 0;
  for (const r of list) {
    const userRef = db.collection('users').doc(r.uid);
    const markRef = db.collection('shopRefunds').doc(`${RUN}_${r.uid}`);
    const done = await db.runTransaction(async (tx) => {
      const [user, mark] = await Promise.all([tx.get(userRef), tx.get(markRef)]);
      if (mark.exists || !user.exists) return false;
      const cash = Number(user.data().cash) || 0;
      tx.update(userRef, { cash: FieldValue.increment(r.total) });
      tx.set(db.collection('ledger').doc(), {
        uid: r.uid,
        type: 'shop_price_refund',
        account: 'cash',
        amount: r.total,
        cashAfter: cash + r.total,
        ref: RUN,
        detail: { items: r.lines.map((l) => l.id) },
        timestamp: FieldValue.serverTimestamp(),
      });
      tx.set(markRef, {
        uid: r.uid,
        total: r.total,
        items: r.lines.map((l) => l.id),
        at: FieldValue.serverTimestamp(),
      });
      return true;
    });
    if (!done) continue;
    paid += r.total;
    await userRef.collection('notifications').add({
      type: 'system',
      title: 'Shop price drop refund',
      message: `Some shop items you paid for cost less now, so the difference is back in your cash: ${money(r.total)}.`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      data: { amount: r.total },
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
