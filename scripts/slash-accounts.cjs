'use strict';

// WRITES (with --apply): shrinks whole accounts to a target net worth.
//
//   node scripts/slash-accounts.cjs --target 100000 --note "..." uid1 uid2 ... [--apply]
//
// Everything in the account shrinks by the same factor: every holding (and its
// loyalty lots and lockups), the margin debt and the cash. Nothing is sold, so
// no price moves, and leverage stays exactly what it was, so no margin call
// fires. Long-term market positions are left alone but count toward the target.
// Each account gets a ledger entry (shares + cash), an adminLog entry and a bell
// notification with the percentage it dropped. Without --apply it only prints.

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

const ADMIN_UID = '4usiVxPmHLhmitEKH2HfCpbx4Yi1';
const r2 = (n) => Math.round(n * 100) / 100;
const r6 = (n) => Math.round(n * 1e6) / 1e6;
const money = (n) => '$' + Math.round(Number(n) || 0).toLocaleString('en-US');

function plan(u, prices, target) {
  const cash = u.cash || 0;
  const debt = u.marginUsed || 0;
  const event = Math.max(0, u.eventPositionsValue || 0);
  if (Object.values(u.shorts || {}).some((s) => s && s.shares > 0)) throw new Error('has open shorts');
  const value = (h) => Object.entries(h).reduce((s, [t, n]) => s + (n > 0 ? (prices[t] || 0) * n : 0), 0);
  const stocks = value(u.holdings || {});
  const trading = cash + stocks - debt;
  const before = trading + event;
  if (before <= target) return null;
  const f = (target - event) / trading;
  if (!(f > 0 && f < 1)) throw new Error(`bad factor ${f}`);

  const up = {};
  const holdings = {};
  for (const [t, n] of Object.entries(u.holdings || {})) holdings[t] = typeof n === 'number' ? r6(n * f) : n;
  up.holdings = holdings;
  for (const [t, c] of Object.entries(u.holdingCohorts || {})) {
    if (!c) continue;
    up[`holdingCohorts.${t}`] = {
      ...c,
      eligible: r6((c.eligible || 0) * f),
      pending: (c.pending || []).map((lot) => ({ ...lot, shares: r6((lot.shares || 0) * f) })),
    };
  }
  for (const lock of ['ipoLockup', 'marginLockup']) {
    for (const [t, l] of Object.entries(u[lock] || {})) {
      if (l && typeof l.shares === 'number') up[`${lock}.${t}`] = { ...l, shares: r6(l.shares * f) };
    }
  }
  const newCash = r2(cash * f);
  const newStocks = value(holdings);
  up.cash = newCash;
  up.marginUsed = debt * f;
  up.portfolioValue = r2(newCash + newStocks);
  const after = newCash + newStocks - debt * f + event;
  return { f, up, before, after, cash, newCash, stocks, newStocks, debt, event, drop: 1 - after / before };
}

async function main() {
  const args = process.argv.slice(2);
  const take = (flag) => {
    const i = args.indexOf(flag);
    return i >= 0 ? args.splice(i, 2)[1] : undefined;
  };
  const target = Number(take('--target'));
  const note = take('--note') || '';
  const apply = args.includes('--apply');
  const uids = args.filter((a) => a !== '--apply');
  if (!(target > 0) || !uids.length) throw new Error('usage: --target N [--note text] uid... [--apply]');

  for (const uid of uids) {
    const userRef = db.collection('users').doc(uid);
    const result = await db.runTransaction(async (tx) => {
      const [mSnap, uSnap] = await Promise.all([tx.get(db.doc('market/current')), tx.get(userRef)]);
      const u = uSnap.data();
      const p = plan(u, mSnap.data().prices || {}, target);
      if (!p) return { name: u.displayName, skipped: true };
      if (apply) {
        tx.update(userRef, p.up);
        const detail = { by: ADMIN_UID, factor: p.f, reason: 'manipulation' };
        tx.set(db.collection('ledger').doc(), {
          uid,
          type: 'admin_slash',
          account: 'shares',
          amount: r2(p.newStocks - p.stocks),
          ref: 'slash',
          detail,
          timestamp: FieldValue.serverTimestamp(),
        });
        if (r2(p.newCash - p.cash) !== 0) {
          tx.set(db.collection('ledger').doc(), {
            uid,
            type: 'admin_slash',
            account: 'cash',
            amount: r2(p.newCash - p.cash),
            cashAfter: p.newCash,
            ref: 'slash',
            detail,
            timestamp: FieldValue.serverTimestamp(),
          });
        }
      }
      return { name: u.displayName, ...p };
    });
    if (result.skipped) {
      console.log(`${result.name}: already at or under target, skipped`);
      continue;
    }
    const pct = (result.drop * 100).toFixed(1);
    console.log(
      `${(result.name || uid).padEnd(12)} net ${money(result.before).padStart(11)} -> ${money(result.after).padStart(9)}` +
        `  (-${pct}%)  stocks ${money(result.stocks)} -> ${money(result.newStocks)}  debt ${money(result.debt)} -> ${money(result.debt * result.f)}` +
        `  cash ${money(result.cash)} -> ${money(result.newCash)}  event ${money(result.event)}`,
    );
    if (!apply) continue;
    await db.collection('adminLog').add({
      action: 'slash_account',
      by: ADMIN_UID,
      uid,
      name: result.name || null,
      before: r2(result.before),
      after: r2(result.after),
      detail: { factor: result.f, dropPercent: Number(pct), source: 'script' },
      at: FieldValue.serverTimestamp(),
    });
    await userRef.collection('notifications').add({
      type: 'system',
      title: 'Account cut',
      message: `Your account dropped by ${pct}%.${note ? ' ' + note : ''}`,
      read: false,
      createdAt: FieldValue.serverTimestamp(),
      data: { dropPercent: Number(pct) },
    });
  }
  if (!apply) console.log('\nDry run. Nothing written. Add --apply to do it.');
}
main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
