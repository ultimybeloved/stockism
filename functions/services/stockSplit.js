'use strict';
// Stock split engine: N-for-1 on one stock. Every holder ends up with N times
// the shares at 1/N the price, so nobody's money changes.
//
// INTERNAL MODULE — required by adminMigrate.js, never listed in servicePaths.js.
// It exports no Cloud Functions.
//
// Built on the rename engine's design (tickerRename.js): a journal of phases,
// each resumable inside a time budget, and a market that stays halted until
// the whole thing checks out. One thing is different and it matters: a rename
// MOVES a key, so re-running a phase finds nothing left to do. A split
// MULTIPLIES, and multiplying twice would be a disaster. So every document it
// touches is marked with the split's id in the same write, and a marked
// document is never touched again:
//
//   players, trades, orders, alerts, IP tracking   `splitsApplied.<id>` on the doc
//   the market documents                           `appliedDocs.<key>` on the
//                                                  journal, in the same batch
//
// What changes, and why each one has to:
//
//   prices, chart history, daily closes, ATH/ATL,  / N   (the chart doesn't show
//   the pre-halt snapshot, review changes                 a cliff; dividends and
//                                                         the market maker read these)
//   holdings, dividend lots, shorts, IPO counts,   x N
//   trade-history share counts (player and IP)           (the daily impact and
//                                                         volume windows)
//   cost basis, lowest-while-holding, short entry  / N
//   open orders: shares x N, limit/fill price / N
//   price alerts / N
//   trade records: amount x N, price / N          (velocity limits and the
//                                                   coordination review read them)
//   the index constituent's base / N              (price / base is unchanged, so
//                                                   the index doesn't move)
//
// And one thing that is NOT data: characters.js must already carry the new
// splitFactor, deployed, which divides basePrice and multiplies liquidity (see
// liquidityFor in helpers.js). Without the liquidity change the same dollar
// trade would move a 10-for-1 stock about 3x as far. Preflight refuses to run
// until the deployed factor matches.
//
// Left as history: feed messages (7-day TTL) and old notifications.

const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

const { CHARACTER_MAP } = require('../characters');
const {
  RENAME_TIME_BUDGET_MS,
  RENAME_JOURNAL_DOC,
  TICKER_PATTERN,
  SPLIT_JOURNAL_DOC,
  SPLIT_HISTORY_DOC,
  SPLIT_MIN_RATIO,
  SPLIT_MAX_RATIO,
} = require('../constants');
const { priceHistoryRef } = require('../helpers');
const { walkQuery } = require('./migrationWalk');

const marketRef = () => db.collection('market').doc('current');
const journalRef = () => db.collection('market').doc(SPLIT_JOURNAL_DOC);
const historyRef = () => db.collection('market').doc(SPLIT_HISTORY_DOC);

// ============================================
// PURE HELPERS
// ============================================
// No Firestore handles. Everything that decides what a split means is here so
// it can be tested without an emulator.

/** A price after the split. Four decimals: cents would shave value off big holdings. */
const splitPrice = (p, n) => (typeof p === 'number' ? Math.round((p / n) * 1e4) / 1e4 : p);
/** A share count after the split. */
const splitShares = (s, n) => (typeof s === 'number' ? Math.round(s * n * 1e6) / 1e6 : s);

/** A list of { price } points (chart history, review detail). */
const splitPoints = (arr, n) => (Array.isArray(arr)
  ? arr.map((pt) => (pt && typeof pt.price === 'number' ? { ...pt, price: splitPrice(pt.price, n) } : pt))
  : arr);

/** { buy: [{ts, shares, impact}], sell: [...], ... }: shares x N, impact unchanged. */
const splitTradeHistory = (byAction, n) => {
  if (!byAction || typeof byAction !== 'object') return byAction;
  const out = {};
  for (const [action, list] of Object.entries(byAction)) {
    out[action] = Array.isArray(list)
      ? list.map((e) => (e && typeof e.shares === 'number' ? { ...e, shares: splitShares(e.shares, n) } : e))
      : list;
  }
  return out;
};

/**
 * Everything one player document needs changed. {} if they hold nothing in the
 * stock or this split has already been applied to them.
 */
