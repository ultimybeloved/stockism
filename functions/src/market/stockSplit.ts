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
// And one thing that is NOT data: characters.ts must already carry the new
// splitFactor, deployed, which divides basePrice and multiplies liquidity (see
// liquidityFor in helpers.js). Without the liquidity change the same dollar
// trade would move a 10-for-1 stock about 3x as far. Preflight refuses to run
// until the deployed factor matches.
//
// Left as history: feed messages (7-day TTL) and old notifications.

import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

const db = admin.firestore();

import { CHARACTER_MAP } from '../shared/characters';
import {
  RENAME_TIME_BUDGET_MS,
  RENAME_JOURNAL_DOC,
  TICKER_PATTERN,
  SPLIT_JOURNAL_DOC,
  SPLIT_HISTORY_DOC,
  SPLIT_MIN_RATIO,
  SPLIT_MAX_RATIO,
} from '../shared/constants';
import { priceHistoryRef } from '../shared/marketData';
import { walkQuery } from './migrationWalk';
import type { Budget, WalkResult } from './migrationWalk';
import type { DocumentData, DocumentReference, Query } from 'firebase-admin/firestore';
import {
  Updates,
  splitPrice,
  splitShares,
  splitPoints,
  splitTradeHistory,
  buildUserSplitUpdates,
  buildMarketSplitUpdates,
  buildOrderSplitUpdates,
  buildTradeSplitUpdates,
} from './stockSplitMath';
// Callers and tests import these from stockSplit, as before.
export * from './stockSplitMath';

/** What every phase is called with. */
interface PhaseArgs {
  ticker: string;
  n: number;
  splitId: string;
  cursor?: string | null;
  budget: Budget;
}

const marketRef = () => db.collection('market').doc('current');
const journalRef = () => db.collection('market').doc(SPLIT_JOURNAL_DOC);
const historyRef = () => db.collection('market').doc(SPLIT_HISTORY_DOC);

// ============================================
// PHASES
// ============================================

/**
 * One market document, atomically with its journal mark, so a crash between
 * the two can never make a resume apply it twice.
 */
const applyOnce = async (
  key: string,
  ref: DocumentReference,
  build: (data: DocumentData) => Updates,
  splitId: string,
) => {
  const [docSnap, jSnap] = await Promise.all([ref.get(), journalRef().get()]);
  if (jSnap.data()?.appliedDocs?.[key] === splitId) return 0;
  const updates = docSnap.exists ? build(docSnap.data() || {}) : {};
  const batch = db.batch();
  if (Object.keys(updates).length) batch.update(ref, updates);
  batch.set(journalRef(), { appliedDocs: { [key]: splitId } }, { merge: true });
  await batch.commit();
  return Object.keys(updates).length ? 1 : 0;
};

const walkMarked =
  (queryFn: () => Query, build: (data: DocumentData) => Updates, opts?: { group?: boolean }) =>
  ({ cursor, budget }: { cursor?: string | null; budget: Budget }) =>
    walkQuery(queryFn, cursor, (data) => build(data), budget, opts);

