'use strict';
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
const functions = require('firebase-functions');
const admin = require('firebase-admin');

const db = admin.firestore();

const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const { CREWS } = require('../crews');
const {
  RENAME_TIME_BUDGET_MS,
  RENAME_BATCH_SIZE,
  RENAME_PAGE_SIZE,
  RENAME_JOURNAL_DOC,
  TICKER_PATTERN,
} = require('../constants');
const { priceHistoryRef } = require('../helpers');

const DELETE = () => admin.firestore.FieldValue.delete();

const marketRef = () => db.collection('market').doc('current');
const journalRef = () => db.collection('market').doc(RENAME_JOURNAL_DOC);

// ============================================
// PURE REMAP HELPERS
// ============================================
// No Firestore handles, no async. Everything that decides what a rename means
// lives here so it can be tested without an emulator.

/**
 * Dotted-path updates moving one key of a ticker-keyed map.
 *
 * Returns {} when the old key is absent, which is what makes every phase safe
 * to re-run: a document already migrated produces no writes the second time.
 */
const mapMoveUpdates = (prefix, obj, old, nw) => {
  if (!obj || obj[old] === undefined) return {};
  return {
    [`${prefix}.${nw}`]: obj[old],
    [`${prefix}.${old}`]: DELETE(),
  };
};

/** A ticker array (launchedTickers, watchlist) with one entry swapped. */
const remapArrayOfStrings = (arr, old, nw) => {
  if (!Array.isArray(arr) || !arr.includes(old)) return null;
  // Dedupe in case both names somehow ended up present.
  const swapped = arr.map((t) => (t === old ? nw : t));
  return swapped.filter((t, i) => swapped.indexOf(t) === i);
};

/** An array of objects (transactionLog, indexHistory.constituents, ipos.list). */
const remapObjectArray = (arr, field, old, nw) => {
  if (!Array.isArray(arr)) return null;
  let hit = false;
  const out = arr.map((entry) => {
    if (!entry || entry[field] !== old) return entry;
    hit = true;
    return { ...entry, [field]: nw };
  });
  return hit ? out : null;
};

/**
 * Swap $OLD inside free text.
 *
 * The lookahead matters: renaming GUN must not touch "$GUNNER". Feed messages
 * read "bought 5 $GUN", and rewriting the ticker field alone would leave the
 * sentence players actually see still saying the old name.
 */
const remapMessage = (msg, old, nw) => {
  if (typeof msg !== 'string') return null;
  const swapped = msg.replace(new RegExp(`\\$${old}(?![A-Z0-9])`, 'g'), `$${nw}`);
  // Null means "nothing actually changed", so a message that only mentions
  // $GUNNER during a GUN rename is left alone instead of rewritten over itself.
  return swapped === msg ? null : swapped;
};

/**
 * Fold a new rename into the alias map, keeping every lookup one hop.
 *
 * Renaming B to C when A already points at B must leave A pointing at C, not
 * at a retired name that resolves to nothing.
 */
const collapseAliasChain = (existing, old, nw) => {
  const out = {};
  for (const [from, to] of Object.entries(existing || {})) {
    out[from] = to === old ? nw : to;
  }
  out[old] = nw;
  return out;
};

// Every ticker-keyed map on a player document. Losing any one of these is a
// silent data loss, and three of them were missing from the original tool:
// holdingCohorts is the dividend and exit-loyalty lot ledger, drip is the
// per-ticker reinvestment toggle, and loyaltyTierNotified suppresses duplicate
// tier-up notifications — dropping its key fires a spurious one at every holder.
const USER_TICKER_MAPS = [
  'holdings', 'shorts', 'costBasis', 'lastBuyTime', 'lowestWhileHolding',
  'shortHistory', 'ipoPurchases', 'lastTickerTradeTime', 'tickerTradeHistory',
  'holdingCohorts', 'profitByTicker', 'marginLockup', 'ipoLockup', 'drip',
  'loyaltyTierNotified',
];

// Ticker-keyed maps on market/current.
const MARKET_TICKER_MAPS = [
  'prices', 'volumes', 'dailyVolumes', 'liquidity', 'botImpact',
  'haltedTickers', 'ath', 'atl',
];

