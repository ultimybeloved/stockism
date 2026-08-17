'use strict';

// One-off moderation action, run once and kept for the audit trail.
//
//   node scripts/apply-stitch-slayerr.cjs            (dry run, writes nothing)
//   node scripts/apply-stitch-slayerr.cjs --confirm  (applies)
//
// 1. Removes from Stitch the share of his SHNG position that exists only
//    because Slayerr's trading pushed the price up.
// 2. Bans Slayerr, matching services/admin.js banUser exactly.
//
// Why a share count and not a dollar figure: Slayerr's trading raised SHNG by a
// measured 7.82%, so 1 - 1/1.0782 = 7.253% of Stitch's position is pump. That
// fraction holds no matter where the price sits when this runs, which a dollar
// amount would not. Removing shares moves no price — they are deleted, not sold.

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

const STITCH = '1VYIfEcJCiQ60S5iUeWjM1fDMDi2';
const SLAYERR = 'MY84UuCdvBWBGXTrObS97WcY4vH2';
const TICKER = 'SHNG';

// Measured by scripts/alt-audit.cjs from Slayerr's recorded per-trade impact.
const SLAYERR_PUMP_MULTIPLIER = 1.0782;
const CLAWBACK_SHARES = 498;         // 7.253% of 6864.6, rounded
const EXPECTED_STITCH_SHARES = 6864.6; // abort if he traded since the audit
const ROLLBACK_CASH = 1000;
const BAN_REASON = 'Alt account — operated alongside Stitch (admitted). '
  + 'Shared connections and 61 coordinated trades in the same stocks.';

const money = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function cancelOpenOrders(userId, apply) {
  const counts = { limit: 0, preMarket: 0 };
  const [limitSnap, preMarketSnap] = await Promise.all([
    db.collection('limitOrders').where('uid', '==', userId).where('status', '==', 'OPEN').get(),
    db.collection('preMarketOrders').where('uid', '==', userId).where('status', '==', 'QUEUED').get(),
  ]);
  counts.limit = limitSnap.size;
  counts.preMarket = preMarketSnap.size;
  if (!apply || (limitSnap.empty && preMarketSnap.empty)) return counts;

  const batch = db.batch();
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  limitSnap.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp }));
  preMarketSnap.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp }));
  await batch.commit();
  return counts;
}

const valueOf = (u, prices) => {
  let v = 0;
  for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
  return v;
};

