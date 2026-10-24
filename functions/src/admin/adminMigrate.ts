// Ticker and roster migrations, split out of adminOps.js when it passed the
// 600-line limit.
//
// These change the character roster itself rather than any one player: renaming a
// ticker across every collection, and seeding prices for newly added characters.
// Both are run once, by hand, after src/characters.ts changes and npm run
// sync:chars — see the "adding characters" playbook.
import * as functions from 'firebase-functions/v1';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();
import { seedMissingPrices } from '../market/seedPrices';
import { runPreflight, countDryRun, runRename, PHASES } from '../market/tickerRename';
import * as split from '../market/stockSplit';
import { logAdminAction } from '../shared/adminLog';

/**
 * Rename a ticker across live Firestore data.
 *
 * The engine is in tickerRename.js; this is the callable shell around it.
 *
 * Modes:
 *   dryRun  - preflight checks and per-location counts, writes nothing
 *   execute - halt the market and run the phases
 *   resume  - continue a paused or failed run from its cursor
 *   abort   - give up on a run. Does NOT roll back and does NOT reopen the
 *             market, because a half-renamed database is not something to
 *             resume trading against.
 *
 * ORDER MATTERS: edit src/characters.ts and src/crews.ts, run check:data and
 * sync:chars, and DEPLOY FUNCTIONS before running this. Preflight refuses
 * otherwise. Migrating first makes the price seeder (market/seedPrices) see
 * the old ticker still in the roster with no price and re-seed it at base
 * price, which creates a duplicate stock at the wrong price.
 */
export const renameTicker = cf({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
  requireAdmin(context);

  const { oldTicker, newTicker } = data || {};
  // `dryRun` is the old boolean argument, kept working so a stale client can
  // still only ever preview.
  const mode = data?.mode || (data?.dryRun === false ? 'execute' : 'dryRun');

  if (mode !== 'resume' && mode !== 'abort') {
    if (typeof oldTicker !== 'string' || typeof newTicker !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'oldTicker and newTicker are required strings');
    }
  }

  const old = (oldTicker || '').trim().toUpperCase();
  const nw = (newTicker || '').trim().toUpperCase();

  if (mode !== 'resume' && mode !== 'abort' && old === nw) {
    throw new functions.https.HttpsError('invalid-argument', 'Old and new ticker are the same');
  }

  const marketSnap = await db.collection('market').doc('current').get();
  if (!marketSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Market data not found');
  }
  const marketData = marketSnap.data()!;

  if (mode === 'dryRun') {
    const { checks, blocked, journal } = await runPreflight({ old, nw, marketData });
    const breakdown = blocked ? null : await countDryRun({ old, nw });
    return {
      dryRun: true,
      oldTicker: old,
      newTicker: nw,
      checks,
      blocked,
      breakdown,
      phases: PHASES.map((ph) => ({ name: ph.name, label: ph.label })),
      // Said out loud so the admin panel can stop claiming this touches
      // everything. These resolve through market/current.tickerAliases instead.
      notRewritten: [
        'Bell notifications (the ticker is inside free text; old deep links redirect)',
        'Feed entries older than the 7-day TTL',
        'Stored backups in Cloud Storage (restore remaps them through the alias)',
      ],
      journal: journal || null,
    };
  }

  if (mode === 'execute') {
    const { blocked, checks } = await runPreflight({ old, nw, marketData });
    if (blocked) {
      const failed = checks
        .filter((c) => !c.pass)
        .map((c) => c.label)
        .join('; ');
      throw new functions.https.HttpsError('failed-precondition', `Preflight failed: ${failed}`);
    }
  }

  const result = await runRename({ old, nw, mode, uid: context.auth!.uid });
  if (mode !== 'dryRun') await logAdminAction(context, { action: 'rename_ticker', detail: { old, nw, mode } });
  return result;
});

/**
 * Split a stock N-for-1 across live Firestore data. Engine in stockSplit.js.
 *
 * Modes: dryRun (checks and counts, writes nothing), execute, resume, abort.
 * Abort does NOT roll back. The market must already be halted and this never
 * reopens it. ORDER: halt, add splitFactor to src/characters.ts, sync:chars,
 * deploy functions, then run this — see "Splitting a Stock" in CLAUDE.md.
 */
export const splitStock = cf({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
  requireAdmin(context);
  const mode = data?.mode || 'dryRun';
  if (!['dryRun', 'execute', 'resume', 'abort'].includes(mode)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown mode');
  }
  const ticker = String(data?.ticker || '')
    .trim()
    .toUpperCase();
  const ratio = Number(data?.ratio);

  if (mode === 'dryRun' || mode === 'execute') {
    const marketSnap = await db.collection('market').doc('current').get();
    const { checks, blocked, journal, before } = await split.runPreflight({
      ticker,
      ratio,
      marketData: marketSnap.exists ? marketSnap.data()! : {},
    });
    if (mode === 'dryRun') {
      return {
        dryRun: true,
        ticker,
        ratio,
        checks,
        blocked,
        factorBefore: before,
        priceNow: marketSnap.data()?.prices?.[ticker] ?? null,
        breakdown: blocked ? null : await split.countDryRun({ ticker }),
        phases: split.PHASES.map((ph) => ({ name: ph.name, label: ph.label })),
        notRewritten: ['Feed entries (7-day TTL)', 'Old notifications'],
        journal: journal || null,
      };
    }
    if (blocked) {
      const failed = checks
        .filter((c) => !c.pass)
        .map((c) => c.label)
        .join('; ');
      throw new functions.https.HttpsError('failed-precondition', `Preflight failed: ${failed}`);
    }
  }
  const result = await split.runSplit({ ticker, ratio, mode, uid: context.auth!.uid });
  if (mode !== 'dryRun') await logAdminAction(context, { action: 'split_stock', detail: { ticker, ratio, mode } });
  return result;
});

/**
 * Give every new character its starting price now, instead of waiting for the
 * hourly run in marketMakerCycle. Skips IPO characters and ETFs. Safe to run
 * multiple times: only writes missing entries. Unlike the hourly run it does
 * not wait on a half-done rename, because an admin pressed it on purpose.
 */
export const initNewCharacterPrices = cf().https.onCall(async (data, context) => {
  requireAdmin(context);

  const result = await seedMissingPrices({ waitOnOrphans: false });
  if (!result) {
    throw new functions.https.HttpsError('not-found', 'Market document not found');
  }
  const { initialized } = result;
  if (initialized.length === 0) {
    return { message: 'All characters already have prices', initialized: [] };
  }

  logger.info(`Initialized prices for ${initialized.length} characters:`, initialized.map((i) => i.ticker).join(', '));
  await logAdminAction(context, { action: 'init_prices', detail: { initialized } });
  return { message: `Initialized ${initialized.length} character prices`, initialized };
});