/** Everything one player document needs changed. {} means already migrated. */
const buildUserUpdates = (userData, old, nw) => {
  const updates = {};
  for (const mapName of USER_TICKER_MAPS) {
    Object.assign(updates, mapMoveUpdates(mapName, userData[mapName], old, nw));
  }
  const watchlist = remapArrayOfStrings(userData.watchlist, old, nw);
  if (watchlist) updates.watchlist = watchlist;

  const log = remapObjectArray(userData.transactionLog, 'ticker', old, nw);
  if (log) updates.transactionLog = log;

  return updates;
};

/** Everything market/current needs changed, alias entry included. */
const buildMarketUpdates = (marketData, old, nw) => {
  const updates = {};
  for (const mapName of MARKET_TICKER_MAPS) {
    Object.assign(updates, mapMoveUpdates(mapName, marketData[mapName], old, nw));
  }

  const launched = remapArrayOfStrings(marketData.launchedTickers, old, nw);
  if (launched) updates.launchedTickers = launched;

  // Alert thresholds are keyed "<TICKER>_10_up". They are throttle state, not
  // history, so they are dropped rather than moved — the worst case is one
  // repeated alert.
  for (const key of Object.keys(marketData.alertedThresholds || {})) {
    if (key.startsWith(`${old}_`)) updates[`alertedThresholds.${key}`] = DELETE();
  }

  updates.tickerAliases = collapseAliasChain(marketData.tickerAliases, old, nw);
  return updates;
};

// ============================================
// PREFLIGHT
// ============================================

/**
 * Nine blocking checks, every one of them shown in the dry run.
 *
 * The two that matter most are 2 and 3, which together prove the source edit
 * and the functions deploy already happened. Running the migration first makes
 * initNewCharacterPrices see the old ticker still in the roster with no price
 * and re-seed it at base price, producing a duplicate stock at the wrong price.
 */
const runPreflight = async ({ old, nw, marketData }) => {
  const checks = [];
  const add = (id, label, pass, detail) => checks.push({ id, label, pass, detail });

  const prices = marketData.prices || {};
  const aliases = marketData.tickerAliases || {};

  add('format', 'Both tickers are well formed',
    TICKER_PATTERN.test(old) && TICKER_PATTERN.test(nw),
    'Letters and digits only, 2 to 6 characters. A dot would be a field-path injection.');

  add('newInRoster', 'New ticker is in the deployed roster',
    !!CHARACTER_MAP[nw],
    CHARACTER_MAP[nw] ? `${nw} is "${CHARACTER_MAP[nw].name}"`
      : `${nw} is not in the deployed characters.js. Edit the source, run sync:chars, and deploy functions BEFORE renaming.`);

  add('oldNotInRoster', 'Old ticker is gone from the deployed roster',
    !CHARACTER_MAP[old],
    CHARACTER_MAP[old] ? `${old} is still in the deployed characters.js, so the deploy has not shipped yet.`
      : 'Confirms sync:chars and the functions deploy already ran.');

  const etfRefs = CHARACTERS.filter((c) => c.isETF && (
    (c.constituents || []).includes(old)
    || (c.trailingFactors || []).some((t) => t.ticker === old)
  )).map((c) => c.ticker);
  add('etfRefs', 'No fund still references the old ticker', etfRefs.length === 0,
    etfRefs.length ? `Still referenced by: ${etfRefs.join(', ')}` : 'Constituents and trailing factors are clean.');

  const crewRefs = Object.values(CREWS)
    .filter((c) => (c.members || []).includes(old)).map((c) => c.id);
  add('crewRefs', 'No crew roster still lists the old ticker', crewRefs.length === 0,
    crewRefs.length ? `Still on: ${crewRefs.join(', ')}` : 'Crew rosters are clean.');

  const oldPriced = prices[old] !== undefined;
  const newPriced = prices[nw] !== undefined;
  add('prices', 'Old ticker has a live price and the new one does not',
    oldPriced && !newPriced,
    !oldPriced ? `${old} has no live price, so there is nothing to rename.`
      : newPriced ? `${nw} already has a live price. Renaming onto it would merge two stocks.`
        : `${old} is at ${prices[old]}.`);

  add('alias', 'No alias collision',
    aliases[nw] === undefined && aliases[old] === undefined,
    aliases[nw] !== undefined ? `${nw} is a retired ticker that already redirects to ${aliases[nw]}.`
      : aliases[old] !== undefined ? `${old} already redirects to ${aliases[old]}.`
        : 'Neither name is already retired.');

  // Pre-market order document IDs embed the ticker, so a pending one cannot be
  // safely renamed in place — the dedupe key would stop matching.
  const pendingPre = await db.collection('preMarketOrders')
    .where('ticker', '==', old).where('status', '==', 'PENDING').limit(1).get();
  add('preMarket', 'No pending pre-market orders for the old ticker',
    pendingPre.empty,
    pendingPre.empty ? 'Nothing queued.'
      : 'Pending pre-market orders exist. Wait for the opening auction or cancel them first.');

  const jSnap = await journalRef().get();
  const journal = jSnap.exists ? jSnap.data() : null;
  const otherOpen = !!journal && journal.status !== 'complete'
    && !(journal.old === old && journal.new === nw);
  add('journal', 'No other rename is part-finished', !otherOpen,
    otherOpen ? `${journal.old} -> ${journal.new} is ${journal.status}. Resume or abort it first.`
      : 'No conflicting run.');

  return { checks, blocked: checks.some((c) => !c.pass), journal };
};

