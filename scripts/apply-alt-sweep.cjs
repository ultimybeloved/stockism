'use strict';

// Batch moderation sweep across the confirmed alt operations.
//
//   node scripts/apply-alt-sweep.cjs            (dry run)
//   node scripts/apply-alt-sweep.cjs --confirm  (applies)
//
// For each operation:
//   1. Work out how much of the MAIN account's holdings exist only because its
//      ALT accounts' trading moved those prices. Same method as alt-audit.cjs:
//      every trade stores the fraction it moved the price, so chaining the alts'
//      trades gives the exact multiplier they applied. Divide the live price by
//      it for the counterfactual.
//   2. Remove that value from the main as shares. Shares are deleted, not sold,
//      so no price moves and no other player is touched.
//   3. Wipe every alt the same way Slayerr was wiped.
//   4. Refuse to act if a cut would drop the main into a margin call, since a
//      forced liquidation would dump the position into the market and cause
//      exactly the damage this is avoiding.
//
// Stitch is handled separately below: his cut is an admin decision (20% plus the
// ladder tax he never paid), not a measured pump figure.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const ROLLBACK_CASH = 1000;
const LONG_MARGIN_CALL_THRESHOLD = 0.30;
const UP = { buy: true, cover: true, sell: false, short: false };

// Stitch: admin decision, see the conversation. 20% of net worth plus the ladder
// bracket tax he never paid on $1,662,015 of ladder profit.
const STITCH_UID = '1VYIfEcJCiQ60S5iUeWjM1fDMDi2';
const STITCH_FLAT_CUT = 2096868.17;
const STITCH_NOTE = 'Admin penalty: 20% of net worth for alt operation, plus $739,165.65 '
  + 'retroactive ladder withdrawal tax on $1,662,015 of untaxed ladder profit.';

const OPS = [
  { main: 'KingSlare', renameTo: 'GunGlazer',
    alts: ['StitchsGaySon', 'Gyatt', 'DeadMenTellNoTails', 'GunGooner', 'PaecheonStan', 'Sai', 'Glazer', 'SAMSLASH'] },
  { main: 'Ayin',
    alts: ['Whipzookxxl', 'Aaa', 'Yorduranwa', 'test', 'Bleh', 'Quilliamwoolas', 'Godreaper'] },
  { main: '.unk_b', alts: ['ThisAccIsForLadder'] },
  { main: 'Versus', alts: ['drhayren'] },
  { main: 'Zyrefw', alts: ['Zyref'] },
];

const m = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BAN_REASON = (owner) => `Alt account of ${owner}. Nearly all of its trading came from `
  + `${owner}'s connections.`;

async function cancelOpenOrders(uid, apply) {
  const [a, b] = await Promise.all([
    db.collection('limitOrders').where('uid', '==', uid).where('status', '==', 'OPEN').get(),
    db.collection('preMarketOrders').where('uid', '==', uid).where('status', '==', 'QUEUED').get(),
  ]);
  if (!apply || (a.empty && b.empty)) return a.size + b.size;
  const batch = db.batch();
  const stamp = admin.firestore.FieldValue.serverTimestamp();
  a.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp }));
  b.docs.forEach((d) => batch.update(d.ref, { status: 'CANCELED', cancelReason: 'Account is banned', updatedAt: stamp }));
  await batch.commit();
  return a.size + b.size;
}

async function wipe(uid, data, owner) {
  const now = Date.now();
  await db.collection('banned_users').doc(uid).set({
    uid, displayName: data.displayName,
    bannedAt: admin.firestore.FieldValue.serverTimestamp(),
    bannedBy: 'admin-script', reason: BAN_REASON(owner),
    originalCash: data.cash, originalPortfolio: data.portfolioValue, rollbackCash: ROLLBACK_CASH,
  });
  await db.collection('users').doc(uid).update({
    cash: ROLLBACK_CASH, holdings: {}, shorts: {}, hasOpenShorts: false, costBasis: {},
    marginLockup: {}, ipoLockup: {},
    portfolioValue: ROLLBACK_CASH,
    lastPortfolioSnapshot: { timestamp: now, value: ROLLBACK_CASH },
    marginUsed: 0, isBanned: true,
    bannedAt: admin.firestore.FieldValue.serverTimestamp(), banReason: BAN_REASON(owner),
  });
  await db.collection('users').doc(uid).collection('portfolioHistory').add({ timestamp: now, value: ROLLBACK_CASH });
  await cancelOpenOrders(uid, true);
}

