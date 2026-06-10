'use strict';
// End-to-end test of the pre-market opening auction against the LOCAL
// Firebase emulator. Never touches production (FIRESTORE_EMULATOR_HOST).
//
// Run with the emulators started and the market seeded:
//   npm run emulators        (terminal 1)
//   npm run seed:emulator    (once)
//   node scripts/test-premarket-emulator.cjs
//
// Scenarios covered:
//   1. Normal buy fills at the opening ask
//   2. Zero-cash "phantom" buy fails and does NOT move the opening price
//   3. Sell fills at the opening bid
//   4. Buy bigger than cash partial-fills (clamped, not failed)
//   5. Order on an unlaunched IPO ticker fails with a clear reason
//   6. Week-old stranded order gets EXPIRED
//   7. No PENDING pre-market orders remain afterward

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

// Use the SAME firebase-admin instance the functions code resolves
// (functions/node_modules), or its initializeApp won't be visible there.
const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { runMarketOpenProcessing } = require('../functions/services/marketOrders');
const { calculateMarginalImpact } = require('../functions/helpers');
const { BID_ASK_SPREAD } = require('../functions/constants');

const TICKER = 'GUN';
const IPO_TICKER = 'EUNH'; // ipoRequired: true in characters.js, not launched in seed

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};
const round2 = (n) => Math.round(n * 100) / 100;

async function main() {
  const marketSnap = await db.collection('market').doc('current').get();
  if (!marketSnap.exists) throw new Error('Market doc missing — run npm run seed:emulator first');
  const basePrice = marketSnap.data().prices?.[TICKER];
  if (!basePrice) throw new Error(`No price for ${TICKER} — re-seed the emulator`);
  console.log(`Base price for ${TICKER}: $${basePrice}`);

  // ── Seed users ─────────────────────────────────────────────────────────
  const users = {
    pm_richBuyer:    { cash: 100000, holdings: {} },
    pm_phantom:      { cash: 0, holdings: {} },
    pm_seller:       { cash: 0, holdings: { [TICKER]: 30 } },
    pm_partialBuyer: { cash: round2(10 * basePrice), holdings: {} },
    pm_staleUser:    { cash: 1000, holdings: {} },
    pm_ipoUser:      { cash: 5000, holdings: {} },
  };
  for (const [uid, data] of Object.entries(users)) {
    await db.collection('users').doc(uid).set({ displayName: uid, ...data });
  }

  // ── Seed pre-market orders ─────────────────────────────────────────────
  const now = admin.firestore.Timestamp.now();
  const eightDaysAgo = admin.firestore.Timestamp.fromMillis(Date.now() - 8 * 24 * 60 * 60 * 1000);
  const orders = [
    { id: 'pm_t1', userId: 'pm_richBuyer',    ticker: TICKER, action: 'buy',  shares: 50,   createdAt: now },
    { id: 'pm_t2', userId: 'pm_phantom',      ticker: TICKER, action: 'buy',  shares: 5000, createdAt: now },
    { id: 'pm_t3', userId: 'pm_seller',       ticker: TICKER, action: 'sell', shares: 30,   createdAt: now },
    { id: 'pm_t4', userId: 'pm_partialBuyer', ticker: TICKER, action: 'buy',  shares: 100,  createdAt: now },
    { id: 'pm_t5', userId: 'pm_staleUser',    ticker: TICKER, action: 'buy',  shares: 5,    createdAt: eightDaysAgo },
    { id: 'pm_t6', userId: 'pm_ipoUser',      ticker: IPO_TICKER, action: 'buy', shares: 5, createdAt: now },
  ];
  for (const o of orders) {
    const { id, ...rest } = o;
    await db.collection('preMarketOrders').doc(id).set({
      ...rest, status: 'PENDING', allowPartialFills: false,
      executedAt: null, executedPrice: null, filledShares: null
    });
  }

  // ── Run the auction ────────────────────────────────────────────────────
  console.log('\nRunning runMarketOpenProcessing...\n');
  const summary = await runMarketOpenProcessing('test');
  console.log('Summary:', JSON.stringify(summary), '\n');

  // ── Expected opening price: only fillable demand moves it ──────────────
  // richBuyer 50 + partialBuyer ~10 fillable - seller 30 ≈ net +30. The
  // phantom 5000-share order must contribute nothing.
  const estAsk = basePrice * (1 + BID_ASK_SPREAD / 2);
  const partialFillable = Math.floor(users.pm_partialBuyer.cash / estAsk * 100) / 100;
  const netDemand = 50 + partialFillable - 30;
  const expectedOpen = round2(Math.min(basePrice + calculateMarginalImpact(basePrice, netDemand, 0), basePrice * 1.05));
  const phantomCapOpen = round2(basePrice * 1.05); // where the price would land if the 5000-share phantom counted

  const post = await db.collection('market').doc('current').get();
  const openPrice = post.data().prices[TICKER];
  check(`opening price excludes phantom demand (got $${openPrice}, expected $${expectedOpen}, phantom would force $${phantomCapOpen})`,
    Math.abs(openPrice - expectedOpen) < 0.011 && openPrice < phantomCapOpen, `open=${openPrice}`);

  const get = async (id) => (await db.collection('preMarketOrders').doc(id).get()).data();

  const t1 = await get('pm_t1');
  const askPrice = round2(openPrice * (1 + BID_ASK_SPREAD / 2));
  check(`rich buyer FILLED at opening ask ($${askPrice})`, t1.status === 'FILLED' && Math.abs(t1.executedPrice - askPrice) < 0.011, JSON.stringify(t1));
  const richUser = (await db.collection('users').doc('pm_richBuyer').get()).data();
  check('rich buyer holdings = 50 and cash deducted', richUser.holdings[TICKER] === 50 && Math.abs(richUser.cash - (100000 - t1.executedPrice * 50)) < 0.02, `cash=${richUser.cash}`);
  check('rich buyer lastBuyTime set (45s hold applies at open)', !!richUser.lastBuyTime?.[TICKER], JSON.stringify(richUser.lastBuyTime || {}));

  const t2 = await get('pm_t2');
  check('phantom zero-cash buy FAILED with Insufficient cash', t2.status === 'FAILED' && /Insufficient cash/.test(t2.failReason || ''), JSON.stringify(t2));

  const t3 = await get('pm_t3');
  check('sell FILLED at opening bid', t3.status === 'FILLED' && t3.filledShares === 30, JSON.stringify(t3));
  const sellerUser = (await db.collection('users').doc('pm_seller').get()).data();
  check('seller holdings cleared and cash credited', !sellerUser.holdings?.[TICKER] && sellerUser.cash > 0, `cash=${sellerUser.cash}`);

  const t4 = await get('pm_t4');
  check('oversized buy PARTIALLY_FILLED (clamped to cash, not failed)',
    t4.status === 'PARTIALLY_FILLED' && t4.filledShares > 0 && t4.filledShares < 100, JSON.stringify(t4));

  const t5 = await get('pm_t5');
  check('week-old stranded order EXPIRED', t5.status === 'EXPIRED', JSON.stringify(t5));

  const t6 = await get('pm_t6');
  check('unlaunched IPO ticker order FAILED with IPO reason', t6.status === 'FAILED' && /IPO/.test(t6.failReason || ''), JSON.stringify(t6));

  const leftover = await db.collection('preMarketOrders').where('status', '==', 'PENDING').get();
  check('no PENDING pre-market orders remain', leftover.empty, `${leftover.size} left`);

  console.log(failures === 0 ? '\nALL PRE-MARKET E2E CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('Test crashed:', err); process.exit(1); });
