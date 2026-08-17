'use strict';

// Removes from Stitch and Callmebot the part of their own position's price that
// their own trading created.
//
//   node scripts/apply-selfpump.cjs            (dry run)
//   node scripts/apply-selfpump.cjs --confirm  (applies)
//
// Earlier clawbacks only took what their ALT accounts did to the price. This
// takes what they did themselves, which is the last measured figure available:
// Stitch moved SHNG +21.9%, Callmebot moved GAP +18.2%, both computed by
// chaining the price impact recorded on every one of their own trades.
//
// Expressed as a fraction of the position rather than a dollar amount, because
// 1 - 1/multiplier is what share of the price is pump, and that holds wherever
// the price happens to sit when this runs. A dollar figure would not.
//
// Shares are deleted, not sold, so no price moves and no other holder is touched.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const LONG_MARGIN_CALL_THRESHOLD = 0.30;

const TARGETS = [
  { name: 'Stitch', uid: '1VYIfEcJCiQ60S5iUeWjM1fDMDi2', ticker: 'SHNG', multiplier: 1.219,
    note: 'Self-pump: Stitch\'s own trading moved SHNG +21.9%.' },
  { name: 'Callmebot', uid: 'r1O3shyooqOtVtsPMZ2aYdZ5cIg2', ticker: 'GAP', multiplier: 1.182,
    note: 'Self-pump: Callmebot\'s own trading moved GAP +18.2%.' },
];

const m = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const apply = process.argv.includes('--confirm');
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);

  const mkt = await db.collection('market').doc('current').get();
  const prices = (mkt.data() || {}).prices || {};

  for (const t of TARGETS) {
    const snap = await db.collection('users').doc(t.uid).get();
    if (!snap.exists) { console.error(`${t.name}: missing`); continue; }
    const u = snap.data();

    let hv = 0;
    for (const [tk, s] of Object.entries(u.holdings || {})) if (s > 0) hv += (prices[tk] || 0) * s;
    const grossBefore = (u.cash || 0) + hv;
    const netBefore = grossBefore - (u.marginUsed || 0);

    const shares = (u.holdings || {})[t.ticker] || 0;
    const price = prices[t.ticker] || 0;
    const pumpFraction = 1 - 1 / t.multiplier;
    const cutShares = Math.round(shares * pumpFraction * 10000) / 10000;
    const newShares = Math.round((shares - cutShares) * 10000) / 10000;
    const cutValue = cutShares * price;

    const grossAfter = grossBefore - cutValue;
    const netAfter = grossAfter - (u.marginUsed || 0);
    const equity = grossAfter > 0 ? netAfter / grossAfter : 1;

    console.log('='.repeat(70));
    console.log(`${t.name}`);
    console.log('='.repeat(70));
    console.log(`  ${t.note}`);
    console.log(`  pump share of the position   ${(pumpFraction * 100).toFixed(2)}%`);
    console.log(`  ${t.ticker} ${String(shares).padStart(12)} -> ${newShares}   (-${cutShares})`);
    console.log(`  value removed                ${m(cutValue)}`);
    console.log(`  gross (what the board shows) ${m(grossBefore)} -> ${m(grossAfter)}`);
    console.log(`  net worth                    ${m(netBefore)} -> ${m(netAfter)}`);
    console.log(`  margin debt                  ${m(u.marginUsed)}  (untouched)`);
    console.log(`  equity ratio                 ${(equity * 100).toFixed(1)}%   (liquidation at 25%)`);

    if (newShares <= 0 || equity <= LONG_MARGIN_CALL_THRESHOLD) {
      console.error('  ABORT: would trigger a margin call.\n');
      continue;
    }
    console.log('');

    if (!apply) continue;

    const now = Date.now();
    const pv = Math.round(grossAfter * 100) / 100;
    await db.collection('users').doc(t.uid).update({
      [`holdings.${t.ticker}`]: newShares,
      portfolioValue: pv,
      lastPortfolioSnapshot: { timestamp: now, value: pv },
    });
    await db.collection('users').doc(t.uid).collection('portfolioHistory').add({ timestamp: now, value: pv });
    await db.collection('adminActions').add({
      type: 'selfpump_clawback', userId: t.uid, displayName: u.displayName,
      ticker: t.ticker, sharesBefore: shares, sharesAfter: newShares,
      amount: Math.round(cutValue * 100) / 100, pumpFraction, reason: t.note,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
    console.log('  applied.\n');
  }
  console.log(apply ? 'Done.\n' : 'Dry run complete. Re-run with --confirm to apply.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
