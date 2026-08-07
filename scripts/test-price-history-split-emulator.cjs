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
// No migratePriceHistoryDoc import: that was a one-time migration off the
// legacy priceHistory field on market/current. It ran, the callable was
// deleted from adminOps.js, and the section testing it was removed here.
const { archivePriceHistory } = require('../functions/services/archiving');
const { applyDueIPOJumps } = require('../functions/helpers');
const { ADMIN_UID, PRICE_HISTORY_LIVE_MAX } = require('../functions/constants');

// Comfortably more points than the live cap, so archiving has real overflow to move.
const SEEDED_POINTS = PRICE_HISTORY_LIVE_MAX + 945;

const { CHARACTER_MAP } = require('../functions/characters');

const DAY = 24 * 60 * 60 * 1000;
const NORMAL = 'GUN';
// Gated fixture. The flag is set HERE rather than borrowed from characters.js:
// `ipoRequired` gets dropped once a stock actually launches (all five were
// cleared on 2026-08-07), and relying on it silently disables the IPO checks.
const IPO = 'EUNH';
if (!CHARACTER_MAP[IPO]) throw new Error(`${IPO} is not in characters.js`);
CHARACTER_MAP[IPO].ipoRequired = true;

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

// REMOVED: the migratePriceHistoryDoc section. That was a one-time migration
// off the legacy priceHistory field on market/current; it ran, and the callable
// was deleted from adminOps.js afterwards. The test kept calling it, which
// crashed the run and took sections 4 and 5 down with it.
async function testArchivePreservesEverything() {
  console.log('\n5 — archiving moves overflow points, total count preserved');
  const now = Date.now();
  const many = [];
  for (let i = 0; i < SEEDED_POINTS; i++) many.push({ timestamp: now - (SEEDED_POINTS - i) * 60000, price: 20 + (i % 10) });
  await db.collection('market').doc('priceHistory').update({ BIGT: many });

  await ok(archivePriceHistory, {}, ADMIN_UID);

  const hist = await getHist();
  const archive = (await db.collection('market').doc('current')
    .collection('price_history').doc('BIGT').get()).data() || {};
  const liveCount = (hist.BIGT || []).length;
  const archCount = (archive.history || []).length;
  // Read the cap from constants rather than hardcoding it: it was 1000 until
  // the doc hit Firestore's 40k index-entry limit and took trading down on
  // 2026-07-22, and this check still expected 1000 long after it became 60.
  const overflow = SEEDED_POINTS - PRICE_HISTORY_LIVE_MAX;
  check(`live doc trimmed to the cap (${PRICE_HISTORY_LIVE_MAX})`, liveCount === PRICE_HISTORY_LIVE_MAX, `live=${liveCount}`);
  check(`overflow moved to permanent archive (${overflow} points)`, archCount === overflow, `arch=${archCount}`);
  check('TOTAL points preserved (nothing deleted)', liveCount + archCount === SEEDED_POINTS, `${liveCount}+${archCount}`);
}

async function main() {
  await seed();
  await testTradeAppends();
  await testIPOJump();
  await testArchivePreservesEverything();

  console.log(failures === 0 ? '\n✅ ALL PRICE-HISTORY SPLIT TESTS PASSED' : `\n❌ ${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test run failed:', err);
  process.exit(1);
});
