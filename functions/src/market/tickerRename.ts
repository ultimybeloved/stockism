// Ticker rename engine.
//
// INTERNAL MODULE — required directly by adminMigrate.js, deliberately absent
// from servicePaths.js. It exports no Cloud Functions.
//
// The old implementation rewrote six locations and left about twenty behind,
// including the dividend loyalty ledger and the index constituent list. It also
// un-halted the market when it failed, which meant live trading against a
// half-renamed database. This replaces it.
//
// Three ideas hold the design together:
//
// 1. REWRITE what the game computes on. ALIAS what is only a historical record
//    a human reads. Rewriting every notification anyone ever received is a lot
//    of writes to change text nobody will look at; a permanent old->new map on
//    market/current resolves those on read instead, and also defends against a
//    restored backup resurrecting the old ticker.
//
// 2. JOURNAL every phase. A rename touches thousands of documents and cannot be
//    one transaction, so it is a sequence of idempotent phases with a cursor and
//    a time budget. A timeout pauses; it does not corrupt.
//
// 3. STAY HALTED on anything but success. The market reopens only after a
//    verification scan finds zero occurrences of the old ticker.
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';

const db = admin.firestore();

import { RENAME_TIME_BUDGET_MS } from '../shared/constants';
import { priceHistoryRef } from '../shared/marketData';
import type { DocumentData, DocumentReference } from 'firebase-admin/firestore';
import type { PricePoint } from '../shared/types';

const DELETE = () => admin.firestore.FieldValue.delete();

// What a rename means for each document: pure helpers, in tickerRemap.js so
// they test without an emulator.
import {
  mapMoveUpdates,
  remapArrayOfStrings,
  remapObjectArray,
  remapMessage,
  collapseAliasChain,
  buildUserUpdates,
  buildMarketUpdates,
  USER_TICKER_MAPS,
  MARKET_TICKER_MAPS,
} from './tickerRemap';

// ============================================
// PHASE HELPERS
// ============================================
// Shared with the stock split; see migrationWalk.js.
import { drainQuery, walkCollection } from './migrationWalk';
import type { Budget, WalkResult } from './migrationWalk';
import { marketRef, journalRef, verifyClean } from './tickerRenameChecks';

/** What every phase is called with. */
interface PhaseArgs {
  old: string;
  nw: string;
  cursor?: string | null;
  budget: Budget;
}

const byTimestamp = (a: PricePoint, b: PricePoint) => (a.timestamp || 0) - (b.timestamp || 0);

// ============================================
// PHASES
// ============================================
// Order matters: market state first so the stock exists under its new name
// before anything referring to it is touched, players next, then the records.