export const PHASES: { name: string; label: string; run: (args: PhaseArgs) => Promise<WalkResult> }[] = [
  {
    name: 'market',
    label: 'Price, records and chart history',
    run: async ({ ticker: t, n, splitId }) => {
      const m = db.collection('market');
      let done = 0;
      done += await applyOnce('current', marketRef(), (d) => buildMarketSplitUpdates(d, t, n), splitId);
      done += await applyOnce(
        'priceHistory',
        priceHistoryRef(),
        (d) => (d[t] !== undefined ? { [t]: splitPoints(d[t], n) } : {}),
        splitId,
      );
      done += await applyOnce(
        'archive',
        marketRef().collection('price_history').doc(t),
        (d) => (d.history ? { history: splitPoints(d.history, n) } : {}),
        splitId,
      );
      const closes = await marketRef().collection('daily_closes').get();
      for (const doc of closes.docs) {
        done += await applyOnce(
          `closes_${doc.id}`,
          doc.ref,
          (d) => {
            const up: Updates = {};
            for (const [day, byTicker] of Object.entries((d.closes || {}) as Record<string, DocumentData | null>)) {
              if (typeof byTicker?.[t] === 'number') up[`closes.${day}.${t}`] = splitPrice(byTicker[t], n);
            }
            return up;
          },
          splitId,
        );
      }
      done += await applyOnce(
        'preHaltSnapshot',
        m.doc('preHaltSnapshot'),
        (d) => (typeof d.prices?.[t] === 'number' ? { [`prices.${t}`]: splitPrice(d.prices[t], n) } : {}),
        splitId,
      );
      done += await applyOnce(
        'tickerStats',
        m.doc('tickerStats'),
        (d) => (typeof d[t]?.shares === 'number' ? { [`${t}.shares`]: splitShares(d[t].shares, n) } : {}),
        splitId,
      );
      done += await applyOnce(
        'reviewChanges',
        m.doc('reviewChanges'),
        (d) => {
          const c = d.changes?.[t];
          return c
            ? { [`changes.${t}`]: { ...c, oldPrice: splitPrice(c.oldPrice, n), newPrice: splitPrice(c.newPrice, n) } }
            : {};
        },
        splitId,
      );
      done += await applyOnce(
        'reviewDetail',
        m.doc('reviewDetail'),
        (d) => (d.detail?.[t] ? { [`detail.${t}`]: splitPoints(d.detail[t], n) } : {}),
        splitId,
      );
      done += await applyOnce(
        'indexHistory',
        m.doc('indexHistory'),
        (d) => {
          if (!Array.isArray(d.constituents) || !d.constituents.some((c: DocumentData) => c.t === t)) return {};
          return {
            constituents: d.constituents.map((c: DocumentData) => (c.t === t ? { ...c, b: splitPrice(c.b, n) } : c)),
          };
        },
        splitId,
      );
      return { done, complete: true };
    },
  },
  {
    name: 'users',
    label: 'Player holdings, shorts and lots',
    run: ({ ticker, n, splitId, cursor, budget }) =>
      walkQuery(
        () => db.collection('users'),
        cursor,
        (u) => buildUserSplitUpdates(u, ticker, n, splitId),
        budget,
      ),
  },
  {
    name: 'limitOrders',
    label: 'Limit orders',
    run: ({ ticker, n, splitId, cursor, budget }) =>
      walkMarked(
        () => db.collection('limitOrders').where('ticker', '==', ticker),
        (o) => buildOrderSplitUpdates(o, n, splitId),
      )({ cursor, budget }),
  },
  {
    name: 'priceAlerts',
    label: 'Price alerts',
    run: ({ ticker, n, splitId, cursor, budget }) =>
      walkMarked(
        () => db.collectionGroup('priceAlerts').where('ticker', '==', ticker),
        (a) =>
          a.splitsApplied?.[splitId] || typeof a.targetPrice !== 'number'
            ? {}
            : { targetPrice: splitPrice(a.targetPrice, n), [`splitsApplied.${splitId}`]: true },
        { group: true },
      )({ cursor, budget }),
  },
  {
    name: 'trades',
    label: 'Trade records',
    run: ({ ticker, n, splitId, cursor, budget }) =>
      walkMarked(
        () => db.collection('trades').where('ticker', '==', ticker),
        (tr) => buildTradeSplitUpdates(tr, n, splitId),
      )({ cursor, budget }),
  },
  {
    name: 'ipTracking',
    label: 'IP trade tracking',
    // 24h of anti-manipulation state. Skipping it would hand every network a
    // share count 1/N of what it really traded today.
    run: ({ ticker, n, splitId, cursor, budget }) =>
      walkQuery(
        () => db.collection('ipTracking'),
        cursor,
        (d) =>
          d.splitsApplied?.[splitId] || !d.tickerTradeHistory?.[ticker]
            ? {}
            : {
                [`tickerTradeHistory.${ticker}`]: splitTradeHistory(d.tickerTradeHistory[ticker], n),
                [`splitsApplied.${splitId}`]: true,
              },
        budget,
      ),
  },
];

// ============================================
// PREFLIGHT
// ============================================

