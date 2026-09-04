'use strict';
// Ticker and roster migrations, split out of adminOps.js when it passed the
// 600-line limit.
//
// These change the character roster itself rather than any one player: renaming a
// ticker across every collection, and seeding prices for newly added characters.
// Both are run once, by hand, after src/characters.js changes and npm run
// sync:chars — see the "adding characters" playbook.
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTERS } = require('../characters');
const {
  ADMIN_UID,
} = require('../constants');
const { appendPriceHistory } = require('../helpers');
const { runPreflight, countDryRun, runRename, PHASES } = require('./tickerRename');

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
 * ORDER MATTERS: edit src/characters.js and src/crews.js, run check:data and
 * sync:chars, and DEPLOY FUNCTIONS before running this. Preflight refuses
 * otherwise. Migrating first makes initNewCharacterPrices see the old ticker
 * still in the roster with no price and re-seed it at base price, which
 * creates a duplicate stock at the wrong price.
 */
exports.renameTicker = cf({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

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
  const marketData = marketSnap.data();

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
      const failed = checks.filter((c) => !c.pass).map((c) => c.label).join('; ');
      throw new functions.https.HttpsError('failed-precondition', `Preflight failed: ${failed}`);
    }
  }

  return runRename({ old, nw, mode, uid: context.auth.uid });
});

/**
 * Initialize prices for any character in characters.js that doesn't have a
 * live price in Firestore yet. Skips IPO characters. Safe to run multiple
 * times — only writes missing entries.
 */
exports.initNewCharacterPrices = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();
  if (!marketSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Market document not found');
  }

  const prices = marketSnap.data().prices || {};
  const now = Date.now();
  const updates = {};
  const historyPoints = {};
  const initialized = [];

  for (const c of CHARACTERS) {
    if (c.ipoRequired || c.isETF) continue;
    if (prices[c.ticker]) continue;

    updates[`prices.${c.ticker}`] = c.basePrice;
    // Tagged so a seeded starting price is never mistaken for a trade.
    historyPoints[c.ticker] = { timestamp: now, price: c.basePrice, source: 'init' };
    initialized.push({ ticker: c.ticker, price: c.basePrice });
  }

  if (initialized.length === 0) {
    return { message: 'All characters already have prices', initialized: [] };
  }

  await marketRef.update(updates);
  await appendPriceHistory(null, historyPoints);
  console.log(`Initialized prices for ${initialized.length} characters:`, initialized.map(i => i.ticker).join(', '));
  return { message: `Initialized ${initialized.length} character prices`, initialized };
});
