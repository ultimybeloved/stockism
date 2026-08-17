'use strict';

// Moderation action on the Callmebot / BigBoyRandy operation.
//
//   node scripts/apply-callmebot.cjs            (dry run)
//   node scripts/apply-callmebot.cjs --confirm  (applies)
//
// 1. Moves the Discord link from BigBoyRandy to Callmebot FIRST. A ban does not
//    release discordId, and one Discord binds to one account forever, so wiping
//    BigBoyRandy while the link lives there would strand it on a dead account.
// 2. Clawback on Callmebot: the share of his GAP position that exists only
//    because BigBoyRandy's trading moved the price.
// 3. A further 20% of what remains, for exploits reported by other players.
//    Admin decision, not a measured figure — see PENALTY_NOTE.
// 4. Wipes BigBoyRandy and KitaeKim the same way Slayerr was wiped.
//
// Shares are deleted, never sold, so none of this moves the GAP price.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const CMB = 'r1O3shyooqOtVtsPMZ2aYdZ5cIg2';       // Callmebot — kept
const RANDY = 'eXKcs2LFNCR3sxHL0odaF9hWrBu2';     // BigBoyRandy — wiped
const KITAE = 'J0eFJFmUMadQbtGwtcAS1mjI46Z2';     // KitaeKim — wiped
const TICKER = 'GAP';

// Measured by scripts/alt-audit.cjs from BigBoyRandy's recorded per-trade impact.
const PUMP_CLAWBACK = 442671.79;
const EXTRA_PENALTY_RATE = 0.20;
const PENALTY_NOTE = 'Admin penalty, 20% of remaining net worth, for exploits reported '
  + 'by other players. Not derived from trade data.';
const ROLLBACK_CASH = 1000;
const BAN_REASON = 'Alt account of Callmebot (confirmed). 100% of its trading came from '
  + 'the same connection.';

const m = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function cancelOpenOrders(uid, apply) {
  const [a, b] = await Promise.all([
    db.collection('limitOrders').where('uid', '==', uid).where('status', '==', 'OPEN').get(),
    db.collection('preMarketOrders').where('uid', '==', uid).where('status', '==', 'QUEUED').get(),
  ]);
  if (!apply || (a.empty && b.empty)) return { limit: a.size, preMarket: b.size };
  const batch = db.batch();
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  a.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp }));
  b.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp }));
  await batch.commit();
  return { limit: a.size, preMarket: b.size };
}

async function wipe(uid, data, apply) {
  const now = Date.now();
  if (!apply) return;
  await db.collection('banned_users').doc(uid).set({
    uid, displayName: data.displayName,
    bannedAt: admin.firestore.FieldValue.serverTimestamp(),
    bannedBy: 'admin-script', reason: BAN_REASON,
    originalCash: data.cash, originalPortfolio: data.portfolioValue,
    rollbackCash: ROLLBACK_CASH,
  });
  await db.collection('users').doc(uid).update({
    cash: ROLLBACK_CASH, holdings: {}, shorts: {}, hasOpenShorts: false, costBasis: {},
    marginLockup: {}, ipoLockup: {},
    portfolioValue: ROLLBACK_CASH,
    lastPortfolioSnapshot: { timestamp: now, value: ROLLBACK_CASH },
    marginUsed: 0, isBanned: true,
    bannedAt: admin.firestore.FieldValue.serverTimestamp(), banReason: BAN_REASON,
  });
  await db.collection('users').doc(uid).collection('portfolioHistory').add({ timestamp: now, value: ROLLBACK_CASH });
  await cancelOpenOrders(uid, true);
}

