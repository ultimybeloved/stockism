'use strict';
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const {
  ADMIN_UID,
  STARTING_CASH,
  REINSTATE_CASH_DEFAULT,
  TWENTY_FOUR_HOURS_MS,
  ONE_WEEK_MS,
} = require('../constants');

exports.removeAchievement = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, achievementId } = data;
  if (!userId || !achievementId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId and achievementId required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  await userRef.update({
    achievements: admin.firestore.FieldValue.arrayRemove(achievementId),
    displayedAchievementPins: admin.firestore.FieldValue.arrayRemove(achievementId),
    [`achievementDates.${achievementId}`]: admin.firestore.FieldValue.delete()
  });

  return { success: true, removed: achievementId, userId };
});

/**
 * Admin reinstate a bankrupt user - gives them $1000 cash without wiping crew/holdings
 */
exports.reinstateUser = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId } = data;
  if (!userId) {
    throw new functions.https.HttpsError('invalid-argument', 'userId required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const userData = userSnap.data();
  const cashBoost = Math.max(0, REINSTATE_CASH_DEFAULT - (userData.cash || 0));

  await userRef.update({
    isBankrupt: false,
    cash: admin.firestore.FieldValue.increment(cashBoost),
    reinstatedAt: Date.now(),
    reinstatedBy: 'admin'
  });

  return { success: true, userId, cashAdded: cashBoost };
});

exports.adminSetCash = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, cash } = data;
  if (!userId || typeof cash !== 'number' || isNaN(cash) || cash < 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Valid userId and cash (>= 0) required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const prevCash = userSnap.data().cash;
  await userRef.update({ cash: Math.round(cash * 100) / 100 });

  return { success: true, userId, previousCash: prevCash, newCash: cash };
});

/**
 * Admin-only: flag or clear the Discord-link wall on a user. When set, the user
 * must link a Discord account before they can trade/bet/play (unless already linked).
 */
exports.adminSetDiscordWall = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { userId, value } = data;
  if (!userId || typeof value !== 'boolean') {
    throw new functions.https.HttpsError('invalid-argument', 'userId and boolean value required');
  }

  const userRef = db.collection('users').doc(userId);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  await userRef.update({ requiresDiscordLink: value });

  return { success: true, userId, requiresDiscordLink: value, alreadyLinked: !!userSnap.data().discordId };
});

/**
 * Repair accounts damaged by the Jiho/Doo price spike.
 * Modes: scan (find victims), repair (fix one user), repairAll (fix all)
 */
