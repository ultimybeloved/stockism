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
const { priceHistoryRef, appendPriceHistory } = require('../helpers');

/**
 * Rename a ticker across all Firestore data.
 * Modes: dryRun (preview changes), execute (apply changes)
 */
exports.renameTicker = cf({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { oldTicker, newTicker, dryRun = true } = data;

  if (!oldTicker || !newTicker || typeof oldTicker !== 'string' || typeof newTicker !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'oldTicker and newTicker are required strings');
  }

  const old = oldTicker.trim().toUpperCase();
  const nw = newTicker.trim().toUpperCase();

  if (old === nw) {
    throw new functions.https.HttpsError('invalid-argument', 'Old and new ticker are the same');
  }

  // Validate: old ticker must exist in market data, new must not
  const marketRef = db.collection('market').doc('current');
  const marketSnap = await marketRef.get();
  if (!marketSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'Market data not found');
  }

  const marketData = marketSnap.data();
  const prices = marketData.prices || {};
  const renameHistSnap = await priceHistoryRef().get();
  const priceHistory = renameHistSnap.exists ? (renameHistSnap.data() || {}) : {};
  const volumes = marketData.volumes || {};
  const launchedTickers = marketData.launchedTickers || [];

  if (prices[old] === undefined) {
    throw new functions.https.HttpsError('invalid-argument', `Old ticker "${old}" not found in market prices`);
  }
  if (prices[nw] !== undefined) {
    throw new functions.https.HttpsError('invalid-argument', `New ticker "${nw}" already exists in market prices`);
  }

  const log = [];
  let docsToModify = 0;

  // --- 1. MARKET DATA ---
  const marketUpdates = {};
  // prices
  marketUpdates[`prices.${nw}`] = prices[old];
  marketUpdates[`prices.${old}`] = admin.firestore.FieldValue.delete();
  // priceHistory (lives in its own doc)
  const historyRenameUpdates = {};
  if (priceHistory[old]) {
    historyRenameUpdates[nw] = priceHistory[old];
    historyRenameUpdates[old] = admin.firestore.FieldValue.delete();
  }
  // volumes
  if (volumes[old] !== undefined) {
    marketUpdates[`volumes.${nw}`] = volumes[old];
    marketUpdates[`volumes.${old}`] = admin.firestore.FieldValue.delete();
  }
  // launchedTickers array
  if (launchedTickers.includes(old)) {
    marketUpdates.launchedTickers = launchedTickers.map(t => t === old ? nw : t);
  }
  // Handle other potential ticker-keyed maps
  if (marketData.dailyVolumes && marketData.dailyVolumes[old] !== undefined) {
    marketUpdates[`dailyVolumes.${nw}`] = marketData.dailyVolumes[old];
    marketUpdates[`dailyVolumes.${old}`] = admin.firestore.FieldValue.delete();
  }
  if (marketData.liquidity && marketData.liquidity[old] !== undefined) {
    marketUpdates[`liquidity.${nw}`] = marketData.liquidity[old];
    marketUpdates[`liquidity.${old}`] = admin.firestore.FieldValue.delete();
  }

  log.push(`market/current: rename ${old} → ${nw} in prices, priceHistory, volumes, launchedTickers`);
  docsToModify++;

  // --- 2. USER DOCS ---
  const usersSnap = await db.collection('users').get();
  const userUpdates = []; // { ref, updates }

  for (const userDoc of usersSnap.docs) {
    const userData = userDoc.data();
    const updates = {};
    let touched = false;

    // Simple ticker-keyed maps
    const simpleMaps = ['holdings', 'shorts', 'costBasis', 'lastBuyTime', 'lowestWhileHolding', 'shortHistory', 'ipoPurchases', 'lastTickerTradeTime'];
    for (const mapName of simpleMaps) {
      if (userData[mapName] && userData[mapName][old] !== undefined) {
        updates[`${mapName}.${nw}`] = userData[mapName][old];
        updates[`${mapName}.${old}`] = admin.firestore.FieldValue.delete();
        touched = true;
      }
    }

    // tickerTradeHistory: { ticker -> { action -> [entries] } }
    if (userData.tickerTradeHistory && userData.tickerTradeHistory[old] !== undefined) {
      updates[`tickerTradeHistory.${nw}`] = userData.tickerTradeHistory[old];
      updates[`tickerTradeHistory.${old}`] = admin.firestore.FieldValue.delete();
      touched = true;
    }

    if (touched) {
      userUpdates.push({ ref: userDoc.ref, updates, displayName: userData.displayName || userDoc.id });
      docsToModify++;
    }
  }

  log.push(`users: ${userUpdates.length} user docs to update`);

  // --- 3. TRADE RECORDS ---
  const tradesSnap = await db.collection('trades').where('ticker', '==', old).get();
  log.push(`trades: ${tradesSnap.size} trade records to update`);
  docsToModify += tradesSnap.size;

  // --- 4. LIMIT ORDERS ---
  const limitOrdersSnap = await db.collection('limitOrders').where('ticker', '==', old).get();
  log.push(`limitOrders: ${limitOrdersSnap.size} limit orders to update`);
  docsToModify += limitOrdersSnap.size;

  // --- 5. IP TRACKING ---
  const ipSnap = await db.collection('ipTracking').get();
  const ipUpdates = [];

  for (const ipDoc of ipSnap.docs) {
    const ipData = ipDoc.data();
    const updates = {};
    let touched = false;

    // tickerTradeHistory: { ticker -> { action -> [entries] } }
    if (ipData.tickerTradeHistory && ipData.tickerTradeHistory[old] !== undefined) {
      updates[`tickerTradeHistory.${nw}`] = ipData.tickerTradeHistory[old];
      updates[`tickerTradeHistory.${old}`] = admin.firestore.FieldValue.delete();
      touched = true;
    }

    if (touched) {
      ipUpdates.push({ ref: ipDoc.ref, updates });
      docsToModify++;
    }
  }

  log.push(`ipTracking: ${ipUpdates.length} IP docs to update`);

  // --- DRY RUN: return summary ---
  if (dryRun) {
    return {
      dryRun: true,
      oldTicker: old,
      newTicker: nw,
      totalDocsToModify: docsToModify,
      breakdown: {
        market: 1,
        users: userUpdates.length,
        trades: tradesSnap.size,
        limitOrders: limitOrdersSnap.size,
        ipTracking: ipUpdates.length
      },
      log
    };
  }

  // --- EXECUTE: halt market, apply changes, resume ---
  // Halt market
  await marketRef.update({
    marketHalted: true,
    haltReason: `Ticker rename in progress: ${old} → ${nw}`,
    haltedAt: Date.now(),
    haltedBy: context.auth.uid
  });

  try {
    // 1. Update market doc (+ the separate price-history doc)
    await marketRef.update(marketUpdates);
    if (Object.keys(historyRenameUpdates).length > 0) {
      await priceHistoryRef().update(historyRenameUpdates);
    }

    // 2. Update users in batches of 500
    for (let i = 0; i < userUpdates.length; i += 500) {
      const batch = db.batch();
      const chunk = userUpdates.slice(i, i + 500);
      for (const { ref, updates } of chunk) {
        batch.update(ref, updates);
      }
      await batch.commit();
    }

    // 3. Update trades in batches of 500
    const tradeDocs = tradesSnap.docs;
    for (let i = 0; i < tradeDocs.length; i += 500) {
      const batch = db.batch();
      const chunk = tradeDocs.slice(i, i + 500);
      for (const tradeDoc of chunk) {
        batch.update(tradeDoc.ref, { ticker: nw });
      }
      await batch.commit();
    }

    // 4. Update limit orders in batches of 500
    const limitDocs = limitOrdersSnap.docs;
    for (let i = 0; i < limitDocs.length; i += 500) {
      const batch = db.batch();
      const chunk = limitDocs.slice(i, i + 500);
      for (const limitDoc of chunk) {
        batch.update(limitDoc.ref, { ticker: nw });
      }
      await batch.commit();
    }

    // 5. Update IP tracking in batches of 500
    for (let i = 0; i < ipUpdates.length; i += 500) {
      const batch = db.batch();
      const chunk = ipUpdates.slice(i, i + 500);
      for (const { ref, updates } of chunk) {
        batch.update(ref, updates);
      }
      await batch.commit();
    }

    // Resume market
    await marketRef.update({
      marketHalted: false,
      haltReason: '',
      haltedAt: null,
      haltedBy: null
    });

    return {
      dryRun: false,
      success: true,
      oldTicker: old,
      newTicker: nw,
      totalDocsModified: docsToModify,
      breakdown: {
        market: 1,
        users: userUpdates.length,
        trades: tradesSnap.size,
        limitOrders: limitOrdersSnap.size,
        ipTracking: ipUpdates.length
      },
      log
    };
  } catch (err) {
    // Resume market even on failure
    try {
      await marketRef.update({
        marketHalted: false,
        haltReason: '',
        haltedAt: null,
        haltedBy: null
      });
    } catch (_) { /* best effort */ }

    throw new functions.https.HttpsError('internal', `Rename failed mid-execution: ${err.message}. Market resumed. Manual cleanup may be needed.`);
  }
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
    historyPoints[c.ticker] = { timestamp: now, price: c.basePrice };
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
