// The ticker rename's safety checks: preflight before it runs, the dry-run
// counts, and the verification scan before the market reopens. Split out of
// tickerRename.ts. INTERNAL MODULE: exports no Cloud Functions.
import * as admin from 'firebase-admin';
import { FieldPath } from 'firebase-admin/firestore';
import { CHARACTERS, CHARACTER_MAP } from '../shared/characters';
import { CREWS } from '../shared/crews';
import { RENAME_PAGE_SIZE, RENAME_JOURNAL_DOC, TICKER_PATTERN } from '../shared/constants';
import { priceHistoryRef } from '../shared/marketData';
import type { DocumentData, DocumentReference, Query } from 'firebase-admin/firestore';
import { buildUserUpdates, buildMarketUpdates, MARKET_TICKER_MAPS } from './tickerRemap';
const db = admin.firestore();

export const marketRef = () => db.collection('market').doc('current');
export const journalRef = () => db.collection('market').doc(RENAME_JOURNAL_DOC);
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
export const runPreflight = async ({ old, nw, marketData }: { old: string; nw: string; marketData: DocumentData }) => {
  const checks: { id: string; label: string; pass: boolean; detail: string }[] = [];
  const add = (id: string, label: string, pass: boolean, detail: string) => checks.push({ id, label, pass, detail });

  const prices = marketData.prices || {};
  const aliases = marketData.tickerAliases || {};

  add(
    'format',
    'Both tickers are well formed',
    TICKER_PATTERN.test(old) && TICKER_PATTERN.test(nw),
    'Letters and digits only, 2 to 6 characters. A dot would be a field-path injection.',
  );

  add(
    'newInRoster',
    'New ticker is in the deployed roster',
    !!CHARACTER_MAP[nw],
    CHARACTER_MAP[nw]
      ? `${nw} is "${CHARACTER_MAP[nw]!.name}"`
      : `${nw} is not in the deployed characters.ts. Edit the source, run sync:chars, and deploy functions BEFORE renaming.`,
  );

  add(
    'oldNotInRoster',
    'Old ticker is gone from the deployed roster',
    !CHARACTER_MAP[old],
    CHARACTER_MAP[old]
      ? `${old} is still in the deployed characters.ts, so the deploy has not shipped yet.`
      : 'Confirms sync:chars and the functions deploy already ran.',
  );

  const etfRefs = CHARACTERS.filter(
    (c) => c.isETF && ((c.constituents || []).includes(old) || (c.trailingFactors || []).some((t) => t.ticker === old)),
  ).map((c) => c.ticker);
  add(
    'etfRefs',
    'No fund still references the old ticker',
    etfRefs.length === 0,
    etfRefs.length ? `Still referenced by: ${etfRefs.join(', ')}` : 'Constituents and trailing factors are clean.',
  );

  const crewRefs = Object.values(CREWS)
    .filter((c) => (c.members || []).includes(old))
    .map((c) => c.id);
  add(
    'crewRefs',
    'No crew roster still lists the old ticker',
    crewRefs.length === 0,
    crewRefs.length ? `Still on: ${crewRefs.join(', ')}` : 'Crew rosters are clean.',
  );

  const oldPriced = prices[old] !== undefined;
  const newPriced = prices[nw] !== undefined;
  add(
    'prices',
    'Old ticker has a live price and the new one does not',
    oldPriced && !newPriced,
    !oldPriced
      ? `${old} has no live price, so there is nothing to rename.`
      : newPriced
        ? `${nw} already has a live price. Renaming onto it would merge two stocks.`
        : `${old} is at ${prices[old]}.`,
  );

  add(
    'alias',
    'No alias collision',
    aliases[nw] === undefined && aliases[old] === undefined,
    aliases[nw] !== undefined
      ? `${nw} is a retired ticker that already redirects to ${aliases[nw]}.`
      : aliases[old] !== undefined
        ? `${old} already redirects to ${aliases[old]}.`
        : 'Neither name is already retired.',
  );

  // Pre-market order document IDs embed the ticker, so a pending one cannot be
  // safely renamed in place — the dedupe key would stop matching.
  const pendingPre = await db
    .collection('preMarketOrders')
    .where('ticker', '==', old)
    .where('status', '==', 'PENDING')
    .limit(1)
    .get();
  add(
    'preMarket',
    'No pending pre-market orders for the old ticker',
    pendingPre.empty,
    pendingPre.empty
      ? 'Nothing queued.'
      : 'Pending pre-market orders exist. Wait for the opening auction or cancel them first.',
  );

  const jSnap = await journalRef().get();
  const journal = jSnap.exists ? jSnap.data()! : null;
  const otherOpen = !!journal && journal.status !== 'complete' && !(journal.old === old && journal.new === nw);
  add(
    'journal',
    'No other rename is part-finished',
    !otherOpen,
    otherOpen
      ? `${journal!.old} -> ${journal!.new} is ${journal!.status}. Resume or abort it first.`
      : 'No conflicting run.',
  );

  return { checks, blocked: checks.some((c) => !c.pass), journal };
};

