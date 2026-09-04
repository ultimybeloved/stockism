'use strict';
// End-to-end test of the ticker rename engine against the LOCAL Firebase
// emulator. Never touches production (uses FIRESTORE_EMULATOR_HOST).
//
// Run via:
//   npm run test:rename
//
// A rename is the most destructive routine operation in this codebase: it walks
// every player document and rewrites the dividend loyalty ledger, open orders,
// price history and the index constituent list. The previous implementation
// silently skipped about twenty locations and reopened the market on failure.
// Everything below exists because getting one of these wrong is invisible until
// a player notices their loyalty reset or their DRIP switched itself off.
//
// Sections:
//   A. Preflight refuses every unsafe start
//   B. Dry run counts what is there and writes nothing
//   C. Execute moves everything and leaves neighbours untouched
//   D. The archived price-history document is a real doc-ID move
//   E. Re-running is a no-op
//   F. A pause keeps the market halted and resumes to the same end state
//   G. A failure keeps the market halted
//   H. Restoring a pre-rename backup does not resurrect the old ticker
//   I. Renaming twice collapses the alias chain to one hop

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080';
process.env.GCLOUD_PROJECT = process.env.GCLOUD_PROJECT || 'stockism-abb28';

const admin = require('../functions/node_modules/firebase-admin');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

const OLD = 'GUN';
const NEW = 'GUNX';
// Seeded into every map alongside OLD. A rename that eats a neighbour is worse
// than one that fails outright, so every assertion checks this survived.
const OTHER = 'JIN';

const { CHARACTERS, CHARACTER_MAP } = require('../functions/characters');
const { CREWS } = require('../functions/crews');

if (!CHARACTER_MAP[OLD]) throw new Error(`${OLD} is not in characters.js`);
if (CHARACTER_MAP[NEW]) throw new Error(`${NEW} already exists; pick another fixture`);

/**
 * Move a ticker through the in-memory roster, the way a source edit plus
 * sync:chars plus a deploy would.
 *
 * Mutates in place so the engine, which holds references to these same objects,
 * sees it. Preflight reads CHARACTER_MAP at call time for exactly this reason:
 * going through helpers.isRosterTicker would not work, because that freezes its
 * ticker set at module load.
 */
const renameInRoster = (from, to) => {
  const entry = CHARACTERS.find((c) => c.ticker === from);
  entry.ticker = to;
  CHARACTER_MAP[to] = entry;
  delete CHARACTER_MAP[from];
  for (const c of CHARACTERS) {
    if (Array.isArray(c.constituents)) {
      c.constituents = c.constituents.map((t) => (t === from ? to : t));
    }
    if (Array.isArray(c.trailingFactors)) {
      c.trailingFactors = c.trailingFactors.map(
        (t) => (t.ticker === from ? { ...t, ticker: to } : t)
      );
    }
  }
  for (const crew of Object.values(CREWS)) {
    crew.members = (crew.members || []).map((t) => (t === from ? to : t));
  }
};

// Loaded AFTER admin.initializeApp so their top-level admin.firestore() binds
// to the emulator.
const R = require('../functions/services/tickerRename');
const { remapAliasedKeys } = require('../functions/helpers');

let failures = 0;
const check = (label, cond, detail = '') => {
  console.log(`${cond ? '  ✅' : '  ❌'} ${label}${cond ? '' : ' — ' + detail}`);
  if (!cond) failures++;
};
const section = (t) => console.log(`\n${t}`);

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const marketRef = () => db.collection('market').doc('current');
const getMarket = async () => (await marketRef().get()).data() || {};
const getDoc = async (col, id) => (await db.collection(col).doc(id).get()).data() || {};
const getJournal = () => getDoc('market', 'tickerRename');

const wipe = async (path) => {
  const snap = await db.collection(path).get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const batch = db.batch();
    snap.docs.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
};

const both = (v, o = v) => ({ [OLD]: v, [OTHER]: o });