export const PHASES: { name: string; label: string; run: (args: PhaseArgs) => Promise<WalkResult> }[] = [
  {
    name: 'marketCurrent',
    label: 'Market document',
    run: async ({ old, nw }) => {
      const snap = await marketRef().get();
      const updates = buildMarketUpdates(snap.data() || {}, old, nw);
      await marketRef().update(updates);
      return { done: 1, complete: true };
    },
  },
  {
    name: 'priceHistory',
    label: 'Live price history',
    run: async ({ old, nw }) => {
      const snap = await priceHistoryRef().get();
      const data = snap.exists ? snap.data() || {} : {};
      if (data[old] === undefined) return { done: 0, complete: true };
      // Merge rather than overwrite: a crashed run may have written some of the
      // new key already, and losing chart points is not recoverable.
      const merged = [...(data[nw] || []), ...data[old]].sort(byTimestamp);
      await priceHistoryRef().update({ [nw]: merged, [old]: DELETE() });
      return { done: 1, complete: true };
    },
  },
  {
    name: 'priceArchive',
    label: 'Archived price history and daily closes',
    run: async ({ old, nw }) => {
      let done = 0;
      // The archive keys history by DOCUMENT ID, so this is a real move.
      const archive = db.collection('market').doc('current').collection('price_history');
      const oldDoc = await archive.doc(old).get();
      if (oldDoc.exists) {
        const newDoc = await archive.doc(nw).get();
        const oldHist = (oldDoc.data() || {}).history || [];
        const newHist = newDoc.exists ? (newDoc.data() || {}).history || [] : [];
        const merged = [...newHist, ...oldHist].sort(byTimestamp);
        await archive.doc(nw).set(
          {
            history: merged,
            lastUpdated: Date.now(),
            renamedFrom: old,
          },
          { merge: true },
        );
        await archive.doc(old).delete();
        done++;
      }

      // Daily closes are nested closes.<day>.<ticker>, one document per month.
      const closesSnap = await db.collection('market').doc('current').collection('daily_closes').get();
      for (const doc of closesSnap.docs) {
        const closes = (doc.data() || {}).closes || {};
        const updates: Record<string, unknown> = {};
        for (const [day, byTicker] of Object.entries(closes as Record<string, DocumentData | null>)) {
          if (byTicker && byTicker[old] !== undefined) {
            updates[`closes.${day}.${nw}`] = byTicker[old];
            updates[`closes.${day}.${old}`] = DELETE();
          }
        }
        if (Object.keys(updates).length) {
          await doc.ref.update(updates);
          done++;
        }
      }
      return { done, complete: true };
    },
  },
  {
    name: 'marketDocs',
    label: 'Market side documents',
    run: async ({ old, nw }) => {
      let done = 0;
      const move = async (ref: DocumentReference, build: (data: DocumentData) => Record<string, unknown>) => {
        const snap = await ref.get();
        if (!snap.exists) return;
        const updates = build(snap.data() || {});
        if (Object.keys(updates).length) {
          await ref.update(updates);
          done++;
        }
      };

      const m = db.collection('market');
      // Dividends are paid off the pre-halt snapshot, so a rename that misses
      // it pays this week's holders nothing.
      await move(m.doc('preHaltSnapshot'), (d) => mapMoveUpdates('prices', d.prices, old, nw));
      // tickerStats keys flow stats by ticker at the TOP level, and also
      // carries a nested shortInterest map that the neglect decay reads. Miss
      // that one and a renamed stock looks un-shorted, which silently switches
      // its decay back on.
      await move(m.doc('tickerStats'), (d) => {
        const updates: Record<string, unknown> = {};
        if (d[old] !== undefined) {
          updates[nw] = d[old];
          updates[old] = DELETE();
        }
        Object.assign(updates, mapMoveUpdates('shortInterest', d.shortInterest, old, nw));
        return updates;
      });
      await move(m.doc('reviewChanges'), (d) => mapMoveUpdates('changes', d.changes, old, nw));
      await move(m.doc('reviewDetail'), (d) => mapMoveUpdates('detail', d.detail, old, nw));

      // The index compares its stored constituent list against the deployed
      // roster. Leave the old name here and reconcileDivisor reads it as a
      // roster change and silently rescales the divisor — and season tiers are
      // scored against that line.
      await move(m.doc('indexHistory'), (d) => {
        const c = remapObjectArray(d.constituents, 't', old, nw);
        return c ? { constituents: c } : {};
      });
      await move(m.doc('ipos'), (d) => {
        const list = remapObjectArray(d.list, 'ticker', old, nw);
        return list ? { list } : {};
      });
      await move(db.collection('dividendConfig').doc('tierOverrides'), (d) =>
        mapMoveUpdates('tiers', d.tiers, old, nw),
      );

      return { done, complete: true };
    },
  },
  {
    name: 'users',
    label: 'Player documents',
    run: ({ old, nw, cursor, budget }) =>
      walkCollection('users', cursor, (data) => buildUserUpdates(data, old, nw), budget),
  },
  {
    name: 'priceAlerts',
    label: 'Price alerts',
    run: ({ old, nw, budget }) =>
      drainQuery(
        () => db.collectionGroup('priceAlerts').where('ticker', '==', old),
        () => ({ ticker: nw }),
        budget,
      ),
  },
  {
    name: 'trades',
    label: 'Trade records',
    run: ({ old, nw, budget }) =>
      drainQuery(
        () => db.collection('trades').where('ticker', '==', old),
        () => ({ ticker: nw }),
        budget,
      ),
  },
  {
    name: 'limitOrders',
    label: 'Limit orders',
    run: ({ old, nw, budget }) =>
      drainQuery(
        () => db.collection('limitOrders').where('ticker', '==', old),
        () => ({ ticker: nw }),
        budget,
      ),
  },
  {
    name: 'preMarketOrders',
    label: 'Pre-market orders',
    // Document IDs embed the ticker but are only a per-session dedupe key, so a
    // stale id on a filled order is harmless. Preflight already refused if any
    // were still pending.
    run: ({ old, nw, budget }) =>
      drainQuery(
        () => db.collection('preMarketOrders').where('ticker', '==', old),
        () => ({ ticker: nw }),
        budget,
      ),
  },
  {
    name: 'ipTracking',
    label: 'IP trade tracking',
    // Expires after 24h, so this is one day of anti-manipulation state. Kept
    // because skipping it hands everyone a fresh daily impact budget.
    run: ({ old, nw, cursor, budget }) =>
      walkCollection(
        'ipTracking',
        cursor,
        (data) => mapMoveUpdates('tickerTradeHistory', data.tickerTradeHistory, old, nw),
        budget,
      ),
  },
  {
    name: 'feed',
    label: 'Activity feed',
    // Bounded by the feed's own 7-day TTL. The ticker also appears inside the
    // free-text message, and rewriting only the field would leave the sentence
    // players read still saying the old name.
    run: ({ old, nw, budget }) =>
      drainQuery(
        () => db.collection('feed').where('ticker', '==', old),
        (doc) => {
          const updates: Record<string, unknown> = { ticker: nw };
          const msg = remapMessage((doc.data() || {}).message, old, nw);
          if (msg) updates.message = msg;
          return updates;
        },
        budget,
      ),
  },
];