const buildUserSplitUpdates = (u, ticker, n, splitId) => {
  if (!u || u.splitsApplied?.[splitId]) return {};
  const t = ticker;
  const up = {};
  const has = (map) => u[map] && u[map][t] !== undefined && u[map][t] !== null;

  if (has('holdings')) up[`holdings.${t}`] = splitShares(u.holdings[t], n);
  if (has('costBasis')) up[`costBasis.${t}`] = splitPrice(u.costBasis[t], n);
  if (has('lowestWhileHolding')) up[`lowestWhileHolding.${t}`] = splitPrice(u.lowestWhileHolding[t], n);
  if (has('ipoPurchases')) up[`ipoPurchases.${t}`] = splitShares(u.ipoPurchases[t], n);
  if (has('holdingCohorts')) {
    const c = u.holdingCohorts[t];
    up[`holdingCohorts.${t}`] = {
      ...c,
      eligible: splitShares(c.eligible || 0, n),
      pending: (c.pending || []).map((lot) => ({ ...lot, shares: splitShares(lot.shares, n) })),
    };
  }
  if (has('shorts')) {
    const s = u.shorts[t];
    up[`shorts.${t}`] = {
      ...s,
      shares: splitShares(s.shares, n),
      ...(s.costBasis !== undefined ? { costBasis: splitPrice(s.costBasis, n) } : {}),
      ...(s.entryPrice !== undefined ? { entryPrice: splitPrice(s.entryPrice, n) } : {}),
    };
  }
  for (const lock of ['ipoLockup', 'marginLockup']) {
    if (has(lock) && typeof u[lock][t].shares === 'number') {
      up[`${lock}.${t}`] = { ...u[lock][t], shares: splitShares(u[lock][t].shares, n) };
    }
  }
  if (has('tickerTradeHistory')) up[`tickerTradeHistory.${t}`] = splitTradeHistory(u.tickerTradeHistory[t], n);

  if (!Object.keys(up).length) return {};
  up[`splitsApplied.${splitId}`] = true;
  return up;
};

/** market/current. Prices and records down; IPO share volumes up. */
const buildMarketSplitUpdates = (m, ticker, n) => {
  const up = {};
  for (const map of ['prices', 'ath', 'atl']) {
    if (typeof m?.[map]?.[ticker] === 'number') up[`${map}.${ticker}`] = splitPrice(m[map][ticker], n);
  }
  if (typeof m?.volumes?.[ticker] === 'number') up[`volumes.${ticker}`] = splitShares(m.volumes[ticker], n);
  return up;
};

/** One limit order, open or finished. */
const buildOrderSplitUpdates = (o, n, splitId) => {
  if (!o || o.splitsApplied?.[splitId]) return {};
  const up = { [`splitsApplied.${splitId}`]: true };
  for (const f of ['shares', 'filledShares']) if (typeof o[f] === 'number') up[f] = splitShares(o[f], n);
  for (const f of ['limitPrice', 'executedPrice', 'stopPrice']) if (typeof o[f] === 'number') up[f] = splitPrice(o[f], n);
  return up;
};

/** One trade record. The dollar total is the same either way. */
const buildTradeSplitUpdates = (t, n, splitId) => {
  if (!t || t.splitsApplied?.[splitId]) return {};
  const up = { [`splitsApplied.${splitId}`]: true };
  for (const f of ['amount', 'shares']) if (typeof t[f] === 'number') up[f] = splitShares(t[f], n);
  for (const f of ['price', 'marketPrice', 'executionPrice']) if (typeof t[f] === 'number') up[f] = splitPrice(t[f], n);
  return up;
};

// ============================================
// PHASES
// ============================================

/**
 * One market document, atomically with its journal mark, so a crash between
 * the two can never make a resume apply it twice.
 */
const applyOnce = async (key, ref, build, splitId) => {
  const [docSnap, jSnap] = await Promise.all([ref.get(), journalRef().get()]);
  if (jSnap.data()?.appliedDocs?.[key] === splitId) return 0;
  const updates = docSnap.exists ? build(docSnap.data() || {}) : {};
  const batch = db.batch();
  if (Object.keys(updates).length) batch.update(ref, updates);
  batch.set(journalRef(), { appliedDocs: { [key]: splitId } }, { merge: true });
  await batch.commit();
  return Object.keys(updates).length ? 1 : 0;
};

const walkMarked = (queryFn, build, opts) => ({ cursor, budget }) =>
  walkQuery(queryFn, cursor, (data) => build(data), budget, opts);