async function rename(uid, oldLower, newName) {
  const lower = newName.toLowerCase();
  const ref = db.collection('usernames').doc(lower);
  const existing = await ref.get();
  if (existing.exists && existing.data().uid !== uid) {
    console.error(`    SKIPPED rename: "${newName}" is taken by someone else`);
    return false;
  }
  if (oldLower) await db.collection('usernames').doc(oldLower).delete().catch(() => {});
  await ref.set({ uid, createdAt: admin.firestore.FieldValue.serverTimestamp() });
  await db.collection('users').doc(uid).update({
    displayName: newName, displayNameLower: lower,
    nameChangedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return true;
}

async function main() {
  const apply = process.argv.includes('--confirm');
  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);

  const [usersSnap, mkt] = await Promise.all([
    db.collection('users').select('displayName', 'displayNameLower', 'cash', 'holdings', 'costBasis',
      'marginUsed', 'portfolioValue', 'isBanned', 'discordId').get(),
    db.collection('market').doc('current').get(),
  ]);
  const prices = (mkt.data() || {}).prices || {};
  const U = new Map(); const byName = new Map();
  usersSnap.forEach((d) => { U.set(d.id, d.data()); byName.set((d.data().displayName || '').toLowerCase(), d.id); });

  const hv = (u) => {
    let v = 0;
    for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) v += (prices[t] || 0) * s;
    return v;
  };
  const net = (u) => (u.cash || 0) + hv(u) - (u.marginUsed || 0);

  let totalRemoved = 0; let totalWiped = 0;

  // ---------- the measured operations ----------
  for (const op of OPS) {
    const mainId = byName.get(op.main.toLowerCase());
    if (!mainId) { console.error(`SKIP: no account named ${op.main}`); continue; }
    const main = U.get(mainId);
    const altIds = op.alts.map((n) => byName.get(n.toLowerCase())).filter(Boolean);

    console.log('='.repeat(74));
    console.log(`${op.main}   ${m(net(main))}   ${altIds.length} alts`);
    console.log('='.repeat(74));

    // Every trade the alts ever made, grouped by ticker.
    const altTrades = new Map();
    for (const a of altIds) {
      const snap = await db.collection('trades').where('uid', '==', a).get();
      snap.forEach((d) => {
        const t = d.data();
        if (!t.ticker) return;
        if (!altTrades.has(t.ticker)) altTrades.set(t.ticker, []);
        altTrades.get(t.ticker).push(t);
      });
    }

    let clawback = 0;
    const lines = [];
    for (const [ticker, shares] of Object.entries(main.holdings || {})) {
      if (!(shares > 0)) continue;
      const ts = altTrades.get(ticker);
      if (!ts || !ts.length) continue;
      let mult = 1;
      for (const t of ts) {
        const imp = Number(t.priceImpact) || 0;
        const dir = UP[(t.action || '').toLowerCase()];
        if (imp && dir !== undefined) mult *= dir ? 1 + imp : 1 - imp;
      }
      if (mult <= 0) continue;
      const live = prices[ticker] || 0;
      const per = live - live / mult;
      const value = per * shares;
      if (Math.abs(value) < 1) continue;
      clawback += value;
      lines.push(`    ${ticker.padEnd(6)} alts moved it ${((mult - 1) * 100).toFixed(1)}%  ->  ${m(value)} of ${op.main}'s position`);
    }
    clawback = Math.round(Math.max(0, clawback) * 100) / 100;

    if (lines.length) lines.forEach((l) => console.log(l));
    else console.log('    alts never traded anything the main still holds — no clawback');

    // Take it out of the largest position, which is where the pump landed.
    const positions = Object.entries(main.holdings || {})
      .filter(([, s]) => s > 0).sort((a, b) => (prices[b[0]] || 0) * b[1] - (prices[a[0]] || 0) * a[1]);
    const [topTicker] = positions[0] || [];
    let newShares = null; let newNet = net(main); let equity = 1;
    if (clawback > 0 && topTicker) {
      const price = prices[topTicker];
      const cut = Math.round((clawback / price) * 10000) / 10000;
      newShares = Math.round(((main.holdings[topTicker]) - cut) * 10000) / 10000;
      const newHv = hv(main) - cut * price;
      const gross = (main.cash || 0) + newHv;
      newNet = gross - (main.marginUsed || 0);
      equity = gross > 0 ? newNet / gross : 1;
      console.log(`\n    clawback ${m(clawback)} = ${cut} ${topTicker} shares`);
      console.log(`    ${op.main}: ${m(net(main))} -> ${m(newNet)}   equity ${(equity * 100).toFixed(1)}%`);
      if (newShares < 0 || equity <= LONG_MARGIN_CALL_THRESHOLD) {
        console.error('    ABORT this op: would force a margin call.');
        continue;
      }
    }
    if (op.renameTo) console.log(`\n    rename: ${op.main} -> ${op.renameTo}`);

    console.log('\n    alts to wipe:');
    for (const a of altIds) {
      const u = U.get(a);
      console.log(`      ${(u.displayName || a).padEnd(22)} ${m(net(u)).padStart(13)} -> ${m(ROLLBACK_CASH)}`
        + `${u.isBanned ? '   (already banned)' : ''}`);
    }
    console.log('');

    if (!apply) continue;

    if (clawback > 0 && topTicker) {
      const now = Date.now();
      const pv = Math.round(((main.cash || 0) + hv(main) - clawback) * 100) / 100;
      await db.collection('users').doc(mainId).update({
        [`holdings.${topTicker}`]: newShares,
        portfolioValue: pv,
        lastPortfolioSnapshot: { timestamp: now, value: pv },
      });
      await db.collection('users').doc(mainId).collection('portfolioHistory').add({ timestamp: now, value: pv });
      await db.collection('adminActions').add({
        type: 'clawback', userId: mainId, displayName: main.displayName, ticker: topTicker,
        amount: clawback, alts: op.alts,
        reason: `Price movement created by alt accounts: ${op.alts.join(', ')}`,
        at: admin.firestore.FieldValue.serverTimestamp(),
      });
      totalRemoved += clawback;
    }
    for (const a of altIds) {
      const u = U.get(a);
      if (u.isBanned) continue;
      await wipe(a, u, op.main);
      totalWiped++;
    }
    if (op.renameTo) await rename(mainId, main.displayNameLower, op.renameTo);
    console.log('    applied.\n');
  }

  // ---------- Stitch: flat admin penalty ----------
  const stitch = U.get(STITCH_UID);
  console.log('='.repeat(74));
  console.log(`Stitch   ${m(net(stitch))}   admin penalty`);
  console.log('='.repeat(74));
  console.log(`    ${STITCH_NOTE}`);
  const sPositions = Object.entries(stitch.holdings || {})
    .filter(([, s]) => s > 0).sort((a, b) => (prices[b[0]] || 0) * b[1] - (prices[a[0]] || 0) * a[1]);
  const [sTicker] = sPositions[0];
  const sPrice = prices[sTicker];
  const sCut = Math.round((STITCH_FLAT_CUT / sPrice) * 10000) / 10000;
  const sNewShares = Math.round((stitch.holdings[sTicker] - sCut) * 10000) / 10000;
  const sHv = hv(stitch) - sCut * sPrice;
  const sGross = (stitch.cash || 0) + sHv;
  const sNet = sGross - (stitch.marginUsed || 0);
  const sEquity = sGross > 0 ? sNet / sGross : 1;
  console.log(`    -${m(STITCH_FLAT_CUT)} = ${sCut} ${sTicker} shares`);
  console.log(`    ${sTicker}: ${stitch.holdings[sTicker]} -> ${sNewShares}`);
  console.log(`    net worth: ${m(net(stitch))} -> ${m(sNet)}   equity ${(sEquity * 100).toFixed(1)}%`);
  if (sEquity <= LONG_MARGIN_CALL_THRESHOLD) { console.error('    ABORT: margin call.'); }
  else if (apply) {
    const now = Date.now();
    const pv = Math.round(sGross * 100) / 100;
    await db.collection('users').doc(STITCH_UID).update({
      [`holdings.${sTicker}`]: sNewShares,
      portfolioValue: pv,
      lastPortfolioSnapshot: { timestamp: now, value: pv },
    });
    await db.collection('users').doc(STITCH_UID).collection('portfolioHistory').add({ timestamp: now, value: pv });
    await db.collection('adminActions').add({
      type: 'admin_penalty', userId: STITCH_UID, displayName: stitch.displayName,
      ticker: sTicker, amount: STITCH_FLAT_CUT, reason: STITCH_NOTE,
      at: admin.firestore.FieldValue.serverTimestamp(),
    });
    totalRemoved += STITCH_FLAT_CUT;
    console.log('    applied.');
  }

  console.log('\n' + '='.repeat(74));
  console.log(`${apply ? 'DONE' : 'DRY RUN'} — ${m(totalRemoved)} removed, ${totalWiped} accounts wiped`);
  console.log('No price moved. Shares were deleted, never sold.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