exports.repairSpikeVictims = functions.https.onCall(async (data, context) => {
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { mode, userId, victims: victimsInput, userIds } = data;
  const SPIKE_TICKERS = ['JIHO', 'DOO'];

  // --- DIAGNOSE MODE ---
  if (mode === 'diagnose') {
    if (!userIds || !Array.isArray(userIds)) {
      throw new functions.https.HttpsError('invalid-argument', 'userIds array required');
    }

    const results = [];
    for (const uid of userIds) {
      const userSnap = await db.collection('users').doc(uid).get();
      if (!userSnap.exists) {
        results.push({ userId: uid, error: 'not found' });
        continue;
      }
      const userData = userSnap.data();

      // Get all trades for this user
      const tradesSnap = await db.collection('trades')
        .where('uid', '==', uid)
        .get();

      const trades = [];
      tradesSnap.forEach(doc => {
        const t = doc.data();
        const ts = t.timestamp?._seconds
          ? t.timestamp._seconds * 1000
          : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
        trades.push({
          id: doc.id,
          action: t.action,
          ticker: t.ticker,
          amount: t.amount,
          price: t.price,
          totalValue: t.totalValue,
          pnl: t.pnl,
          cashBefore: t.cashBefore,
          cashAfter: t.cashAfter,
          automated: t.automated || false,
          timestamp: ts
        });
      });

      trades.sort((a, b) => b.timestamp - a.timestamp);

      results.push({
        userId: uid,
        displayName: userData.displayName || 'Unknown',
        cash: userData.cash || 0,
        isBankrupt: userData.isBankrupt || false,
        bankruptAt: userData.bankruptAt || null,
        lastBailout: userData.lastBailout || null,
        holdings: userData.holdings || {},
        shorts: userData.shorts || {},
        costBasis: userData.costBasis || {},
        marginEnabled: userData.marginEnabled || false,
        marginUsed: userData.marginUsed || 0,
        portfolioValue: userData.portfolioValue || 0,
        totalTrades: trades.length,
        recentTrades: trades.slice(0, 50) // Last 50 trades
      });
    }

    return { results };
  }

  // --- SCAN MODE ---
  if (mode === 'scan') {
    // Broad scan: find ALL users who are bankrupt, have negative cash, or have
    // empty shorts (position closed without trade log). Excludes bots.
    const usersSnap = await db.collection('users').get();
    const victims = [];

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      if (userData.isBot) continue;

      const uid = userDoc.id;
      const cash = userData.cash || 0;
      const isBankrupt = userData.isBankrupt || false;
      const holdings = userData.holdings || {};
      const shorts = userData.shorts || {};
      const hasHoldings = Object.values(holdings).some(v => v > 0);
      const hasShorts = Object.values(shorts).some(v => v && (typeof v === 'object' ? v.shares > 0 : v > 0));

      // Flag users who are: bankrupt, negative cash, or $0 with nothing
      const isDamaged = isBankrupt || cash < 0;
      if (!isDamaged) continue;

      // Get their trades for context
      const tradesSnap = await db.collection('trades')
        .where('uid', '==', uid)
        .get();

      const trades = [];
      tradesSnap.forEach(doc => {
        const t = doc.data();
        const ts = t.timestamp?._seconds
          ? t.timestamp._seconds * 1000
          : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
        trades.push({ ...t, _ts: ts, id: doc.id });
      });
      trades.sort((a, b) => a._ts - b._ts);

      // Find margin_call_cover trades on spike tickers
      const spikeTrades = trades.filter(t =>
        t.action === 'margin_call_cover' && SPIKE_TICKERS.includes(t.ticker)
      );

      // Find the last SHORT open on spike tickers (for users like Bbb with no cover trade)
      const spikeShortOpens = trades.filter(t =>
        (t.action === 'SHORT' || t.action === 'short' || t.action === 'SHORT_OPEN') &&
        SPIKE_TICKERS.includes(t.ticker)
      );

      // Determine corrected cash
      let correctedCash = null;
      let reason = '';

      if (spikeTrades.length > 0 && spikeShortOpens.length > 0) {
        // Has margin_call_cover AND short opens on spike tickers
        // Restore to cash BEFORE their first spike-ticker short (undo the whole sequence)
        correctedCash = spikeShortOpens[0].cashBefore;
        reason = 'margin_call_cover on ' + [...new Set(spikeTrades.map(t => t.ticker))].join('/');
      } else if (spikeTrades.length > 0) {
        // Has margin_call_cover but no short open found — use cashBefore of first cover
        correctedCash = spikeTrades[0].cashBefore;
        reason = 'margin_call_cover (no short open found)';
      } else if (spikeShortOpens.length > 0 && cash < 0) {
        // Shorted spike tickers, no cover trade logged, but negative cash
        // Restore to cash BEFORE the first spike short (margin should come back since position is gone)
        correctedCash = spikeShortOpens[0].cashBefore;
        reason = 'short closed without trade log (' + [...new Set(spikeShortOpens.map(t => t.ticker))].join('/') + ')';
      } else if (trades.length === 0 && cash <= 0) {
        // No trades at all, zero/negative cash — empty or broken account
        correctedCash = STARTING_CASH;
        reason = 'empty account (no trades)';
      }

      // Check if they took bailout
      const tookBailout = !!(userData.lastBailout);

      // For bailout users, try to reconstruct holdings from trade history
      let holdingsToRestore = null;
      let costBasisToRestore = null;

      if (tookBailout && trades.length > 0) {
        const replayHoldings = {};
        const replayCostBasis = {};

        // Replay all buy/sell trades (entire history, since bailout wiped everything)
        for (const t of trades) {
          const ticker = t.ticker;
          if (!ticker) continue;
          // Stop replaying if we hit the bailout or damage point
          if (t.action === 'margin_call_cover' && SPIKE_TICKERS.includes(ticker)) break;

          if (t.action === 'BUY' || t.action === 'buy') {
            const prevShares = replayHoldings[ticker] || 0;
            const prevCost = replayCostBasis[ticker] || 0;
            const newShares = prevShares + (t.amount || 0);
            if (newShares > 0) {
              replayCostBasis[ticker] = ((prevCost * prevShares) + (t.price * (t.amount || 0))) / newShares;
            }
            replayHoldings[ticker] = newShares;
          } else if (t.action === 'SELL' || t.action === 'sell') {
            replayHoldings[ticker] = Math.max(0, (replayHoldings[ticker] || 0) - (t.amount || 0));
            if (replayHoldings[ticker] === 0) delete replayCostBasis[ticker];
          }
        }

        // Clean up zero holdings
        for (const [ticker, shares] of Object.entries(replayHoldings)) {
          if (shares <= 0) {
            delete replayHoldings[ticker];
            delete replayCostBasis[ticker];
          }
        }

        if (Object.keys(replayHoldings).length > 0) {
          holdingsToRestore = replayHoldings;
          costBasisToRestore = replayCostBasis;
        }
      }

      // Get last 10 trades for display
      const recentTrades = trades.slice(-10).reverse().map(t => ({
        action: t.action,
        ticker: t.ticker,
        shares: t.amount,
        price: t.price,
        pnl: t.pnl,
        cashBefore: t.cashBefore,
        cashAfter: t.cashAfter,
        timestamp: t._ts
      }));

      victims.push({
        userId: uid,
        displayName: userData.displayName || 'Unknown',
        currentCash: cash,
        correctedCash,
        isBankrupt,
        bankruptAt: userData.bankruptAt || null,
        tookBailout,
        holdingsToRestore,
        costBasisToRestore,
        holdingsCount: holdingsToRestore ? Object.keys(holdingsToRestore).length : 0,
        hasHoldings,
        hasShorts,
        reason,
        totalTrades: trades.length,
        trades: recentTrades
      });
    }

    // Sort: most negative cash first
    victims.sort((a, b) => (a.currentCash || 0) - (b.currentCash || 0));

    return { victims };
  }

  // --- REPAIR MODE (single user) ---
  if (mode === 'repair') {
    if (!userId) {
      throw new functions.https.HttpsError('invalid-argument', 'userId required for repair mode');
    }

    // Find the victim data from victimsInput or re-scan
    let victim = victimsInput;
    if (!victim) {
      throw new functions.https.HttpsError('invalid-argument', 'victim data required');
    }

    const userRef = db.collection('users').doc(userId);
    const userSnap = await userRef.get();
    if (!userSnap.exists) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }

    const updates = {
      cash: Math.round(victim.correctedCash * 100) / 100,
      isBankrupt: false
    };

    // Clear bankruptcy timestamp
    const userData = userSnap.data();
    if (userData.bankruptAt) {
      updates.bankruptAt = admin.firestore.FieldValue.delete();
    }

    // Restore holdings for bailout users
    if (victim.tookBailout && victim.holdingsToRestore) {
      updates.holdings = victim.holdingsToRestore;
      if (victim.costBasisToRestore) {
        updates.costBasis = victim.costBasisToRestore;
      }
    }

    // Add repair log
    updates._repairLog = admin.firestore.FieldValue.arrayUnion({
      type: 'spike_repair',
      repairedAt: Date.now(),
      repairedBy: context.auth.uid,
      previousCash: userData.cash,
      correctedCash: victim.correctedCash,
      tookBailout: victim.tookBailout,
      holdingsRestored: victim.holdingsToRestore ? Object.keys(victim.holdingsToRestore).length : 0
    });

    await userRef.update(updates);

    return { success: true, userId, correctedCash: victim.correctedCash };
  }

  // --- REPAIR ALL MODE ---
  if (mode === 'repairAll') {
    if (!victimsInput || !Array.isArray(victimsInput)) {
      throw new functions.https.HttpsError('invalid-argument', 'victims array required');
    }

    const results = [];
    for (const victim of victimsInput) {
      try {
        const userRef = db.collection('users').doc(victim.userId);
        const userSnap = await userRef.get();
        if (!userSnap.exists) {
          results.push({ userId: victim.userId, success: false, error: 'not found' });
          continue;
        }

        const userData = userSnap.data();
        const updates = {
          cash: Math.round(victim.correctedCash * 100) / 100,
          isBankrupt: false
        };

        if (userData.bankruptAt) {
          updates.bankruptAt = admin.firestore.FieldValue.delete();
        }

        if (victim.tookBailout && victim.holdingsToRestore) {
          updates.holdings = victim.holdingsToRestore;
          if (victim.costBasisToRestore) {
            updates.costBasis = victim.costBasisToRestore;
          }
        }

        updates._repairLog = admin.firestore.FieldValue.arrayUnion({
          type: 'spike_repair',
          repairedAt: Date.now(),
          repairedBy: context.auth.uid,
          previousCash: userData.cash,
          correctedCash: victim.correctedCash,
          tookBailout: victim.tookBailout,
          holdingsRestored: victim.holdingsToRestore ? Object.keys(victim.holdingsToRestore).length : 0
        });

        await userRef.update(updates);
        results.push({ userId: victim.userId, success: true });
      } catch (err) {
        results.push({ userId: victim.userId, success: false, error: err.message });
      }
    }

    return { results };
  }

  throw new functions.https.HttpsError('invalid-argument', 'Invalid mode. Use scan, repair, or repairAll');
});