const currentFactor = async (ticker: string): Promise<number> =>
  ((await historyRef().get()).data() || {})[ticker]?.factor || 1;

/** Blocking checks, all shown in the dry run. */
export const runPreflight = async ({
  ticker,
  ratio,
  marketData,
}: {
  ticker: string;
  ratio: number;
  marketData: DocumentData;
}) => {
  const checks: { id: string; label: string; pass: boolean; detail: string }[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, pass, detail });
  const c = CHARACTER_MAP[ticker];
  const before = await currentFactor(ticker);
  const want = before * ratio;

  add(
    'format',
    'Ticker and ratio are valid',
    TICKER_PATTERN.test(ticker) && Number.isInteger(ratio) && ratio >= SPLIT_MIN_RATIO && ratio <= SPLIT_MAX_RATIO,
    `A whole-number ratio from ${SPLIT_MIN_RATIO} to ${SPLIT_MAX_RATIO}.`,
  );
  add(
    'roster',
    'A character stock with a live price',
    !!c && !c.isETF && typeof marketData.prices?.[ticker] === 'number',
    !c
      ? `${ticker} is not in the deployed roster.`
      : c.isETF
        ? 'Funds are not split.'
        : `$${ticker} is at ${marketData.prices?.[ticker]}.`,
  );
  add(
    'deployed',
    `characters.ts has splitFactor ${want}, deployed`,
    (c?.splitFactor || 1) === want,
    `Deployed splitFactor is ${c?.splitFactor || 1}; this split needs ${want} (${before} so far x ${ratio}). ` +
      'Add it to src/characters.ts, run sync:chars, and deploy functions — with the market already halted.',
  );
  add(
    'halted',
    'The market is halted',
    !!marketData.marketHalted,
    'Halt it by hand BEFORE deploying the new splitFactor: from that deploy until the split runs, the index and ' +
      'price impact read the new factor against the old price.',
  );

  const pendingPre = await db
    .collection('preMarketOrders')
    .where('ticker', '==', ticker)
    .where('status', '==', 'PENDING')
    .limit(1)
    .get();
  add(
    'preMarket',
    'No pending pre-market orders',
    pendingPre.empty,
    pendingPre.empty ? 'Nothing queued.' : 'Wait for the opening auction or cancel them first.',
  );

  const [jSnap, rSnap] = await Promise.all([journalRef().get(), db.collection('market').doc(RENAME_JOURNAL_DOC).get()]);
  const journal = jSnap.exists ? jSnap.data()! : null;
  const open = !!journal && journal.status !== 'complete';
  const renameOpen =
    rSnap.exists && rSnap.data()!.status && rSnap.data()!.status !== 'complete' && rSnap.data()!.status !== 'failed';
  add(
    'journal',
    'No split or rename is part-finished',
    !open && !renameOpen,
    open
      ? journal!.abortedAt
        ? `The $${journal!.ticker} split was aborted part way; its records are half split. Fix by hand first.`
        : `$${journal!.ticker} ${journal!.ratio}-for-1 is ${journal!.status}. Resume it.`
      : renameOpen
        ? 'A ticker rename is running.'
        : 'No conflicting run.',
  );

  return { checks, blocked: checks.some((x) => !x.pass), journal, before };
};