const PHASES = [
  {
    name: 'market',
    label: 'Price, records and chart history',
    run: async ({ ticker: t, n, splitId }) => {
      const m = db.collection('market');
      let done = 0;
      done += await applyOnce('current', marketRef(), (d) => buildMarketSplitUpdates(d, t, n), splitId);
      done += await applyOnce('priceHistory', priceHistoryRef(),
        (d) => (d[t] !== undefined ? { [t]: splitPoints(d[t], n) } : {}), splitId);
      done += await applyOnce('archive', marketRef().collection('price_history').doc(t),
        (d) => (d.history ? { history: splitPoints(d.history, n) } : {}), splitId);
      const closes = await marketRef().collection('daily_closes').get();
      for (const doc of closes.docs) {
        done += await applyOnce(`closes_${doc.id}`, doc.ref, (d) => {
          const up = {};
          for (const [day, byTicker] of Object.entries(d.closes || {})) {
            if (typeof byTicker?.[t] === 'number') up[`closes.${day}.${t}`] = splitPrice(byTicker[t], n);
          }
          return up;
        }, splitId);
      }
      done += await applyOnce('preHaltSnapshot', m.doc('preHaltSnapshot'),
        (d) => (typeof d.prices?.[t] === 'number' ? { [`prices.${t}`]: splitPrice(d.prices[t], n) } : {}), splitId);
      done += await applyOnce('tickerStats', m.doc('tickerStats'),
        (d) => (typeof d[t]?.shares === 'number' ? { [`${t}.shares`]: splitShares(d[t].shares, n) } : {}), splitId);
      done += await applyOnce('reviewChanges', m.doc('reviewChanges'), (d) => {
        const c = d.changes?.[t];
        return c ? { [`changes.${t}`]: { ...c, oldPrice: splitPrice(c.oldPrice, n), newPrice: splitPrice(c.newPrice, n) } } : {};
      }, splitId);
      done += await applyOnce('reviewDetail', m.doc('reviewDetail'),
        (d) => (d.detail?.[t] ? { [`detail.${t}`]: splitPoints(d.detail[t], n) } : {}), splitId);
      done += await applyOnce('indexHistory', m.doc('indexHistory'), (d) => {
        if (!Array.isArray(d.constituents) || !d.constituents.some((c) => c.t === t)) return {};
        return { constituents: d.constituents.map((c) => (c.t === t ? { ...c, b: splitPrice(c.b, n) } : c)) };
      }, splitId);
      return { done, complete: true };
    },
  },
  {
    name: 'users',
    label: 'Player holdings, shorts and lots',
    run: ({ ticker, n, splitId, cursor, budget }) => walkQuery(
      () => db.collection('users'), cursor,
      (u) => buildUserSplitUpdates(u, ticker, n, splitId), budget
    ),
  },
  {
    name: 'limitOrders',
    label: 'Limit orders',
    run: ({ ticker, n, splitId, cursor, budget }) => walkMarked(
      () => db.collection('limitOrders').where('ticker', '==', ticker),
      (o) => buildOrderSplitUpdates(o, n, splitId)
    )({ cursor, budget }),
  },
  {
    name: 'priceAlerts',
    label: 'Price alerts',
    run: ({ ticker, n, splitId, cursor, budget }) => walkMarked(
      () => db.collectionGroup('priceAlerts').where('ticker', '==', ticker),
      (a) => (a.splitsApplied?.[splitId] || typeof a.targetPrice !== 'number' ? {}
        : { targetPrice: splitPrice(a.targetPrice, n), [`splitsApplied.${splitId}`]: true }),
      { group: true }
    )({ cursor, budget }),
  },
  {
    name: 'trades',
    label: 'Trade records',
    run: ({ ticker, n, splitId, cursor, budget }) => walkMarked(
      () => db.collection('trades').where('ticker', '==', ticker),
      (tr) => buildTradeSplitUpdates(tr, n, splitId)
    )({ cursor, budget }),
  },
  {
    name: 'ipTracking',
    label: 'IP trade tracking',
    // 24h of anti-manipulation state. Skipping it would hand every network a
    // share count 1/N of what it really traded today.
    run: ({ ticker, n, splitId, cursor, budget }) => walkQuery(
      () => db.collection('ipTracking'), cursor,
      (d) => (d.splitsApplied?.[splitId] || !d.tickerTradeHistory?.[ticker] ? {}
        : {
          [`tickerTradeHistory.${ticker}`]: splitTradeHistory(d.tickerTradeHistory[ticker], n),
          [`splitsApplied.${splitId}`]: true,
        }),
      budget
    ),
  },
];

// ============================================
// PREFLIGHT
// ============================================

const currentFactor = async (ticker) => (((await historyRef().get()).data() || {})[ticker]?.factor || 1);