// ============================================
// VERIFICATION
// ============================================

/** Every place the old ticker could still be hiding. [] means clean. */
export const verifyClean = async (old: string) => {
  const remaining: { where: string; count: number }[] = [];
  const note = (where: string, count: number) => {
    if (count) remaining.push({ where, count });
  };

  const market = (await marketRef().get()).data() || {};
  for (const mapName of MARKET_TICKER_MAPS) {
    note(`market/current.${mapName}`, (market[mapName] || {})[old] !== undefined ? 1 : 0);
  }
  note('market/current.launchedTickers', (market.launchedTickers || []).includes(old) ? 1 : 0);

  const hist = (await priceHistoryRef().get()).data() || {};
  note('market/priceHistory', hist[old] !== undefined ? 1 : 0);

  const archived = await db.collection('market').doc('current').collection('price_history').doc(old).get();
  note('archived price history', archived.exists ? 1 : 0);

  const stats = (await db.collection('market').doc('tickerStats').get()).data() || {};
  note('market/tickerStats', stats[old] !== undefined ? 1 : 0);
  note('market/tickerStats.shortInterest', (stats.shortInterest || {})[old] !== undefined ? 1 : 0);

  for (const [name, ref] of [
    ['preHaltSnapshot', db.collection('market').doc('preHaltSnapshot')],
    ['reviewChanges', db.collection('market').doc('reviewChanges')],
    ['reviewDetail', db.collection('market').doc('reviewDetail')],
  ] as [string, DocumentReference][]) {
    const d = (await ref.get()).data() || {};
    const inner = d.prices || d.changes || d.detail || {};
    note(`market/${name}`, inner[old] !== undefined ? 1 : 0);
  }

  const idx = (await db.collection('market').doc('indexHistory').get()).data() || {};
  note('market/indexHistory', (idx.constituents || []).some((c: { t: string }) => c.t === old) ? 1 : 0);

  for (const [name, q] of [
    ['trades', db.collection('trades').where('ticker', '==', old)],
    ['limitOrders', db.collection('limitOrders').where('ticker', '==', old)],
    ['preMarketOrders', db.collection('preMarketOrders').where('ticker', '==', old)],
    ['feed', db.collection('feed').where('ticker', '==', old)],
    ['priceAlerts', db.collectionGroup('priceAlerts').where('ticker', '==', old)],
  ] as [string, Query][]) {
    const snap = await q.limit(1).get();
    note(name, snap.size);
  }

  return remaining;
};

// ============================================
// DRY RUN
// ============================================

export const countDryRun = async ({ old, nw }: { old: string; nw: string }) => {
  const breakdown: Record<string, number> = {};
  const market = (await marketRef().get()).data() || {};
  breakdown.marketCurrent = Object.keys(buildMarketUpdates(market, old, nw)).length ? 1 : 0;

  const hist = (await priceHistoryRef().get()).data() || {};
  breakdown.priceHistory = hist[old] !== undefined ? 1 : 0;

  const archived = await db.collection('market').doc('current').collection('price_history').doc(old).get();
  breakdown.priceArchive = archived.exists ? 1 : 0;

  let users = 0;
  let cursor: string | null = null;
  for (;;) {
    let q = db.collection('users').orderBy(FieldPath.documentId()).limit(RENAME_PAGE_SIZE);
    if (cursor) q = q.startAfter(cursor);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      if (Object.keys(buildUserUpdates(doc.data(), old, nw)).length) users++;
    }
    cursor = snap.docs[snap.docs.length - 1]!.id;
    if (snap.size < RENAME_PAGE_SIZE) break;
  }
  breakdown.users = users;

  const countQ = async (q: Query) => (await q.count().get()).data()!.count;
  breakdown.trades = await countQ(db.collection('trades').where('ticker', '==', old));
  breakdown.limitOrders = await countQ(db.collection('limitOrders').where('ticker', '==', old));
  breakdown.preMarketOrders = await countQ(db.collection('preMarketOrders').where('ticker', '==', old));
  breakdown.feed = await countQ(db.collection('feed').where('ticker', '==', old));
  breakdown.priceAlerts = await countQ(db.collectionGroup('priceAlerts').where('ticker', '==', old));

  return breakdown;
};
