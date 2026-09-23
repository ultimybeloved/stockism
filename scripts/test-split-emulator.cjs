// End-to-end stock split against the LOCAL Firebase emulator. Never touches
// production.
//
//   npm run test:split
//
// Seeds a stock the way the live game stores it (price, chart history, daily
// closes, index entry, holders with dividend lots, a short, an open order, an
// alert, trade records, IP tracking), splits it 10-for-1, and checks that
// nobody's money moved, the index didn't move, a real trade afterwards moves
// the price by the same percent as before, and a run can pause, resume, and
// never be applied twice.
//
// The deploy is simulated in-process: CHARACTER_MAP.SOPH gets the splitFactor
// that src/characters.js would carry after the edit.

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8085';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';
process.env.ADMIN_DISCORD_USER_ID = '';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const { splitStock } = require('../functions/services/adminMigrate');
const { runSplit, PHASES } = require('../functions/services/stockSplit');
const { executeTrade } = require('../functions/services/trading');
const { exitEquityAt } = require('../functions/helpers');
const { CHARACTER_MAP } = require('../functions/characters');
const { ADMIN_UID, isWeeklyTradingHalt } = require('../functions/constants');

const T = 'SOPH';
const N = 10;
const adminCtx = { auth: { uid: ADMIN_UID } };
const DAY = 86400000;

let failures = 0;
const check = (name, cond, detail) => {
  if (cond) console.log(`  ok   ${name}`);
  else { failures++; console.log(`  FAIL ${name}${detail !== undefined ? ` -> ${JSON.stringify(detail)}` : ''}`); }
};
const close = (a, b, eps = 0.01) => typeof a === 'number' && Math.abs(a - b) <= eps;
const user = async (uid) => (await db.collection('users').doc(uid).get()).data();
const market = async () => (await db.collection('market').doc('current').get()).data();
const ts = (ms) => admin.firestore.Timestamp.fromMillis(ms);
const ctx = (uid) => ({ auth: { uid }, rawRequest: { ip: `198.51.100.${Math.floor(Math.random() * 200)}` } });
const indexSum = async () => {
  const [m, idx] = await Promise.all([market(), db.collection('market').doc('indexHistory').get()]);
  return idx.data().constituents.reduce((s, c) => s + (m.prices[c.t] ?? c.b) / c.b, 0);
};

const seed = async () => {
  const now = Date.now();
  const base = CHARACTER_MAP[T].basePrice;
  await db.collection('market').doc('current').set({
    prices: { [T]: 200, CROC: 66 }, ath: { [T]: 250 }, atl: { [T]: 60 },
    launchedTickers: [], marketHalted: false, haltedTickers: {},
  });
  await db.collection('market').doc('priceHistory').set({
    [T]: [{ timestamp: now - DAY, price: 190 }, { timestamp: now - 1000, price: 200 }],
    CROC: [{ timestamp: now - DAY, price: 66 }],
  });
  await db.collection('market').doc('current').collection('price_history').doc(T)
    .set({ history: [{ timestamp: now - 30 * DAY, price: 100 }] });
  await db.collection('market').doc('current').collection('daily_closes').doc('2026-09')
    .set({ closes: { '2026-09-20': { [T]: 180, CROC: 66 } } });
  await db.collection('market').doc('preHaltSnapshot').set({ prices: { [T]: 195, CROC: 66 } });
  await db.collection('market').doc('tickerStats').set({ [T]: { shares: 500, netFlow: 1000, trades: 9 } });
  await db.collection('market').doc('indexHistory').set({
    history: [], divisor: 0.002, constituents: [{ t: T, b: base }, { t: 'CROC', b: 66 }],
  });

  const users = {
    holder: {
      cash: 1000, holdings: { [T]: 30, CROC: 5 }, costBasis: { [T]: 150, CROC: 60 },
      lowestWhileHolding: { [T]: 140 },
      holdingCohorts: { [T]: { eligible: 20, pending: [{ shares: 10, availableAt: now + DAY }] } },
      tickerTradeHistory: { [T]: { buy: [{ ts: now - 1000, shares: 30, impact: 0.02 }] } },
    },
    shorter: {
      cash: 50000, holdings: {},
      shorts: { [T]: { shares: 20, costBasis: 220, margin: 4400, system: 'v2', openedAt: ts(now - DAY) } },
    },
    bystander: { cash: 500, holdings: { CROC: 3 } },
    buyerBefore: { cash: 100000, holdings: {} },
    buyerAfter: { cash: 100000, holdings: {} },
  };
  const batch = db.batch();
  for (const [uid, u] of Object.entries(users)) batch.set(db.collection('users').doc(uid), { displayName: uid, portfolioValue: u.cash, ...u });
  await batch.commit();

  await db.collection('limitOrders').doc('lo1').set({ userId: 'holder', ticker: T, type: 'SELL', shares: 10, filledShares: 0, limitPrice: 250, status: 'PENDING' });
  await db.collection('users').doc('holder').collection('priceAlerts').doc('a1').set({ ticker: T, targetPrice: 300, direction: 'above' });
  await db.collection('trades').doc('t1').set({ uid: 'holder', ticker: T, action: 'buy', amount: 30, price: 150, totalValue: 4500, timestamp: ts(now - DAY) });
  await db.collection('trades').doc('t2').set({ uid: 'holder', ticker: 'CROC', action: 'buy', amount: 5, price: 60, totalValue: 300, timestamp: ts(now - DAY) });
  await db.collection('ipTracking').doc('ip1').set({ tickerTradeHistory: { [T]: { buy: [{ ts: now - 1000, shares: 30, impact: 0.02 }] } } });
};