/** Rebuild every fixture from scratch so each section starts clean. */
const seed = async (ticker = OLD) => {
  const t = ticker;
  for (const c of ['trades', 'limitOrders', 'preMarketOrders', 'feed', 'ipTracking', 'users']) {
    await wipe(c);
  }
  await db.collection('market').doc('tickerRename').delete().catch(() => {});

  await marketRef().set({
    prices: { [t]: 90, [OTHER]: 40 },
    volumes: both(12, 3),
    dailyVolumes: both(5, 1),
    liquidity: both(100, 50),
    botImpact: both(0.03, 0.01),
    haltedTickers: { [t]: true },
    ath: both(120, 60),
    atl: both(30, 20),
    launchedTickers: [t, OTHER],
    alertedThresholds: { [`${t}_10_up`]: now, [`${OTHER}_10_up`]: now },
    marketHalted: false,
    haltReason: '',
  });

  const { priceHistoryRef } = require('../functions/helpers');
  await priceHistoryRef().set({
    [t]: [{ timestamp: now - DAY, price: 88 }, { timestamp: now, price: 90 }],
    [OTHER]: [{ timestamp: now, price: 40 }],
  });

  const archive = db.collection('market').doc('current').collection('price_history');
  await archive.doc(t).set({ history: [{ timestamp: now - 90 * DAY, price: 70 }] });
  await archive.doc(OTHER).set({ history: [{ timestamp: now - 90 * DAY, price: 33 }] });

  await db.collection('market').doc('current').collection('daily_closes')
    .doc('2026-09').set({ closes: { '2026-09-01': { [t]: 91, [OTHER]: 41 } } });

  await db.collection('market').doc('preHaltSnapshot').set({ prices: both(89, 39) });
  await db.collection('market').doc('reviewChanges').set({ changes: both({ pct: 4 }, { pct: 1 }) });
  await db.collection('market').doc('reviewDetail').set({ detail: both([{ p: 1 }], [{ p: 2 }]) });
  await db.collection('market').doc('indexHistory').set({
    divisor: 0.152, history: [{ t: now, v: 1000 }],
    constituents: [{ t, b: 85 }, { t: OTHER, b: 40 }],
  });
  await db.collection('market').doc('ipos').set({
    list: [{ ticker: t, shares: 10 }, { ticker: OTHER, shares: 5 }],
  });
  await db.collection('market').doc('tickerStats').set({
    [t]: { trades: 9, netFlow: 500, lastTradedAt: now },
    [OTHER]: { trades: 2, netFlow: 10, lastTradedAt: now },
  });
  await db.collection('dividendConfig').doc('tierOverrides').set({ tiers: both('rare', 'common') });

  // u1 carries every ticker-keyed map, each with a neighbour alongside.
  const u1 = {};
  for (const map of R.USER_TICKER_MAPS) u1[map] = both(1, 2);
  u1.watchlist = [t, OTHER];
  u1.transactionLog = [{ ticker: t, type: 'buy' }, { ticker: OTHER, type: 'buy' }];
  u1.displayName = 'Holder One';
  await db.collection('users').doc('u1').set(u1);

  // u2 is a partial shape: only a short. Proves a sparse doc is handled.
  await db.collection('users').doc('u2').set({ displayName: 'Shorty', shorts: { [t]: { shares: 4 } } });
  // u3 touches nothing and must not be written at all.
  await db.collection('users').doc('u3').set({ displayName: 'Bystander', holdings: { [OTHER]: 3 } });

  await db.collection('users').doc('u1').collection('priceAlerts').doc('a1')
    .set({ ticker: t, target: 100, triggered: false });
  await db.collection('users').doc('u1').collection('notifications').doc('n1')
    .set({ data: { ticker: t }, message: `${t} hit your target` });

  await db.collection('trades').doc('t1').set({ ticker: t, uid: 'u1', action: 'buy' });
  await db.collection('trades').doc('t2').set({ ticker: t, uid: 'u2', action: 'sell' });
  await db.collection('trades').doc('t3').set({ ticker: OTHER, uid: 'u1', action: 'buy' });
  await db.collection('limitOrders').doc('l1').set({ ticker: t, status: 'PENDING' });
  await db.collection('preMarketOrders').doc(`u1_2026-09-03_${t}_buy`).set({ ticker: t, status: 'FILLED' });
  await db.collection('ipTracking').doc('1_2_3_4').set({
    tickerTradeHistory: { [t]: { buy: [{ ts: now }] }, [OTHER]: { buy: [{ ts: now }] } },
  });
  await db.collection('feed').doc('f1').set({ ticker: t, message: `bought 5 $${t}`, createdAt: now });
  await db.collection('feed').doc('f2').set({ ticker: OTHER, message: `bought 5 $${OTHER}`, createdAt: now });
  // Longer ticker sharing a prefix. Must survive untouched.
  await db.collection('feed').doc('f3').set({ ticker: `${t}NER`, message: `bought 5 $${t}NER`, createdAt: now });
};

const run = (mode, opts = {}) => R.runRename({
  old: OLD, nw: NEW, mode, uid: 'admin-test', ...opts,
});

