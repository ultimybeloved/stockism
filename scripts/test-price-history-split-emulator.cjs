'use strict';
// End-to-end test of the price-history split against the LOCAL Firebase
// emulator. Never touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   firebase emulators:exec --config firebase.emulator-test.json --only firestore \
//     "node scripts/test-price-history-split-emulator.cjs"
//
// Covers:
//   1. executeTrade writes the price to market/current and the chart point to
//      market/priceHistory — and never re-creates the old priceHistory field.
//   2. Points only ever accumulate (buy + sell append, nothing is removed).
//   3. applyDueIPOJumps launches an ended IPO and appends its jump point to
//      the new doc.
//   4. migratePriceHistoryDoc copies a legacy market/current.priceHistory
//      field into the new doc, and finalize deletes the old field only after
//      verifying every point made it.
//   5. archivePriceHistory moves (never deletes) overflow points to the
//      permanent per-ticker archive: total point count is preserved.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

// Modules loaded AFTER admin.initializeApp so their top-level admin.firestore() binds to the emulator.
const { executeTrade } = require('../functions/services/trading');
const { migratePriceHistoryDoc } = require('../functions/services/adminOps');
const { archivePriceHistory } = require('../functions/services/archiving');
const { applyDueIPOJumps } = require('../functions/helpers');
const { ADMIN_UID } = require('../functions/constants');

const DAY = 24 * 60 * 60 * 1000;
const NORMAL = 'GUN';
const IPO = 'EUNH';

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};

const ctx = (uid) => ({ auth: { uid }, rawRequest: { ip: '203.0.113.9' } });
const ok = (fn, data, uid) => fn.run(data, ctx(uid));

const getMarket = async () => (await db.collection('market').doc('current').get()).data();
const getHist = async () => (await db.collection('market').doc('priceHistory').get()).data() || {};

async function seed() {
  const now = Date.now();
  await db.collection('market').doc('current').set({
    prices: { [NORMAL]: 25 },
    launchedTickers: [NORMAL],
    marketHalted: false,
    haltedTickers: {},
  });
  await db.collection('market').doc('priceHistory').set({
    [NORMAL]: [{ timestamp: now - DAY, price: 24 }, { timestamp: now - 1000, price: 25 }],
  });
  await db.collection('market').doc('ipos').set({
    list: [{
      ticker: IPO, basePrice: 10,
      ipoStartsAt: now - 2 * DAY, ipoEndsAt: now - DAY, // already ended → jump due
      sharesRemaining: 100, totalShares: 150, priceJumped: false,
    }],
  });
  await db.collection('users').doc('trader1').set({
    displayName: 'trader1', cash: 5000, holdings: {}, costBasis: {},
    portfolioValue: 5000, totalTrades: 0, achievements: [],
    createdAt: Date.now() - 90 * DAY,
  });
}

async function testTradeAppends() {
  console.log('\n1+2 — executeTrade appends to the new doc, old field never returns');
  const histBefore = (await getHist())[NORMAL].length;

  await ok(executeTrade, { ticker: NORMAL, action: 'buy', amount: 10 }, 'trader1');
  let market = await getMarket();
  let hist = await getHist();
  check('buy moved the price on market/current', market.prices[NORMAL] > 25, `price=${market.prices[NORMAL]}`);
  check('buy appended a chart point to market/priceHistory', hist[NORMAL].length === histBefore + 1, `len=${hist[NORMAL].length}`);
  check('market/current has NO priceHistory field', market.priceHistory === undefined, JSON.stringify(Object.keys(market)));

  await new Promise(r => setTimeout(r, 3500)); // per-user trade cooldown
  // Backdate the buy so the 45s hold period doesn't block the sell
  await db.collection('users').doc('trader1').update({ [`lastBuyTime.${NORMAL}`]: Date.now() - 60000 });
  await ok(executeTrade, { ticker: NORMAL, action: 'sell', amount: 5 }, 'trader1');
  hist = await getHist();
  market = await getMarket();
  check('sell appended another point (nothing removed)', hist[NORMAL].length === histBefore + 2, `len=${hist[NORMAL].length}`);
  check('points are the permanent record (monotonic growth)', hist[NORMAL].every((p, i, a) => i === 0 || a[i - 1].timestamp <= p.timestamp), 'out of order');
  check('old field still absent after sell', market.priceHistory === undefined);
}