/**
 * Rename a ticker across all Firestore data.
 * Modes: dryRun (preview changes), execute (apply changes)
 */
exports.renameTicker = functions.runWith({ timeoutSeconds: 540, memory: '1GB' }).https.onCall(async (data, context) => {
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
  const priceHistory = marketData.priceHistory || {};
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
  // priceHistory
  if (priceHistory[old]) {
    marketUpdates[`priceHistory.${nw}`] = priceHistory[old];
    marketUpdates[`priceHistory.${old}`] = admin.firestore.FieldValue.delete();
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
    // 1. Update market doc
    await marketRef.update(marketUpdates);

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
 * One-time migration: move portfolioHistory arrays to subcollection.
 * Run once after deploying the subcollection-based syncPortfolio, then remove.
 */
exports.migratePortfolioHistory = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || context.auth.uid !== ADMIN_UID) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    const usersSnap = await db.collection('users').get();
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const userDoc of usersSnap.docs) {
      const userData = userDoc.data();
      const history = userData.portfolioHistory;
      if (!Array.isArray(history) || history.length === 0) {
        skipped++;
        continue;
      }

      try {
        const subcollRef = userDoc.ref.collection('portfolioHistory');
        const batch = db.batch();
        for (const entry of history) {
          if (entry && typeof entry.timestamp === 'number' && typeof entry.value === 'number') {
            batch.set(subcollRef.doc(), entry);
          }
        }
        await batch.commit();

        // Seed snapshot fields from last entry
        const last = history[history.length - 1];
        const updatePayload = {
          lastPortfolioSnapshot: last,
          portfolioHistory: admin.firestore.FieldValue.delete(),
        };
        // Seed 24h snapshot from first entry that's >= 24h old
        const now = Date.now();
        const snap24h = history.find(e => e.timestamp <= now - TWENTY_FOUR_HOURS_MS);
        if (snap24h) updatePayload.portfolioSnapshot24h = snap24h;
        const snap7d = history.find(e => e.timestamp <= now - ONE_WEEK_MS);
        if (snap7d) updatePayload.portfolioSnapshot7d = snap7d;

        await userDoc.ref.update(updatePayload);
        migrated++;
      } catch (err) {
        console.error(`Migration failed for ${userDoc.id}:`, err.message);
        errors++;
      }
    }

    return { migrated, skipped, errors };
  });