// ============================================
// RUNNER
// ============================================

const freshJournal = ({
  old,
  nw,
  uid,
  haltWasPreexisting,
}: {
  old: string;
  nw: string;
  uid: string;
  haltWasPreexisting: boolean;
}) => ({
  old,
  new: nw,
  startedAt: Date.now(),
  startedBy: uid,
  status: 'running',
  haltWasPreexisting,
  phases: Object.fromEntries(PHASES.map((p) => [p.name, { status: 'pending', done: 0 }])),
  lastError: null,
});

// haltReason renders to every player as a full-width red banner in the site
// ticker, so it stays neutral and names no tickers. The admin detail lives in
// the journal, which is what the recovery panel reads.
const HALT_REASON = 'Ticker reassignment underway';

const HALT_FIELDS = () => ({
  marketHalted: true,
  haltReason: HALT_REASON,
  haltedAt: Date.now(),
});

/**
 * Run or resume a rename.
 *
 * `mode` is 'execute' to start, 'resume' to continue a paused or failed run,
 * 'abort' to give up on one. Aborting does NOT roll back — it marks the journal
 * failed and leaves the market halted, because a partly renamed database is not
 * something to reopen trading on.
 */
export const runRename = async ({
  old,
  nw,
  mode,
  uid,
  timeBudgetMs = RENAME_TIME_BUDGET_MS,
}: {
  old: string;
  nw: string;
  mode: string;
  uid: string;
  timeBudgetMs?: number;
}) => {
  const started = Date.now();
  const budget = { expired: () => Date.now() - started > timeBudgetMs };

  const jSnap = await journalRef().get();
  let journal: DocumentData | null = jSnap.exists ? jSnap.data()! : null;

  if (mode === 'abort') {
    if (!journal) throw new functions.https.HttpsError('not-found', 'No rename to abort.');
    await journalRef().set({ status: 'failed', abortedAt: Date.now() }, { merge: true });
    return { aborted: true, marketHalted: true, journal: { ...journal, status: 'failed' } };
  }

  if (mode === 'resume') {
    if (!journal) throw new functions.https.HttpsError('not-found', 'No rename to resume.');
    if (journal.status === 'complete') return { alreadyComplete: true, journal };
    journal = { ...journal, status: 'running', lastError: null };
  } else {
    if (journal && journal.status !== 'complete' && journal.old === old && journal.new === nw) {
      journal = { ...journal, status: 'running', lastError: null };
    } else {
      const market = (await marketRef().get()).data() || {};
      journal = freshJournal({ old, nw, uid, haltWasPreexisting: !!market.marketHalted });
      await marketRef().update(HALT_FIELDS());
    }
  }

  const j = journal!;
  await journalRef().set(j);

  const ctx = { old: j.old, nw: j.new };

  try {
    for (const phase of PHASES) {
      const state = journal.phases[phase.name] || { status: 'pending', done: 0 };
      if (state.status === 'complete') continue;

      if (budget.expired()) {
        journal.status = 'paused';
        await journalRef().set(journal);
        return { paused: true, nextPhase: phase.name, journal };
      }

      const result = await phase.run({ ...ctx, cursor: state.cursor || null, budget });
      journal.phases[phase.name] = {
        status: result.complete ? 'complete' : 'paused',
        done: (state.done || 0) + (result.done || 0),
        cursor: result.cursor || null,
        finishedAt: result.complete ? Date.now() : null,
      };
      await journalRef().set(journal);

      if (!result.complete) {
        journal.status = 'paused';
        await journalRef().set(journal);
        return { paused: true, nextPhase: phase.name, journal };
      }
    }

    // Finalize. The market reopens only from here.
    const remaining = await verifyClean(ctx.old);
    if (remaining.length) {
      journal.status = 'failed';
      journal.lastError = `Verification found ${ctx.old} still present in ${remaining.length} place(s).`;
      journal.remaining = remaining;
      await journalRef().set(journal);
      throw new functions.https.HttpsError('internal', `${journal.lastError} Market stays halted. Resume to retry.`);
    }

    journal.status = 'complete';
    journal.finishedAt = Date.now();
    await journalRef().set(journal);

    if (!journal.haltWasPreexisting) {
      await marketRef().update({
        marketHalted: false,
        haltReason: '',
        haltedAt: null,
        haltedBy: null,
      });
    }

    return {
      success: true,
      oldTicker: ctx.old,
      newTicker: ctx.nw,
      marketHalted: !!journal.haltWasPreexisting,
      journal,
    };
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    j.status = 'failed';
    j.lastError = (err as Error).message;
    await journalRef().set(j);
    // Deliberately NOT un-halting. A half-renamed database with an open market
    // is the worst outcome available.
    //
    // The banner text does not change on failure: players do not need to be
    // told the migration broke, and the old wording printed admin instructions
    // to the whole site. The recovery panel reads the journal instead, and
    // shows its own red "resume or abort" banner to the admin.
    await marketRef().update({ marketHalted: true, haltReason: HALT_REASON });
    throw new functions.https.HttpsError(
      'internal',
      `Rename failed in progress: ${(err as Error).message}. Market stays halted. Resume from the admin panel.`,
    );
  }
};

export {
  mapMoveUpdates,
  remapArrayOfStrings,
  remapObjectArray,
  remapMessage,
  collapseAliasChain,
  buildUserUpdates,
  buildMarketUpdates,
  USER_TICKER_MAPS,
  MARKET_TICKER_MAPS,
};

// Re-exported so callers and tests keep one entry point.
export { runPreflight, verifyClean, countDryRun } from './tickerRenameChecks';