// ============================================
// PHASE HELPERS
// ============================================

const commitInChunks = async (writes) => {
  for (let i = 0; i < writes.length; i += RENAME_BATCH_SIZE) {
    const batch = db.batch();
    for (const w of writes.slice(i, i + RENAME_BATCH_SIZE)) batch.update(w.ref, w.updates);
    await batch.commit();
  }
};

/**
 * Drain a query that stops matching once rewritten.
 *
 * Because the rewrite removes the document from its own result set, this needs
 * no cursor and re-running it after a crash simply finds what is left.
 */
const drainQuery = async (queryFn, buildUpdates, budget) => {
  let done = 0;
  for (;;) {
    if (budget.expired()) return { done, complete: false };
    const snap = await queryFn().limit(RENAME_PAGE_SIZE).get();
    if (snap.empty) return { done, complete: true };
    const writes = [];
    for (const doc of snap.docs) {
      const updates = buildUpdates(doc);
      if (Object.keys(updates).length) writes.push({ ref: doc.ref, updates });
    }
    if (!writes.length) return { done, complete: true };
    await commitInChunks(writes);
    done += writes.length;
  }
};

/**
 * Walk a whole collection by document id.
 *
 * Used where the rewrite does not change what the query matches, so progress
 * has to be remembered explicitly.
 */
const walkCollection = async (collection, cursor, buildUpdates, budget) => {
  let done = 0;
  let last = cursor || null;
  for (;;) {
    if (budget.expired()) return { done, cursor: last, complete: false };
    let q = db.collection(collection).orderBy(admin.firestore.FieldPath.documentId())
      .limit(RENAME_PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) return { done, cursor: last, complete: true };

    const writes = [];
    for (const doc of snap.docs) {
      const updates = buildUpdates(doc.data(), doc);
      if (Object.keys(updates).length) writes.push({ ref: doc.ref, updates });
    }
    if (writes.length) await commitInChunks(writes);
    done += writes.length;
    last = snap.docs[snap.docs.length - 1].id;
    if (snap.size < RENAME_PAGE_SIZE) return { done, cursor: last, complete: true };
  }
};

// ============================================
// PHASES
// ============================================
// Order matters: market state first so the stock exists under its new name
// before anything referring to it is touched, players next, then the records.