/**
 * Reconstruct portfolio history from permanent trades + price history archives.
 * For each user's trades (sorted ascending), rebuild holdings state and calculate
 * portfolio value = cashAfter + sum(longShares * historicalPrice).
 * Writes reconstructed points to users/{uid}/portfolioHistory subcollection,
 * skipping timestamps that already have entries.
 *
 * data.uid — optional; if provided, runs for that user only. Otherwise all non-bot users.
 */
exports.reconstructPortfolioHistory = functions
  .runWith({ timeoutSeconds: 540, memory: '1GB' })
  .https.onCall(async (data, context) => {
    if (!context.auth || context.auth.uid !== ADMIN_UID) {
      throw new functions.https.HttpsError('permission-denied', 'Admin only');
    }

    const targetUid = data && data.uid ? data.uid : null;
    const batchLimit = (data && data.limit) ? Math.min(data.limit, 100) : 50;
    const startAfterUid = data && data.startAfterUid ? data.startAfterUid : null;

    // 1. Determine which users to process
    let userDocs = [];
    let nextCursor = null;
    let done = true;

    if (targetUid) {
      const doc = await db.collection('users').doc(targetUid).get();
      if (!doc.exists) throw new functions.https.HttpsError('not-found', 'User not found');
      userDocs = [doc];
    } else {
      // Order by document ID for stable cursor-based pagination.
      // Pass startAfterUid as the raw string cursor value (documentId ordering
      // accepts the ID value directly without needing a snapshot fetch).
      let q = db.collection('users')
        .orderBy(admin.firestore.FieldPath.documentId())
        .limit(batchLimit + 1); // fetch one extra to detect if more pages remain
      if (startAfterUid) {
        q = q.startAfter(startAfterUid);
      }
      const snap = await q.get();
      // Filter bots; if extra doc exists, there are more pages
      const allDocs = snap.docs;
      const hasMore = allDocs.length > batchLimit;
      const pageDocs = hasMore ? allDocs.slice(0, batchLimit) : allDocs;
      userDocs = pageDocs.filter(d => !d.data().isBot);
      if (hasMore) {
        nextCursor = pageDocs[pageDocs.length - 1].id;
        done = false;
      }
    }

    // 2. Load full price history for all tickers (recent + archived) — done once
    const marketDoc = await db.collection('market').doc('current').get();
    const recentPriceHistory = (marketDoc.data() || {}).priceHistory || {};

    const archivedSnaps = await db.collection('market').doc('current')
      .collection('price_history').get();

    // Merge: archived (older) + recent (newer), sorted ascending by timestamp
    const fullPriceHistory = {};
    for (const [ticker, entries] of Object.entries(recentPriceHistory)) {
      fullPriceHistory[ticker] = Array.isArray(entries) ? [...entries] : [];
    }
    for (const archDoc of archivedSnaps.docs) {
      const ticker = archDoc.id;
      const archived = archDoc.data().history || [];
      const existing = fullPriceHistory[ticker] || [];
      const merged = [...archived, ...existing];
      merged.sort((a, b) => a.timestamp - b.timestamp);
      fullPriceHistory[ticker] = merged;
    }

    // Helper: binary-search closest price for a ticker at a timestamp
    const getPriceAt = (ticker, ts) => {
      const hist = fullPriceHistory[ticker];
      if (!hist || hist.length === 0) return 0;
      let lo = 0, hi = hist.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (hist[mid].timestamp < ts) lo = mid + 1;
        else hi = mid;
      }
      if (lo > 0 && Math.abs(hist[lo - 1].timestamp - ts) < Math.abs(hist[lo].timestamp - ts)) {
        return hist[lo - 1].price || 0;
      }
      return hist[lo].price || 0;
    };

    const toMs = (ts) => (ts && ts.toMillis) ? ts.toMillis() : (ts || 0);

    // 3. Process each user
    let totalPointsWritten = 0;
    let usersProcessed = 0;
    let usersSkipped = 0;
    let errors = 0;

    for (const userDoc of userDocs) {
      const uid = userDoc.id;
      try {
        // Load trades sorted by timestamp ascending
        const tradesSnap = await db.collection('trades')
          .where('uid', '==', uid)
          .orderBy('timestamp', 'asc')
          .get();

        if (tradesSnap.empty) { usersSkipped++; continue; }

        // Load existing subcollection timestamps to avoid duplicates
        const existingSnap = await db.collection('users').doc(uid)
          .collection('portfolioHistory').select('timestamp').get();
        const existingTs = new Set(existingSnap.docs.map(d => d.data().timestamp));

        // Walk trades forward, maintaining long holdings state
        const longHoldings = {}; // ticker -> shares
        const points = [];

        for (const tradeDoc of tradesSnap.docs) {
          const t = tradeDoc.data();
          const ts = toMs(t.timestamp);
          const { ticker, action, amount, cashAfter } = t;

          if (typeof cashAfter !== 'number' || !ticker || !action) continue;

          // Update long holdings
          if (action === 'buy') {
            longHoldings[ticker] = (longHoldings[ticker] || 0) + (amount || 0);
          } else if (action === 'sell') {
            longHoldings[ticker] = Math.max(0, (longHoldings[ticker] || 0) - (amount || 0));
          }
          // short/cover: cashAfter already captures margin effects on cash;
          // unrealized short P&L is omitted (approximation).

          const holdingsValue = Object.entries(longHoldings).reduce((sum, [t2, shares]) => {
            return shares > 0 ? sum + shares * getPriceAt(t2, ts) : sum;
          }, 0);

          const value = Math.round((cashAfter + holdingsValue) * 100) / 100;

          if (!existingTs.has(ts) && value > 0) {
            points.push({ timestamp: ts, value });
            existingTs.add(ts); // dedupe within this run
          }
        }

        // Write in batches of 400
        const histRef = db.collection('users').doc(uid).collection('portfolioHistory');
        for (let i = 0; i < points.length; i += 400) {
          const batch = db.batch();
          for (const point of points.slice(i, i + 400)) {
            batch.set(histRef.doc(), point);
          }
          await batch.commit();
        }

        totalPointsWritten += points.length;
        usersProcessed++;
      } catch (err) {
        console.error(`Reconstruction failed for ${uid}:`, err.message);
        errors++;
      }
    }

    return { usersProcessed, usersSkipped, totalPointsWritten, errors, nextCursor, done };
  });

/**
 * Initialize prices for any character in characters.js that doesn't have a
 * live price in Firestore yet. Skips IPO characters. Safe to run multiple
 * times — only writes missing entries.
 */
exports.initNewCharacterPrices = functions.https.onCall(async (data, context) => {
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
  const initialized = [];

  for (const c of CHARACTERS) {
    if (c.ipoRequired || c.isETF) continue;
    if (prices[c.ticker]) continue;

    updates[`prices.${c.ticker}`] = c.basePrice;
    updates[`priceHistory.${c.ticker}`] = admin.firestore.FieldValue.arrayUnion({
      timestamp: now,
      price: c.basePrice
    });
    initialized.push({ ticker: c.ticker, price: c.basePrice });
  }

  if (initialized.length === 0) {
    return { message: 'All characters already have prices', initialized: [] };
  }

  await marketRef.update(updates);
  console.log(`Initialized prices for ${initialized.length} characters:`, initialized.map(i => i.ticker).join(', '));
  return { message: `Initialized ${initialized.length} character prices`, initialized };
});