(async () => {
  console.log('\nTICKER RENAME — EMULATOR TEST\n');

  // ── A. Preflight refusals ──────────────────────────────────────────────
  section('A. Preflight refuses every unsafe start');
  await seed();

  const pf = async (o, n) => {
    const md = await getMarket();
    const { checks } = await R.runPreflight({ old: o, nw: n, marketData: md });
    return Object.fromEntries(checks.map((c) => [c.id, c.pass]));
  };

  // Roster not yet migrated: OLD still present, NEW absent. This is the state
  // an admin is in if they run the migration before deploying.
  let p = await pf(OLD, NEW);
  check('refuses while the new ticker is not in the deployed roster', p.newInRoster === false);
  check('refuses while the old ticker is still in the deployed roster', p.oldNotInRoster === false);
  check('refuses while a fund still references the old ticker', p.etfRefs === false);
  check('refuses while a crew roster still lists the old ticker', p.crewRefs === false);

  p = await pf('GU.N', NEW);
  check('refuses a ticker containing a field-path character', p.format === false);

  // Now migrate the roster, the way a source edit and deploy would.
  renameInRoster(OLD, NEW);

  p = await pf(OLD, NEW);
  check('accepts the roster once the source edit has shipped', p.newInRoster && p.oldNotInRoster);
  check('accepts clean fund references', p.etfRefs === true);
  check('accepts clean crew rosters', p.crewRefs === true);
  check('accepts the price state', p.prices === true);

  await db.collection('preMarketOrders').doc('pending1')
    .set({ ticker: OLD, status: 'PENDING' });
  p = await pf(OLD, NEW);
  check('refuses while a pre-market order is still pending', p.preMarket === false);
  await db.collection('preMarketOrders').doc('pending1').delete();

  await marketRef().update({ [`prices.${NEW}`]: 5 });
  p = await pf(OLD, NEW);
  check('refuses renaming onto a ticker that already has a price', p.prices === false);
  await marketRef().update({ [`prices.${NEW}`]: admin.firestore.FieldValue.delete() });

  // ── B. Dry run ─────────────────────────────────────────────────────────
  section('B. Dry run counts and writes nothing');
  await seed();
  const beforeUpdate = (await marketRef().get()).updateTime.toMillis();
  const counts = await R.countDryRun({ old: OLD, nw: NEW });
  const afterUpdate = (await marketRef().get()).updateTime.toMillis();

  check('counts the two players holding the stock', counts.users === 2, `got ${counts.users}`);
  check('counts both trade records', counts.trades === 2, `got ${counts.trades}`);
  check('counts the limit order', counts.limitOrders === 1);
  check('counts the price alert', counts.priceAlerts === 1);
  check('counts only the exact-ticker feed entry', counts.feed === 1, `got ${counts.feed}`);
  check('finds the archived history document', counts.priceArchive === 1);
  check('wrote nothing to the market document', beforeUpdate === afterUpdate);
  check('journal was not created', !(await db.collection('market').doc('tickerRename').get()).exists);

  // ── C. Execute ─────────────────────────────────────────────────────────
  section('C. Execute moves everything and spares the neighbours');
  const res = await run('execute');
  check('reports success', res.success === true, JSON.stringify(res).slice(0, 160));

  const m = await getMarket();
  check('price moved', m.prices[NEW] === 90 && m.prices[OLD] === undefined);
  check('neighbour price untouched', m.prices[OTHER] === 40);
  check('all-time high moved', m.ath[NEW] === 120 && m.ath[OLD] === undefined);
  check('all-time low moved', m.atl[NEW] === 30);
  check('per-ticker halt carried across', m.haltedTickers[NEW] === true);
  check('bot impact carried across', m.botImpact[NEW] === 0.03);
  check('launched list swapped', m.launchedTickers.includes(NEW) && !m.launchedTickers.includes(OLD));
  check('old alert throttle dropped', m.alertedThresholds[`${OLD}_10_up`] === undefined);
  check('neighbour alert throttle kept', m.alertedThresholds[`${OTHER}_10_up`] !== undefined);
  check('alias recorded', m.tickerAliases[OLD] === NEW);
  check('market reopened', m.marketHalted === false);

  const { priceHistoryRef } = require('../functions/helpers');
  const hist = (await priceHistoryRef().get()).data();
  check('live history moved with both points', (hist[NEW] || []).length === 2 && hist[OLD] === undefined);
  check('neighbour history untouched', (hist[OTHER] || []).length === 1);

  const closes = await db.collection('market').doc('current')
    .collection('daily_closes').doc('2026-09').get();
  const dayCloses = closes.data().closes['2026-09-01'];
  check('daily close moved', dayCloses[NEW] === 91 && dayCloses[OLD] === undefined);
  check('neighbour daily close untouched', dayCloses[OTHER] === 41);

  const snap2 = await getDoc('market', 'preHaltSnapshot');
  check('pre-halt snapshot moved (dividends pay off this)', snap2.prices[NEW] === 89);
  const rc = await getDoc('market', 'reviewChanges');
  check('review changes moved', rc.changes[NEW] !== undefined && rc.changes[OLD] === undefined);
  const rd = await getDoc('market', 'reviewDetail');
  check('review detail moved', rd.detail[NEW] !== undefined);
  const idx = await getDoc('market', 'indexHistory');
  check('index constituents moved', idx.constituents.some((c) => c.t === NEW)
    && !idx.constituents.some((c) => c.t === OLD));
  check('index divisor untouched', idx.divisor === 0.152);
  const ipos = await getDoc('market', 'ipos');
  check('IPO list moved', ipos.list.some((i) => i.ticker === NEW));
  const stats = await getDoc('market', 'tickerStats');
  check('ticker stats moved', stats[NEW]?.trades === 9 && stats[OLD] === undefined);
  const divCfg = await getDoc('dividendConfig', 'tierOverrides');
  check('dividend tier override moved', divCfg.tiers[NEW] === 'rare');

  const u1 = await getDoc('users', 'u1');
  let allMaps = true;
  for (const map of R.USER_TICKER_MAPS) {
    if (u1[map]?.[NEW] === undefined || u1[map]?.[OLD] !== undefined) {
      allMaps = false;
      console.log(`      map not migrated: ${map}`);
    }
    if (u1[map]?.[OTHER] === undefined) {
      allMaps = false;
      console.log(`      neighbour lost in: ${map}`);
    }
  }
  check(`all ${R.USER_TICKER_MAPS.length} player maps migrated, neighbours intact`, allMaps);
  check('loyalty lot ledger survived', u1.holdingCohorts[NEW] !== undefined);
  check('DRIP toggle survived', u1.drip[NEW] !== undefined);
  check('watchlist rewritten', u1.watchlist.includes(NEW) && !u1.watchlist.includes(OLD));
  check('transaction log rewritten', u1.transactionLog[0].ticker === NEW);

  const u2 = await getDoc('users', 'u2');
  check('sparse player doc handled', u2.shorts[NEW]?.shares === 4);
  const u3Snap = await db.collection('users').doc('u3').get();
  check('uninvolved player was not written', u3Snap.updateTime.toMillis() < res.journal.startedAt);

  const alert = await db.collection('users').doc('u1').collection('priceAlerts').doc('a1').get();
  check('price alert rewritten', alert.data().ticker === NEW);
  const notif = await db.collection('users').doc('u1').collection('notifications').doc('n1').get();
  check('notification deliberately left for the alias to resolve', notif.data().data.ticker === OLD);

  const tradesLeft = await db.collection('trades').where('ticker', '==', OLD).get();
  check('no trade record left behind', tradesLeft.empty);
  const tradeOther = await db.collection('trades').doc('t3').get();
  check('neighbour trade untouched', tradeOther.data().ticker === OTHER);
  const lim = await getDoc('limitOrders', 'l1');
  check('limit order rewritten', lim.ticker === NEW);
  const pre = await db.collection('preMarketOrders').where('ticker', '==', NEW).get();
  check('pre-market order rewritten', pre.size === 1);
  const ip = await getDoc('ipTracking', '1_2_3_4');
  check('IP trade history moved', ip.tickerTradeHistory[NEW] !== undefined
    && ip.tickerTradeHistory[OTHER] !== undefined);

  const f1 = await getDoc('feed', 'f1');
  check('feed ticker rewritten', f1.ticker === NEW);
  check('feed message text rewritten', f1.message === `bought 5 $${NEW}`);
  const f3 = await getDoc('feed', 'f3');
  check('longer ticker sharing the prefix untouched', f3.message === `bought 5 $${OLD}NER`);

  const j = await getJournal();
  check('journal complete', j.status === 'complete');

  // ── D. Archive doc-ID move ─────────────────────────────────────────────
  section('D. Archived history is a real document move');
  const arch = db.collection('market').doc('current').collection('price_history');
  const newArch = await arch.doc(NEW).get();
  const oldArch = await arch.doc(OLD).get();
  check('archive document exists under the new name', newArch.exists);
  check('archive document gone from the old name', !oldArch.exists);
  check('archived points preserved', (newArch.data().history || []).length === 1);
  check('records where it came from', newArch.data().renamedFrom === OLD);
  check('neighbour archive untouched', (await arch.doc(OTHER).get()).exists);

  // ── E. Idempotence ─────────────────────────────────────────────────────
  section('E. Re-running changes nothing');
  const before = (await marketRef().get()).updateTime.toMillis();
  const again = await run('resume');
  const after = (await marketRef().get()).updateTime.toMillis();
  check('reports already complete', again.alreadyComplete === true);
  check('no further writes', before === after);

  // ── F. Pause and resume ────────────────────────────────────────────────
  section('F. A pause holds the market halted and resumes to the same state');
  await seed();
  const paused = await run('execute', { timeBudgetMs: -1 });
  check('run paused', paused.paused === true, JSON.stringify(paused).slice(0, 140));
  const midMarket = await getMarket();
  check('MARKET STAYS HALTED while incomplete', midMarket.marketHalted === true);
  const midJournal = await getJournal();
  check('journal records the pause', midJournal.status === 'paused');

  let guard = 0;
  let resumed = null;
  do {
    resumed = await run('resume');
    guard++;
  } while (resumed.paused && guard < 25);
  check('resumes to completion', resumed.success === true, `after ${guard} passes`);
  check('market reopened only at the end', (await getMarket()).marketHalted === false);
  const resumedU1 = await getDoc('users', 'u1');
  check('resumed run produced the same player state', resumedU1.holdingCohorts[NEW] !== undefined
    && resumedU1.holdingCohorts[OLD] === undefined);
  check('no trace of the old ticker after a resumed run',
    (await R.verifyClean(OLD)).length === 0);

  // ── G. Failure keeps the market halted ─────────────────────────────────
  section('G. A failure keeps the market halted');
  await seed();
  const tradesPhase = R.PHASES.find((ph) => ph.name === 'trades');
  const realRun = tradesPhase.run;
  tradesPhase.run = async () => { throw new Error('injected failure'); };
  let threw = false;
  try {
    await run('execute');
  } catch (e) {
    threw = /injected failure/.test(e.message);
  }
  tradesPhase.run = realRun;
  check('the failure is surfaced, not swallowed', threw);
  const failedMarket = await getMarket();
  check('MARKET STAYS HALTED after a failure', failedMarket.marketHalted === true);
  check('halt reason tells the admin what to do',
    /Resume or abort/i.test(failedMarket.haltReason || ''), failedMarket.haltReason);
  const failedJournal = await getJournal();
  check('journal records the failure', failedJournal.status === 'failed');

  let recovered = null;
  guard = 0;
  do {
    recovered = await run('resume');
    guard++;
  } while (recovered.paused && guard < 25);
  check('resume recovers a failed run', recovered.success === true);
  check('market reopens once recovered', (await getMarket()).marketHalted === false);

  // ── H. Backup restore ──────────────────────────────────────────────────
  section('H. Restoring a pre-rename backup does not resurrect the old ticker');
  const aliases = (await getMarket()).tickerAliases || {};
  const backup = { [OLD]: [{ timestamp: now, price: 90 }], [OTHER]: [{ timestamp: now, price: 40 }] };
  const restored = remapAliasedKeys(backup, aliases);
  check('old key remapped to the current name', restored[NEW] !== undefined && restored[OLD] === undefined);
  check('unrelated ticker passes through', restored[OTHER] !== undefined);

  // ── I. Chain collapse ──────────────────────────────────────────────────
  section('I. Renaming twice keeps the alias one hop');
  const NEWER = 'GUNY';
  renameInRoster(NEW, NEWER);
  const second = await R.runRename({ old: NEW, nw: NEWER, mode: 'execute', uid: 'admin-test' });
  check('second rename succeeds', second.success === true, JSON.stringify(second).slice(0, 140));
  const finalAliases = (await getMarket()).tickerAliases;
  check('the original name points at the final one', finalAliases[OLD] === NEWER,
    JSON.stringify(finalAliases));
  check('the intermediate name points at the final one', finalAliases[NEW] === NEWER);
  check('no two-hop chain remains', !Object.values(finalAliases).includes(NEW));

  console.log(`\n${failures === 0 ? 'ALL RENAME CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((err) => {
  console.error('\nTEST HARNESS ERROR:', err);
  process.exit(1);
});
