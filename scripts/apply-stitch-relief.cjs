'use strict';

// Softens Stitch's self-pump cut from 17.97% to 15.40%, matching Callmebot.
//
//   node scripts/apply-stitch-relief.cjs            (dry run)
//   node scripts/apply-stitch-relief.cjs --confirm  (applies)
//
// Delivered as margin forgiveness rather than by handing shares back, on
// purpose. Returning shares would put him back to owning a larger slice of
// SHNG, which is the concentration risk this whole exercise has been reducing.
// Writing off debt gives him the same value without re-arming that.
//
// Note this raises his net worth but leaves his gross unchanged, so the public
// leaderboard number does not move.

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const KEY_PATH = path.join(__dirname, '..', 'service-account-key.json');
if (!fs.existsSync(KEY_PATH)) { console.error('No service-account-key.json in the repo root.'); process.exit(1); }
admin.initializeApp({ credential: admin.credential.cert(require(KEY_PATH)) });
const db = admin.firestore();

const STITCH = '1VYIfEcJCiQ60S5iUeWjM1fDMDi2';
const APPLIED_FRACTION = 0.17966;  // what was actually taken
const TARGET_FRACTION = 0.15398;   // Callmebot's rate

const m = (n) => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

async function main() {
  const apply = process.argv.includes('--confirm');
  const [snap, mkt] = await Promise.all([
    db.collection('users').doc(STITCH).get(),
    db.collection('market').doc('current').get(),
  ]);
  const u = snap.data();
  const prices = (mkt.data() || {}).prices || {};
  const price = prices.SHNG || 0;

  const sharesNow = (u.holdings || {}).SHNG || 0;
  const sharesBeforeCut = sharesNow / (1 - APPLIED_FRACTION);
  const sharesAtTarget = sharesBeforeCut * (1 - TARGET_FRACTION);
  const relief = Math.round((sharesAtTarget - sharesNow) * price * 100) / 100;

  const marginBefore = u.marginUsed || 0;
  const marginAfter = Math.round((marginBefore - relief) * 100) / 100;

  let hv = 0;
  for (const [t, s] of Object.entries(u.holdings || {})) if (s > 0) hv += (prices[t] || 0) * s;
  const gross = (u.cash || 0) + hv;

  console.log(`\n${apply ? 'APPLYING' : 'DRY RUN — nothing will be written'}\n`);
  console.log(`  cut applied was          ${(APPLIED_FRACTION * 100).toFixed(2)}%`);
  console.log(`  matching Callmebot at    ${(TARGET_FRACTION * 100).toFixed(2)}%`);
  console.log(`  difference in value      ${m(relief)}`);
  console.log(`\n  margin debt              ${m(marginBefore)} -> ${m(marginAfter)}`);
  console.log(`  gross (public board)     ${m(gross)}  unchanged`);
  console.log(`  net worth                ${m(gross - marginBefore)} -> ${m(gross - marginAfter)}`);
  console.log(`  equity ratio             ${(((gross - marginBefore) / gross) * 100).toFixed(1)}% -> ${(((gross - marginAfter) / gross) * 100).toFixed(1)}%`);
  console.log(`  SHNG position            ${sharesNow} shares, untouched`);

  if (marginAfter < 0) { console.error('\n  ABORT: relief exceeds the debt.'); process.exit(1); }
  if (!apply) { console.log('\nDry run complete. Re-run with --confirm to apply.\n'); return; }

  const now = Date.now();
  await db.collection('users').doc(STITCH).update({ marginUsed: marginAfter });
  await db.collection('users').doc(STITCH).collection('portfolioHistory')
    .add({ timestamp: now, value: Math.round(gross * 100) / 100 });
  await db.collection('adminActions').add({
    type: 'margin_relief', userId: STITCH, displayName: u.displayName,
    amount: relief, marginBefore, marginAfter,
    reason: `Softens the self-pump clawback from ${(APPLIED_FRACTION * 100).toFixed(2)}% to `
      + `${(TARGET_FRACTION * 100).toFixed(2)}%, matching Callmebot. Given as debt forgiveness `
      + 'rather than shares so his stake in SHNG does not grow back.',
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('\n  Applied.\n');
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