async function main() {
  const apply = process.argv.includes('--confirm');

  const [sSnap, ySnap, mSnap] = await Promise.all([
    db.collection('users').doc(STITCH).get(),
    db.collection('users').doc(SLAYERR).get(),
    db.collection('market').doc('current').get(),
  ]);
  if (!sSnap.exists || !ySnap.exists) throw new Error('One of the accounts is missing.');

  const stitch = sSnap.data();
  const slayerr = ySnap.data();
  const prices = (mSnap.data() || {}).prices || {};
  const price = prices[TICKER] || 0;

  const heldNow = (stitch.holdings || {})[TICKER] || 0;
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`${TICKER} price now  ${money(price)}`);

  // Guard: if he has traded since the audit, the 498 figure no longer matches
  // the position it was calculated against. Recompute rather than guess.
  if (Math.abs(heldNow - EXPECTED_STITCH_SHARES) > 0.01) {
    console.error(`\nABORT: Stitch holds ${heldNow} ${TICKER}, expected ${EXPECTED_STITCH_SHARES}.`);
    console.error('He has traded since the audit. Re-run scripts/alt-audit.cjs and recompute the clawback.');
    process.exit(1);
  }

  const inflatedFraction = 1 - 1 / SLAYERR_PUMP_MULTIPLIER;
  const newShares = Math.round((heldNow - CLAWBACK_SHARES) * 10000) / 10000;

  console.log('\n--- STITCH: clawback ---');
  console.log(`  holds            ${heldNow} ${TICKER}`);
  console.log(`  Slayerr's pump   ${(inflatedFraction * 100).toFixed(3)}% of the position`);
  console.log(`  removing         ${CLAWBACK_SHARES} shares  (${money(CLAWBACK_SHARES * price)} at today's price)`);
  console.log(`  left with        ${newShares} ${TICKER}`);
  console.log(`  cost basis       ${money((stitch.costBasis || {})[TICKER] || 0)}/share — unchanged, he keeps his entry price`);

  const stitchAfterHoldings = { ...(stitch.holdings || {}), [TICKER]: newShares };
  const newHoldingsValue = valueOf({ holdings: stitchAfterHoldings }, prices);
  const newPortfolioValue = Math.round(((stitch.cash || 0) + newHoldingsValue) * 100) / 100;
  const grossAfter = (stitch.cash || 0) + newHoldingsValue;
  const equityAfter = grossAfter > 0 ? (grossAfter - (stitch.marginUsed || 0)) / grossAfter : 0;

  console.log(`  portfolioValue   ${money(stitch.portfolioValue)} -> ${money(newPortfolioValue)}`);
  console.log(`  equity ratio     ${(equityAfter * 100).toFixed(1)}%  (liquidation at 25% — safe)`);

  if (equityAfter <= 0.30) {
    console.error('\nABORT: this would put Stitch into a margin call. Not proceeding.');
    process.exit(1);
  }

  console.log('\n--- SLAYERR: ban ---');
  const slayerrHoldings = valueOf(slayerr, prices);
  console.log(`  cash             ${money(slayerr.cash)} -> ${money(ROLLBACK_CASH)}`);
  console.log(`  holdings         ${money(slayerrHoldings)} -> $0.00 (deleted, not sold — no price impact)`);
  console.log(`  ${TICKER} shares       ${(slayerr.holdings || {})[TICKER] || 0} -> 0`);
  console.log(`  margin debt      ${money(slayerr.marginUsed)} -> $0.00`);
  const orders = await cancelOpenOrders(SLAYERR, false);
  console.log(`  open orders      ${orders.limit} limit / ${orders.preMarket} pre-market -> cancelled`);

  if (!apply) {
    console.log('\nDry run complete. Re-run with --confirm to apply.\n');
    return;
  }

  // ---- writes ----
  const now = Date.now();

  await db.collection('users').doc(STITCH).update({
    [`holdings.${TICKER}`]: newShares,
    portfolioValue: newPortfolioValue,
    lastPortfolioSnapshot: { timestamp: now, value: newPortfolioValue },
  });
  await db.collection('users').doc(STITCH).collection('portfolioHistory')
    .add({ timestamp: now, value: newPortfolioValue });

  await db.collection('adminActions').add({
    type: 'clawback',
    userId: STITCH,
    displayName: stitch.displayName,
    ticker: TICKER,
    sharesRemoved: CLAWBACK_SHARES,
    sharesBefore: heldNow,
    sharesAfter: newShares,
    valueAtAction: CLAWBACK_SHARES * price,
    reason: 'Gains created by alt account Slayerr pumping SHNG (7.82% of price).',
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('\n  Stitch updated.');

  await db.collection('banned_users').doc(SLAYERR).set({
    uid: SLAYERR,
    displayName: slayerr.displayName,
    bannedAt: admin.firestore.FieldValue.serverTimestamp(),
    bannedBy: 'admin-script',
    reason: BAN_REASON,
    originalCash: slayerr.cash,
    originalPortfolio: slayerr.portfolioValue,
    rollbackCash: ROLLBACK_CASH,
  });

  await db.collection('users').doc(SLAYERR).update({
    cash: ROLLBACK_CASH,
    holdings: {},
    shorts: {},
    hasOpenShorts: false,
    costBasis: {},
    marginLockup: {},
    ipoLockup: {},
    portfolioValue: ROLLBACK_CASH,
    lastPortfolioSnapshot: { timestamp: now, value: ROLLBACK_CASH },
    marginUsed: 0,
    isBanned: true,
    bannedAt: admin.firestore.FieldValue.serverTimestamp(),
    banReason: BAN_REASON,
  });
  await db.collection('users').doc(SLAYERR).collection('portfolioHistory')
    .add({ timestamp: now, value: ROLLBACK_CASH });
  await cancelOpenOrders(SLAYERR, true);
  console.log('  Slayerr banned.');
  console.log('\nDone.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