async function testIPOJump() {
  console.log('\n3 — applyDueIPOJumps writes the jump point to the new doc');
  await applyDueIPOJumps();
  const market = await getMarket();
  const hist = await getHist();
  check('IPO launched', (market.launchedTickers || []).includes(IPO), JSON.stringify(market.launchedTickers));
  check('IPO price set on market/current', market.prices[IPO] === 11.5, `price=${market.prices[IPO]}`);
  check('IPO jump point in market/priceHistory', (hist[IPO] || []).length === 1 && hist[IPO][0].price === 11.5, JSON.stringify(hist[IPO]));
  check('old field still absent', market.priceHistory === undefined);
}

async function testMigration() {
  console.log('\n4 — migratePriceHistoryDoc copy → verify → finalize');
  // Simulate the legacy layout: an old priceHistory field on market/current
  const now = Date.now();
  const legacy = {
    LEGACY1: [{ timestamp: now - 3 * DAY, price: 50 }, { timestamp: now - 2 * DAY, price: 55 }],
    LEGACY2: [{ timestamp: now - DAY, price: 12 }],
  };
  await db.collection('market').doc('current').update({ priceHistory: legacy });

  const gunBefore = ((await getHist())[NORMAL] || []).length;
  const copyRes = await ok(migratePriceHistoryDoc, {}, ADMIN_UID);
  check('copy reports all legacy points copied', copyRes.copied === true && copyRes.sourcePoints === 3, JSON.stringify(copyRes));
  const hist = await getHist();
  check('legacy tickers landed in the new doc', (hist.LEGACY1 || []).length === 2 && (hist.LEGACY2 || []).length === 1, JSON.stringify(Object.keys(hist)));
  check('copy MERGED — pre-existing new-doc points survived', (hist[NORMAL] || []).length === gunBefore, `${(hist[NORMAL] || []).length} vs ${gunBefore}`);

  const finRes = await ok(migratePriceHistoryDoc, { finalize: true }, ADMIN_UID);
  const market = await getMarket();
  check('finalize deleted the old field', finRes.finalized === true && market.priceHistory === undefined, JSON.stringify(finRes));
  const histAfter = await getHist();
  check('new doc untouched by finalize', (histAfter.LEGACY1 || []).length === 2, JSON.stringify(Object.keys(histAfter)));
}

async function testArchivePreservesEverything() {
  console.log('\n5 — archiving moves overflow points, total count preserved');
  const now = Date.now();
  const many = [];
  for (let i = 0; i < 1005; i++) many.push({ timestamp: now - (1005 - i) * 60000, price: 20 + (i % 10) });
  await db.collection('market').doc('priceHistory').update({ BIGT: many });

  await ok(archivePriceHistory, {}, ADMIN_UID);

  const hist = await getHist();
  const archive = (await db.collection('market').doc('current')
    .collection('price_history').doc('BIGT').get()).data() || {};
  const liveCount = (hist.BIGT || []).length;
  const archCount = (archive.history || []).length;
  check('live doc trimmed to 1000', liveCount === 1000, `live=${liveCount}`);
  check('overflow moved to permanent archive (5 points)', archCount === 5, `arch=${archCount}`);
  check('TOTAL points preserved (nothing deleted)', liveCount + archCount === 1005, `${liveCount}+${archCount}`);
}

async function main() {
  await seed();
  await testTradeAppends();
  await testIPOJump();
  await testMigration();
  await testArchivePreservesEverything();

  console.log(failures === 0 ? '\n✅ ALL PRICE-HISTORY SPLIT TESTS PASSED' : `\n❌ ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