/** Blocking checks, all shown in the dry run. */
const runPreflight = async ({ ticker, ratio, marketData }) => {
  const checks = [];
  const add = (id, label, pass, detail) => checks.push({ id, label, pass, detail });
  const c = CHARACTER_MAP[ticker];
  const before = await currentFactor(ticker);
  const want = before * ratio;

  add('format', 'Ticker and ratio are valid',
    TICKER_PATTERN.test(ticker) && Number.isInteger(ratio) && ratio >= SPLIT_MIN_RATIO && ratio <= SPLIT_MAX_RATIO,
    `A whole-number ratio from ${SPLIT_MIN_RATIO} to ${SPLIT_MAX_RATIO}.`);
  add('roster', 'A character stock with a live price',
    !!c && !c.isETF && typeof marketData.prices?.[ticker] === 'number',
    !c ? `${ticker} is not in the deployed roster.` : c.isETF ? 'Funds are not split.'
      : `$${ticker} is at ${marketData.prices?.[ticker]}.`);
  add('deployed', `characters.js has splitFactor ${want}, deployed`,
    (c?.splitFactor || 1) === want,
    `Deployed splitFactor is ${c?.splitFactor || 1}; this split needs ${want} (${before} so far x ${ratio}). `
      + 'Add it to src/characters.js, run sync:chars, and deploy functions — with the market already halted.');
  add('halted', 'The market is halted', !!marketData.marketHalted,
    'Halt it by hand BEFORE deploying the new splitFactor: from that deploy until the split runs, the index and '
      + 'price impact read the new factor against the old price.');

  const pendingPre = await db.collection('preMarketOrders')
    .where('ticker', '==', ticker).where('status', '==', 'PENDING').limit(1).get();
  add('preMarket', 'No pending pre-market orders', pendingPre.empty,
    pendingPre.empty ? 'Nothing queued.' : 'Wait for the opening auction or cancel them first.');

  const [jSnap, rSnap] = await Promise.all([journalRef().get(), db.collection('market').doc(RENAME_JOURNAL_DOC).get()]);
  const journal = jSnap.exists ? jSnap.data() : null;
  const open = !!journal && journal.status !== 'complete';
  const renameOpen = rSnap.exists && rSnap.data().status && rSnap.data().status !== 'complete' && rSnap.data().status !== 'failed';
  add('journal', 'No split or rename is part-finished', !open && !renameOpen,
    open ? (journal.abortedAt
      ? `The $${journal.ticker} split was aborted part way; its records are half split. Fix by hand first.`
      : `$${journal.ticker} ${journal.ratio}-for-1 is ${journal.status}. Resume it.`)
      : renameOpen ? 'A ticker rename is running.' : 'No conflicting run.');

  return { checks, blocked: checks.some((x) => !x.pass), journal, before };
};

/** How much each phase will touch, for the dry run. */
const countDryRun = async ({ ticker }) => {
  const countQ = async (q) => (await q.count().get()).data().count;
  return {
    holders: await countQ(db.collection('users').where(`holdings.${ticker}`, '>', 0)),
    shorts: await countQ(db.collection('users').where(`shorts.${ticker}.shares`, '>', 0)),
    limitOrders: await countQ(db.collection('limitOrders').where('ticker', '==', ticker)),
    priceAlerts: await countQ(db.collectionGroup('priceAlerts').where('ticker', '==', ticker)),
    trades: await countQ(db.collection('trades').where('ticker', '==', ticker)),
  };
};

// ============================================
// VERIFY
// ============================================

/** Things that must be true once every phase is done. [] means clean. */
const verifySplit = async (journal) => {
  const { ticker: t, splitId } = journal;
  const problems = [];
  const m = (await marketRef().get()).data() || {};
  const expectPrice = splitPrice(journal.priceBefore, journal.ratio);
  if (Math.abs((m.prices?.[t] || 0) - expectPrice) > 0.0001) {
    problems.push(`price is ${m.prices?.[t]}, expected ${expectPrice}`);
  }
  const idx = (await db.collection('market').doc('indexHistory').get()).data() || {};
  const entry = (idx.constituents || []).find((c) => c.t === t);
  if (entry && Math.abs(entry.b - CHARACTER_MAP[t].basePrice) > 0.0001) {
    problems.push(`index base is ${entry.b}, deployed basePrice is ${CHARACTER_MAP[t].basePrice}`);
  }
  // Every current holder carries this split's mark.
  const holders = await db.collection('users').where(`holdings.${t}`, '>', 0).get();
  const unmarked = holders.docs.filter((d) => !d.data().splitsApplied?.[splitId]).length;
  if (unmarked) problems.push(`${unmarked} holder(s) not split`);
  return problems;
};

// ============================================
// RUNNER
// ============================================

/**
 * Run or resume a split. `mode` is 'execute' or 'resume'; 'abort' gives up on
 * a run WITHOUT undoing it and leaves the market halted — a half-split stock is
 * not something to trade.
 *
 * The market must already be halted (preflight), and this never reopens it:
 * the admin reopens it by hand after checking, same as the rename runbook.
 */
