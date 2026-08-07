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

const { CHARACTERS, CHARACTER_MAP } = require('../functions/characters');

const TICKER = 'GUN';        // auction ticker (in the YAMA fund)
const STOP_TICKER = 'VSCO';  // stop-loss ticker (in the ALLY fund, untouched by the auction)
// Fixture for the IPO-phase check. The flag is set HERE rather than borrowed
// from characters.js: `ipoRequired` gets dropped once a stock actually launches
// (all five were cleared on 2026-08-07), and relying on it broke this check.
// Mutating the shared CHARACTER_MAP is enough — the auction reads the same
// module instance in-process.
const IPO_TICKER = 'EUNH';
if (!CHARACTER_MAP[IPO_TICKER]) throw new Error(`${IPO_TICKER} is not in characters.js`);
CHARACTER_MAP[IPO_TICKER].ipoRequired = true;

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
    // Stop-loss sweep runs on the opening prices, right after the auction.
    pm_stopper:      { cash: 0, holdings: { [STOP_TICKER]: 20 } },
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

  // A stop loss triggered by the open. Deliberately on a ticker the auction is
  // NOT pricing, and in a different fund from TICKER, so its price move and the
  // auction's stay independent and each trailing check stays exact.
  const stopBase = marketSnap.data().prices?.[STOP_TICKER];
  if (!stopBase) throw new Error(`No price for ${STOP_TICKER} — re-seed the emulator`);
  await db.collection('limitOrders').doc('pm_stop1').set({
    userId: 'pm_stopper', ticker: STOP_TICKER, type: 'STOP_LOSS',
    shares: 10, limitPrice: round2(stopBase * 1.2), // above spot -> triggers at open
    status: 'PENDING', filledShares: 0, allowPartialFills: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });
  const stopEtf = CHARACTERS.find(c => c.isETF && c.trailingFactors?.some(tf => tf.ticker === STOP_TICKER));
  if (!stopEtf) throw new Error(`${STOP_TICKER} is not in any ETF — pick a constituent`);
  const stopEtfCoefficient = stopEtf.trailingFactors.find(tf => tf.ticker === STOP_TICKER).coefficient;
  const stopEtfBefore = marketSnap.data().prices[stopEtf.ticker];

  // Parent fund of TICKER, captured before the auction so the trailing check
  // below has a baseline.
  const parentEtf = CHARACTERS.find(c => c.isETF && c.trailingFactors?.some(tf => tf.ticker === TICKER));
  if (!parentEtf) throw new Error(`${TICKER} is not in any ETF — pick a constituent`);
  const etfCoefficient = parentEtf.trailingFactors.find(tf => tf.ticker === TICKER).coefficient;
  const etfPriceBefore = (await db.collection('market').doc('current').get()).data().prices[parentEtf.ticker];

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

  // Until 2026-08-07 the auction moved only the traded ticker, so a fund whose
  // members all opened higher still opened flat.
  const etfPriceAfter = post.data().prices[parentEtf.ticker];
  const openChange = (openPrice - basePrice) / basePrice;
  const expectedEtf = round2(etfPriceBefore * (1 + openChange * etfCoefficient));
  check(`parent ETF ${parentEtf.ticker} trailed the opening cross`,
    Math.abs(etfPriceAfter - expectedEtf) < 0.011 && etfPriceAfter !== etfPriceBefore,
    `${etfPriceBefore} -> ${etfPriceAfter}, expected ~${expectedEtf}`);

  // ── Stop-loss sweep (runs on the opening prices, after the auction) ────
  check('stop loss triggered by the open filled', summary.stopLossFilled === 1 && summary.stopLossSkipped === 0, JSON.stringify(summary));
  const stopOrder = (await db.collection('limitOrders').doc('pm_stop1').get()).data();
  check('stop-loss order marked FILLED', stopOrder.status === 'FILLED' && stopOrder.filledShares === 10, JSON.stringify(stopOrder));
  const stopUser = (await db.collection('users').doc('pm_stopper').get()).data();
  check('stop-loss seller left with 10 shares and cash credited',
    stopUser.holdings[STOP_TICKER] === 10 && stopUser.cash > 0, `holdings=${stopUser.holdings[STOP_TICKER]} cash=${stopUser.cash}`);
  check('stop-loss fill tagged source=stop_loss',
    (await db.collection('trades').where('uid', '==', 'pm_stopper').get()).docs[0]?.data().source === 'stop_loss');

  // The sweep is a third fill lane and was not propagating to funds until
  // 2026-08-07 — the member dropped, its fund did not.
  const stopAfter = post.data().prices[STOP_TICKER];
  const stopEtfAfter = post.data().prices[stopEtf.ticker];
  const stopChange = (stopAfter - stopBase) / stopBase;
  const expectedStopEtf = round2(stopEtfBefore * (1 + stopChange * stopEtfCoefficient));
  check(`stop-loss sell pushed ${STOP_TICKER} down`, stopAfter < stopBase, `${stopBase} -> ${stopAfter}`);
  check(`parent ETF ${stopEtf.ticker} trailed the stop-loss fill`,
    Math.abs(stopEtfAfter - expectedStopEtf) < 0.011 && stopEtfAfter < stopEtfBefore,
    `${stopEtfBefore} -> ${stopEtfAfter}, expected ~${expectedStopEtf}`);

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