const run = async () => {
  if (isWeeklyTradingHalt()) { console.error('Weekly halt is active; executeTrade refuses everything. Re-run outside it.'); process.exit(2); }
  await seed();

  console.log('\nA. A trade BEFORE the split, for comparison');
  await executeTrade.run({ ticker: T, action: 'buy', amount: 50 }, ctx('buyerBefore'));
  const moveBefore = (await market()).prices[T] / 200 - 1;
  check('a 50-share buy moved the price', moveBefore > 0, moveBefore);
  // Put the price back so the split starts from 200 again.
  await db.collection('market').doc('current').update({ [`prices.${T}`]: 200 });

  const holderBefore = await user('holder');
  const shorterBefore = await user('shorter');
  const pricesBefore = (await market()).prices;
  const valueBefore = { holder: exitEquityAt(holderBefore, pricesBefore), shorter: exitEquityAt(shorterBefore, pricesBefore) };
  const indexBefore = await indexSum();
  const flowBefore = (await db.collection('market').doc('tickerStats').get()).data()[T].shares;

  console.log('\nB. Preflight');
  let dry = await splitStock.run({ ticker: T, ratio: N, mode: 'dryRun' }, adminCtx);
  const failing = (d) => d.checks.filter((c) => !c.pass).map((c) => c.id);
  check('refused before the new splitFactor is deployed', failing(dry).includes('deployed'), failing(dry));
  check('refused while the market is open', failing(dry).includes('halted'), failing(dry));

  // Simulate the deploy: what characters.js would carry after the edit.
  const unsplitBase = CHARACTER_MAP[T].basePrice;
  CHARACTER_MAP[T].splitFactor = N;
  CHARACTER_MAP[T].basePrice = unsplitBase / N;
  await db.collection('market').doc('current').update({ marketHalted: true, haltReason: 'Stock split' });
  dry = await splitStock.run({ ticker: T, ratio: N, mode: 'dryRun' }, adminCtx);
  check('preflight passes once deployed and halted', !dry.blocked, failing(dry));
  check('dry run counts holders, shorts, orders, alerts and trades', dry.breakdown.holders === 2 && dry.breakdown.shorts === 1
    && dry.breakdown.limitOrders === 1 && dry.breakdown.priceAlerts === 1 && dry.breakdown.trades >= 2, dry.breakdown);
  check('dry run writes nothing', (await market()).prices[T] === 200);

  let wrong = null;
  try { await splitStock.run({ ticker: T, ratio: 5, mode: 'execute' }, adminCtx); } catch (e) { wrong = e.message; }
  check('a ratio that does not match the deployed factor is refused', /Preflight failed/.test(wrong || ''), wrong);

  console.log('\nC. Pause and resume');
  const paused = await runSplit({ ticker: T, ratio: N, mode: 'execute', uid: ADMIN_UID, timeBudgetMs: -1 });
  check('a run out of time pauses before touching anything', paused.paused === true && (await market()).prices[T] === 200, paused.nextPhase);
  let second = null;
  try { await splitStock.run({ ticker: T, ratio: N, mode: 'execute' }, adminCtx); } catch (e) { second = e.message; }
  check('a second Execute over a paused run is refused', /Resume|part-finished|paused/i.test(second || ''), second);
  const done = await splitStock.run({ mode: 'resume' }, adminCtx);
  check('resume finishes it', done.success === true, done);

  console.log('\nD. The stock');
  const m = await market();
  check('price 200 -> 20', m.prices[T] === 20, m.prices[T]);
  check('ATH and ATL divided', m.ath[T] === 25 && m.atl[T] === 6, [m.ath[T], m.atl[T]]);
  check('another stock untouched', m.prices.CROC === 66);
  const hist = (await db.collection('market').doc('priceHistory').get()).data();
  check('chart history rescaled, no cliff', hist[T][0].price === 19 && hist[T][1].price === 20 && hist.CROC[0].price === 66, hist[T]);
  const arch = (await db.collection('market').doc('current').collection('price_history').doc(T).get()).data();
  check('archived history rescaled', arch.history[0].price === 10);
  const closes = (await db.collection('market').doc('current').collection('daily_closes').doc('2026-09').get()).data();
  check('daily closes rescaled (the market maker reads these)', closes.closes['2026-09-20'][T] === 18 && closes.closes['2026-09-20'].CROC === 66);
  check('pre-halt snapshot rescaled (dividends read it)', (await db.collection('market').doc('preHaltSnapshot').get()).data().prices[T] === 19.5);
  const statsAfter = (await db.collection('market').doc('tickerStats').get()).data();
  check('flow shares multiplied', close(statsAfter[T].shares, flowBefore * N, 1e-6), [statsAfter[T].shares, flowBefore]);
  check('the market index did not move', close(await indexSum(), indexBefore, 1e-9), [await indexSum(), indexBefore]);

  console.log('\nE. The players');
  const h = await user('holder');
  check('30 shares -> 300', h.holdings[T] === 300 && h.holdings.CROC === 5, h.holdings);
  check('cost basis 150 -> 15, low 140 -> 14', h.costBasis[T] === 15 && h.lowestWhileHolding[T] === 14);
  check('dividend lots multiplied, clock kept', h.holdingCohorts[T].eligible === 200 && h.holdingCohorts[T].pending[0].shares === 100
    && h.holdingCohorts[T].pending[0].availableAt === holderBefore.holdingCohorts[T].pending[0].availableAt);
  check('today\'s trade history multiplied, impact kept', h.tickerTradeHistory[T].buy[0].shares === 300 && h.tickerTradeHistory[T].buy[0].impact === 0.02);
  const s = await user('shorter');
  check('short 20 at 220 -> 200 at 22, collateral kept', s.shorts[T].shares === 200 && s.shorts[T].costBasis === 22 && s.shorts[T].margin === 4400, s.shorts[T]);
  const pricesAfter = (await market()).prices;
  check('holder\'s money unchanged', close(exitEquityAt(h, pricesAfter), valueBefore.holder), [exitEquityAt(h, pricesAfter), valueBefore.holder]);
  check('shorter\'s money unchanged', close(exitEquityAt(s, pricesAfter), valueBefore.shorter), [exitEquityAt(s, pricesAfter), valueBefore.shorter]);
  check('a player with no stake is not touched', !(await user('bystander')).splitsApplied);

  console.log('\nF. Orders, alerts and records');
  const lo = (await db.collection('limitOrders').doc('lo1').get()).data();
  check('open sell order: 10 at 250 -> 100 at 25', lo.shares === 100 && lo.limitPrice === 25, lo);
  check('price alert 300 -> 30', (await db.collection('users').doc('holder').collection('priceAlerts').doc('a1').get()).data().targetPrice === 30);
  const t1 = (await db.collection('trades').doc('t1').get()).data();
  check('trade record: 30 at 150 -> 300 at 15, total kept', t1.amount === 300 && t1.price === 15 && t1.totalValue === 4500, t1);
  check('another stock\'s trade record untouched', (await db.collection('trades').doc('t2').get()).data().amount === 5);
  check('IP tracking shares multiplied', (await db.collection('ipTracking').doc('ip1').get()).data().tickerTradeHistory[T].buy[0].shares === 300);
  const idx = (await db.collection('market').doc('indexHistory').get()).data();
  check('index base divided', close(idx.constituents.find((c) => c.t === T).b, unsplitBase / N, 1e-9));

  console.log('\nG. Never twice');
  const journal = (await db.collection('market').doc('splitJournal').get()).data();
  const again = await PHASES.find((p) => p.name === 'users').run({ ticker: T, n: N, splitId: journal.splitId, cursor: null, budget: { expired: () => false } });
  const market2 = await PHASES.find((p) => p.name === 'market').run({ ticker: T, n: N, splitId: journal.splitId });
  check('re-running phases changes nothing', again.done === 0 && market2.done === 0 && (await user('holder')).holdings[T] === 300
    && (await market()).prices[T] === 20);
  const history = (await db.collection('market').doc('splitHistory').get()).data();
  check('split history records the total factor', history[T].factor === N && history[T].splits.length === 1);
  dry = await splitStock.run({ ticker: T, ratio: N, mode: 'dryRun' }, adminCtx);
  check('the same split cannot be run again (deployed factor would need to be 100)', failing(dry).includes('deployed'), failing(dry));
  check('the market is left halted for the admin to reopen', (await market()).marketHalted === true);

  console.log('\nH. Trading after the split');
  await db.collection('market').doc('current').update({ marketHalted: false });
  // Same dollars as the 50-share buy at 200: 500 shares at 20.
  await executeTrade.run({ ticker: T, action: 'buy', amount: 500 }, ctx('buyerAfter'));
  const moveAfter = (await market()).prices[T] / 20 - 1;
  check('the same dollar buy moves the price by the same percent', close(moveAfter, moveBefore, 0.0006), { moveBefore, moveAfter });

  // The order cap scales with the split: 12,000 shares is over 10,000 but under 100,000.
  const capErr = async (ticker) => {
    try { await executeTrade.run({ ticker, action: 'sell', amount: 12000 }, ctx('buyerAfter')); return null; } catch (e) { return e.message; }
  };
  const unsplitErr = await capErr('CROC');
  const splitErr = await capErr(T);
  check('an unsplit stock keeps the 10,000-share order cap', /between .* and 10,000/.test(unsplitErr || ''), unsplitErr);
  check('the split stock\'s cap is 10x (the sell fails for shares, not size)', !!splitErr && !/between .* and/.test(splitErr), splitErr);

  console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll split checks passed.');
  process.exit(failures ? 1 : 0);
};

run().catch((e) => { console.error(e); process.exit(1); });