async function main() {
  const apply = process.argv.includes('--confirm');
  const [c, r, k, mk] = await Promise.all([
    db.collection('users').doc(CMB).get(),
    db.collection('users').doc(RANDY).get(),
    db.collection('users').doc(KITAE).get(),
    db.collection('market').doc('current').get(),
  ]);
  const cmb = c.data(); const randy = r.data(); const kitae = k.data();
  const prices = (mk.data() || {}).prices || {};
  const price = prices[TICKER] || 0;

  const holdingsValue = (u) => {
    let v = 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v;
  };

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`${TICKER} price ${m(price)}\n`);

  // --- Callmebot ---
  const shares0 = (cmb.holdings || {})[TICKER] || 0;
  const hv0 = holdingsValue(cmb);
  const net0 = (cmb.cash || 0) + hv0 - (cmb.marginUsed || 0);

  const clawShares = Math.round((PUMP_CLAWBACK / price) * 10000) / 10000;
  const shares1 = Math.round((shares0 - clawShares) * 10000) / 10000;
  const hv1 = hv0 - clawShares * price;
  const net1 = (cmb.cash || 0) + hv1 - (cmb.marginUsed || 0);

  const penalty = Math.round(net1 * EXTRA_PENALTY_RATE * 100) / 100;
  const penaltyShares = Math.round((penalty / price) * 10000) / 10000;
  const shares2 = Math.round((shares1 - penaltyShares) * 10000) / 10000;
  const hv2 = hv1 - penaltyShares * price;
  const gross2 = (cmb.cash || 0) + hv2;
  const net2 = gross2 - (cmb.marginUsed || 0);
  const equity2 = gross2 > 0 ? net2 / gross2 : 0;

  console.log('--- CALLMEBOT ---');
  console.log(`  net worth now              ${m(net0)}`);
  console.log(`  ${TICKER} shares                 ${shares0}`);
  console.log(`  margin debt                ${m(cmb.marginUsed)}`);
  console.log(`  discord                    ${cmb.discordId || 'none'}`);
  console.log(`\n  1) pump clawback           -${m(PUMP_CLAWBACK)}  = ${clawShares} shares`);
  console.log(`     net worth after         ${m(net1)}`);
  console.log(`  2) admin penalty 20%       -${m(penalty)}  = ${penaltyShares} shares`);
  console.log(`     ${PENALTY_NOTE}`);
  console.log(`\n  FINAL ${TICKER} shares           ${shares2}   (was ${shares0})`);
  console.log(`  FINAL net worth            ${m(net2)}   (was ${m(net0)})`);
  console.log(`  total removed              ${m(net0 - net2)}`);
  console.log(`  equity ratio               ${(equity2 * 100).toFixed(1)}%  (liquidation at 25%)`);

  if (shares2 <= 0) { console.error('\nABORT: penalty exceeds the position.'); process.exit(1); }
  if (equity2 <= 0.30) { console.error('\nABORT: this would trigger a margin call.'); process.exit(1); }

  // --- alts ---
  console.log('\n--- ALTS TO WIPE ---');
  for (const [name, u] of [['BigBoyRandy', randy], ['KitaeKim', kitae]]) {
    console.log(`  ${name.padEnd(14)} ${m((u.cash || 0) + holdingsValue(u) - (u.marginUsed || 0))} -> ${m(ROLLBACK_CASH)}`
      + `   holdings ${m(holdingsValue(u))} deleted, margin ${m(u.marginUsed)} cleared`);
  }
  console.log(`\n  Discord ${randy.discordId} moves from BigBoyRandy to Callmebot first,`);
  console.log('  because a ban does not release the link and one Discord binds forever.');

  if (!apply) { console.log('\nDry run complete. Re-run with --confirm to apply.\n'); return; }

  // ---- writes ----
  const now = Date.now();

  // 1. Discord link first, so it is never stranded on a wiped account.
  if (randy.discordId) {
    await db.collection('users').doc(RANDY).update({ discordId: admin.firestore.FieldValue.delete() });
    await db.collection('users').doc(CMB).update({ discordId: randy.discordId });
    await db.collection('discordBindings').doc(String(randy.discordId)).set({
      uid: CMB, movedFrom: RANDY, movedAt: now, movedBy: 'admin-script',
    }, { merge: true });
    console.log('\n  Discord link moved to Callmebot.');
  }

  // 2 + 3. Both cuts in one write.
  const newPortfolioValue = Math.round(gross2 * 100) / 100;
  await db.collection('users').doc(CMB).update({
    [`holdings.${TICKER}`]: shares2,
    portfolioValue: newPortfolioValue,
    lastPortfolioSnapshot: { timestamp: now, value: newPortfolioValue },
  });
  await db.collection('users').doc(CMB).collection('portfolioHistory').add({ timestamp: now, value: newPortfolioValue });
  await db.collection('adminActions').add({
    type: 'clawback_and_penalty', userId: CMB, displayName: cmb.displayName, ticker: TICKER,
    sharesBefore: shares0, sharesAfter: shares2,
    pumpClawback: PUMP_CLAWBACK, adminPenalty: penalty, penaltyRate: EXTRA_PENALTY_RATE,
    reason: `Cross-account pumping by alt BigBoyRandy. ${PENALTY_NOTE}`,
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('  Callmebot updated.');

  // 4. Wipe the alts.
  await wipe(RANDY, randy, true);
  console.log('  BigBoyRandy wiped.');
  await wipe(KITAE, kitae, true);
  console.log('  KitaeKim wiped.');
  console.log('\nDone.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