const PHASES = [
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
      const data = snap.exists ? (snap.data() || {}) : {};
      if (data[old] === undefined) return { done: 0, complete: true };
      // Merge rather than overwrite: a crashed run may have written some of the
      // new key already, and losing chart points is not recoverable.
      const merged = [...(data[nw] || []), ...data[old]]
        .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
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
        const newHist = newDoc.exists ? ((newDoc.data() || {}).history || []) : [];
        const merged = [...newHist, ...oldHist]
          .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        await archive.doc(nw).set({
          history: merged, lastUpdated: Date.now(), renamedFrom: old,
        }, { merge: true });
        await archive.doc(old).delete();
        done++;
      }

      // Daily closes are nested closes.<day>.<ticker>, one document per month.
      const closesSnap = await db.collection('market').doc('current')
        .collection('daily_closes').get();
      for (const doc of closesSnap.docs) {
        const closes = (doc.data() || {}).closes || {};
        const updates = {};
        for (const [day, byTicker] of Object.entries(closes)) {
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
      const move = async (ref, build) => {
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
      // tickerStats is keyed by ticker at the top level, not inside a map.
      await move(m.doc('tickerStats'),
        (d) => (d[old] === undefined ? {} : { [nw]: d[old], [old]: DELETE() }));
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
      await move(db.collection('dividendConfig').doc('tierOverrides'),
        (d) => mapMoveUpdates('tiers', d.tiers, old, nw));

      return { done, complete: true };
    },
  },
  {
    name: 'users',
    label: 'Player documents',
    run: ({ old, nw, cursor, budget }) => walkCollection(
      'users', cursor, (data) => buildUserUpdates(data, old, nw), budget
    ),
  },
  {
    name: 'priceAlerts',
    label: 'Price alerts',
    run: ({ old, nw, budget }) => drainQuery(
      () => db.collectionGroup('priceAlerts').where('ticker', '==', old),
      () => ({ ticker: nw }), budget
    ),
  },
  {
    name: 'trades',
    label: 'Trade records',
    run: ({ old, nw, budget }) => drainQuery(
      () => db.collection('trades').where('ticker', '==', old),
      () => ({ ticker: nw }), budget
    ),
  },
  {
    name: 'limitOrders',
    label: 'Limit orders',
    run: ({ old, nw, budget }) => drainQuery(
      () => db.collection('limitOrders').where('ticker', '==', old),
      () => ({ ticker: nw }), budget
    ),
  },
  {
    name: 'preMarketOrders',
    label: 'Pre-market orders',
    // Document IDs embed the ticker but are only a per-session dedupe key, so a
    // stale id on a filled order is harmless. Preflight already refused if any
    // were still pending.
    run: ({ old, nw, budget }) => drainQuery(
      () => db.collection('preMarketOrders').where('ticker', '==', old),
      () => ({ ticker: nw }), budget
    ),
  },
  {
    name: 'ipTracking',
    label: 'IP trade tracking',
    // Expires after 24h, so this is one day of anti-manipulation state. Kept
    // because skipping it hands everyone a fresh daily impact budget.
    run: ({ old, nw, cursor, budget }) => walkCollection(
      'ipTracking', cursor,
      (data) => mapMoveUpdates('tickerTradeHistory', data.tickerTradeHistory, old, nw),
      budget
    ),
  },
  {
    name: 'feed',
    label: 'Activity feed',
    // Bounded by the feed's own 7-day TTL. The ticker also appears inside the
    // free-text message, and rewriting only the field would leave the sentence
    // players read still saying the old name.
    run: ({ old, nw, budget }) => drainQuery(
      () => db.collection('feed').where('ticker', '==', old),
      (doc) => {
        const updates = { ticker: nw };
        const msg = remapMessage((doc.data() || {}).message, old, nw);
        if (msg) updates.message = msg;
        return updates;
      }, budget
    ),
  },
];

// ============================================
// VERIFICATION
// ============================================

/** Every place the old ticker could still be hiding. [] means clean. */
const verifyClean = async (old) => {
  const remaining = [];
  const note = (where, count) => { if (count) remaining.push({ where, count }); };

  const market = (await marketRef().get()).data() || {};
  for (const mapName of MARKET_TICKER_MAPS) {
    note(`market/current.${mapName}`, (market[mapName] || {})[old] !== undefined ? 1 : 0);
  }
  note('market/current.launchedTickers', (market.launchedTickers || []).includes(old) ? 1 : 0);

  const hist = (await priceHistoryRef().get()).data() || {};
  note('market/priceHistory', hist[old] !== undefined ? 1 : 0);

  const archived = await db.collection('market').doc('current')
    .collection('price_history').doc(old).get();
  note('archived price history', archived.exists ? 1 : 0);

  const stats = (await db.collection('market').doc('tickerStats').get()).data() || {};
  note('market/tickerStats', stats[old] !== undefined ? 1 : 0);

  for (const [name, ref] of [
    ['preHaltSnapshot', db.collection('market').doc('preHaltSnapshot')],
    ['reviewChanges', db.collection('market').doc('reviewChanges')],
    ['reviewDetail', db.collection('market').doc('reviewDetail')],
  ]) {
    const d = (await ref.get()).data() || {};
    const inner = d.prices || d.changes || d.detail || {};
    note(`market/${name}`, inner[old] !== undefined ? 1 : 0);
  }

  const idx = (await db.collection('market').doc('indexHistory').get()).data() || {};
  note('market/indexHistory', (idx.constituents || []).some((c) => c.t === old) ? 1 : 0);

  for (const [name, q] of [
    ['trades', db.collection('trades').where('ticker', '==', old)],
    ['limitOrders', db.collection('limitOrders').where('ticker', '==', old)],
    ['preMarketOrders', db.collection('preMarketOrders').where('ticker', '==', old)],
    ['feed', db.collection('feed').where('ticker', '==', old)],
    ['priceAlerts', db.collectionGroup('priceAlerts').where('ticker', '==', old)],
  ]) {
    const snap = await q.limit(1).get();
    note(name, snap.size);
  }

  return remaining;
};