const runSplit = async ({ ticker, ratio, mode, uid, timeBudgetMs = RENAME_TIME_BUDGET_MS }) => {
  const started = Date.now();
  const budget = { expired: () => Date.now() - started > timeBudgetMs };
  const jSnap = await journalRef().get();
  let journal = jSnap.exists ? jSnap.data() : null;

  if (mode === 'abort') {
    if (!journal) throw new functions.https.HttpsError('not-found', 'No split to abort.');
    await journalRef().set({ status: 'failed', abortedAt: Date.now() }, { merge: true });
    return { aborted: true, journal: { ...journal, status: 'failed' } };
  }

  if (mode === 'resume') {
    if (!journal) throw new functions.https.HttpsError('not-found', 'No split to resume.');
    if (journal.status === 'complete') return { alreadyComplete: true, journal };
    journal = { ...journal, status: 'running', lastError: null };
    await journalRef().set({ status: 'running', lastError: null }, { merge: true });
  } else if (journal && journal.status !== 'complete') {
    // Never start a second run over an unfinished one. It would get a new id,
    // and every document the first run already split would be split again.
    throw new functions.https.HttpsError('failed-precondition', journal.abortedAt
      ? `A $${journal.ticker} split was aborted part way, so some of its records are already split. Sort that out by hand before splitting again.`
      : `A $${journal.ticker} ${journal.ratio}-for-1 split is ${journal.status}. Resume it instead.`);
  } else {
    const market = (await marketRef().get()).data() || {};
    const before = await currentFactor(ticker);
    journal = {
      splitId: `s${started}`, ticker, ratio,
      factorBefore: before, factorAfter: before * ratio,
      priceBefore: market.prices?.[ticker],
      startedAt: started, startedBy: uid,
      phases: Object.fromEntries(PHASES.map((p) => [p.name, { status: 'pending', done: 0 }])),
      appliedDocs: {},
      status: 'running',
      lastError: null,
    };
    // A fresh run replaces the old journal outright, so nothing from a past
    // split (its applied-doc marks, its finish time) leaks into this one.
    await journalRef().set(journal);
  }

  const ctx = { ticker: journal.ticker, n: journal.ratio, splitId: journal.splitId };
  try {
    for (const phase of PHASES) {
      const state = journal.phases[phase.name] || { status: 'pending', done: 0 };
      if (state.status === 'complete') continue;
      if (budget.expired()) {
        await journalRef().set({ status: 'paused' }, { merge: true });
        return { paused: true, nextPhase: phase.name, journal: { ...journal, status: 'paused' } };
      }
      const result = await phase.run({ ...ctx, cursor: state.cursor || null, budget });
      journal.phases[phase.name] = {
        status: result.complete ? 'complete' : 'paused',
        done: (state.done || 0) + (result.done || 0),
        cursor: result.cursor || null,
        finishedAt: result.complete ? Date.now() : null,
      };
      await journalRef().set({ phases: journal.phases }, { merge: true });
      if (!result.complete) {
        await journalRef().set({ status: 'paused' }, { merge: true });
        return { paused: true, nextPhase: phase.name, journal: { ...journal, status: 'paused' } };
      }
    }

    const problems = await verifySplit(journal);
    if (problems.length) {
      await journalRef().set({ status: 'failed', lastError: problems.join('; ') }, { merge: true });
      throw new functions.https.HttpsError('internal', `Split check failed: ${problems.join('; ')}. Market stays halted. Resume to retry.`);
    }

    await historyRef().set({
      [ctx.ticker]: {
        factor: journal.factorAfter,
        splits: admin.firestore.FieldValue.arrayUnion({ ratio: ctx.n, at: Date.now(), splitId: ctx.splitId }),
      },
    }, { merge: true });
    await journalRef().set({ status: 'complete', finishedAt: Date.now() }, { merge: true });
    return { success: true, ticker: ctx.ticker, ratio: ctx.n, journal: { ...journal, status: 'complete' } };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    await journalRef().set({ status: 'failed', lastError: err.message }, { merge: true });
    throw new functions.https.HttpsError('internal', `Split failed part way: ${err.message}. Market stays halted. Resume from the admin panel.`);
  }
};

module.exports = {
  PHASES,
  runPreflight,
  countDryRun,
  runSplit,
  verifySplit,
  // exported for unit tests
  splitPrice,
  splitShares,
  splitPoints,
  splitTradeHistory,
  buildUserSplitUpdates,
  buildMarketSplitUpdates,
  buildOrderSplitUpdates,
  buildTradeSplitUpdates,
};