/** How much each phase will touch, for the dry run. */
export const countDryRun = async ({ ticker }: { ticker: string }) => {
  const countQ = async (q: Query) => (await q.count().get()).data()!.count;
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
export const verifySplit = async (journal: DocumentData) => {
  const { ticker: t, splitId } = journal;
  const problems: string[] = [];
  const m = (await marketRef().get()).data() || {};
  const expectPrice = splitPrice(journal.priceBefore, journal.ratio);
  if (Math.abs((m.prices?.[t] || 0) - expectPrice) > 0.0001) {
    problems.push(`price is ${m.prices?.[t]}, expected ${expectPrice}`);
  }
  const idx = (await db.collection('market').doc('indexHistory').get()).data() || {};
  const entry = (idx.constituents || []).find((c: DocumentData) => c.t === t);
  if (entry && Math.abs(entry.b - CHARACTER_MAP[t]!.basePrice) > 0.0001) {
    problems.push(`index base is ${entry.b}, deployed basePrice is ${CHARACTER_MAP[t]!.basePrice}`);
  }
  // Every current holder carries this split's mark.
  const holders = await db.collection('users').where(`holdings.${t}`, '>', 0).get();
  const unmarked = holders.docs.filter((d) => !d.data()!.splitsApplied?.[splitId]).length;
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
export const runSplit = async ({
  ticker,
  ratio,
  mode,
  uid,
  timeBudgetMs = RENAME_TIME_BUDGET_MS,
}: {
  ticker: string;
  ratio: number;
  mode: string;
  uid: string;
  timeBudgetMs?: number;
}) => {
  const started = Date.now();
  const budget = { expired: () => Date.now() - started > timeBudgetMs };
  const jSnap = await journalRef().get();
  let journal: DocumentData | null = jSnap.exists ? jSnap.data()! : null;

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
    throw new functions.https.HttpsError(
      'failed-precondition',
      journal.abortedAt
        ? `A $${journal.ticker} split was aborted part way, so some of its records are already split. Sort that out by hand before splitting again.`
        : `A $${journal.ticker} ${journal.ratio}-for-1 split is ${journal.status}. Resume it instead.`,
    );
  } else {
    const market = (await marketRef().get()).data() || {};
    const before = await currentFactor(ticker);
    journal = {
      splitId: `s${started}`,
      ticker,
      ratio,
      factorBefore: before,
      factorAfter: before * ratio,
      priceBefore: market.prices?.[ticker],
      startedAt: started,
      startedBy: uid,
      phases: Object.fromEntries(PHASES.map((p) => [p.name, { status: 'pending', done: 0 }])),
      appliedDocs: {},
      status: 'running',
      lastError: null,
    };
    // A fresh run replaces the old journal outright, so nothing from a past
    // split (its applied-doc marks, its finish time) leaks into this one.
    await journalRef().set(journal);
  }

  const ctx = { ticker: journal!.ticker, n: journal!.ratio, splitId: journal!.splitId };
  const j = journal!;
  try {
    for (const phase of PHASES) {
      const state = j.phases[phase.name] || { status: 'pending', done: 0 };
      if (state.status === 'complete') continue;
      if (budget.expired()) {
        await journalRef().set({ status: 'paused' }, { merge: true });
        return { paused: true, nextPhase: phase.name, journal: { ...j, status: 'paused' } };
      }
      const result = await phase.run({ ...ctx, cursor: state.cursor || null, budget });
      j.phases[phase.name] = {
        status: result.complete ? 'complete' : 'paused',
        done: (state.done || 0) + (result.done || 0),
        cursor: result.cursor || null,
        finishedAt: result.complete ? Date.now() : null,
      };
      await journalRef().set({ phases: j.phases }, { merge: true });
      if (!result.complete) {
        await journalRef().set({ status: 'paused' }, { merge: true });
        return { paused: true, nextPhase: phase.name, journal: { ...j, status: 'paused' } };
      }
    }

    const problems = await verifySplit(j);
    if (problems.length) {
      await journalRef().set({ status: 'failed', lastError: problems.join('; ') }, { merge: true });
      throw new functions.https.HttpsError(
        'internal',
        `Split check failed: ${problems.join('; ')}. Market stays halted. Resume to retry.`,
      );
    }

    await historyRef().set(
      {
        [ctx.ticker]: {
          factor: j.factorAfter,
          splits: FieldValue.arrayUnion({ ratio: ctx.n, at: Date.now(), splitId: ctx.splitId }),
        },
      },
      { merge: true },
    );
    await journalRef().set({ status: 'complete', finishedAt: Date.now() }, { merge: true });
    return { success: true, ticker: ctx.ticker, ratio: ctx.n, journal: { ...j, status: 'complete' } };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    const message = (err as Error).message;
    await journalRef().set({ status: 'failed', lastError: message }, { merge: true });
    throw new functions.https.HttpsError(
      'internal',
      `Split failed part way: ${message}. Market stays halted. Resume from the admin panel.`,
    );
  }
};