// ============================================
// DRY RUN
// ============================================

const countDryRun = async ({ old, nw }) => {
  const breakdown = {};
  const market = (await marketRef().get()).data() || {};
  breakdown.marketCurrent = Object.keys(buildMarketUpdates(market, old, nw)).length ? 1 : 0;

  const hist = (await priceHistoryRef().get()).data() || {};
  breakdown.priceHistory = hist[old] !== undefined ? 1 : 0;

  const archived = await db.collection('market').doc('current')
    .collection('price_history').doc(old).get();
  breakdown.priceArchive = archived.exists ? 1 : 0;

  let users = 0;
  let cursor = null;
  for (;;) {
    let q = db.collection('users').orderBy(admin.firestore.FieldPath.documentId())
      .limit(RENAME_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      if (Object.keys(buildUserUpdates(doc.data(), old, nw)).length) users++;
    }
    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < RENAME_PAGE_SIZE) break;
  }
  breakdown.users = users;

  const countQ = async (q) => (await q.count().get()).data().count;
  breakdown.trades = await countQ(db.collection('trades').where('ticker', '==', old));
  breakdown.limitOrders = await countQ(db.collection('limitOrders').where('ticker', '==', old));
  breakdown.preMarketOrders = await countQ(db.collection('preMarketOrders').where('ticker', '==', old));
  breakdown.feed = await countQ(db.collection('feed').where('ticker', '==', old));
  breakdown.priceAlerts = await countQ(db.collectionGroup('priceAlerts').where('ticker', '==', old));

  return breakdown;
};

// ============================================
// RUNNER
// ============================================

const freshJournal = ({ old, nw, uid, haltWasPreexisting }) => ({
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
const runRename = async ({ old, nw, mode, uid, timeBudgetMs = RENAME_TIME_BUDGET_MS }) => {
  const started = Date.now();
  const budget = { expired: () => Date.now() - started > timeBudgetMs };

  const jSnap = await journalRef().get();
  let journal = jSnap.exists ? jSnap.data() : null;

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
    if (journal && journal.status !== 'complete'
      && journal.old === old && journal.new === nw) {
      journal = { ...journal, status: 'running', lastError: null };
    } else {
      const market = (await marketRef().get()).data() || {};
      journal = freshJournal({ old, nw, uid, haltWasPreexisting: !!market.marketHalted });
      await marketRef().update(HALT_FIELDS());
    }
  }

  await journalRef().set(journal);

  const ctx = { old: journal.old, nw: journal.new };

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
      throw new functions.https.HttpsError('internal',
        `${journal.lastError} Market stays halted. Resume to retry.`);
    }

    journal.status = 'complete';
    journal.finishedAt = Date.now();
    await journalRef().set(journal);

    if (!journal.haltWasPreexisting) {
      await marketRef().update({
        marketHalted: false, haltReason: '', haltedAt: null, haltedBy: null,
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
    journal.status = 'failed';
    journal.lastError = err.message;
    await journalRef().set(journal);
    // Deliberately NOT un-halting. A half-renamed database with an open market
    // is the worst outcome available.
    //
    // The banner text does not change on failure: players do not need to be
    // told the migration broke, and the old wording printed admin instructions
    // to the whole site. The recovery panel reads the journal instead, and
    // shows its own red "resume or abort" banner to the admin.
    await marketRef().update({ marketHalted: true, haltReason: HALT_REASON });
    throw new functions.https.HttpsError('internal',
      `Rename failed in progress: ${err.message}. Market stays halted. Resume from the admin panel.`);
  }
};

module.exports = {
  PHASES,
  runPreflight,
  countDryRun,
  runRename,
  verifyClean,
  // exported for unit tests
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
