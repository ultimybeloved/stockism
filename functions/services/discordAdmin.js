'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const axios = require('axios');
const { verifyKey, InteractionType, InteractionResponseType } = require('discord-interactions');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { ADMIN_UID, STARTING_CASH, BASE_IMPACT, BASE_LIQUIDITY, MAX_PRICE_CHANGE_PERCENT } = require('../constants');
const { writeNotification, sendDiscordMessage, priceHistoryRef } = require('../helpers');


// ─── TICKER ROLLBACK DIAGNOSTIC ──────────────────────────────────────────────
exports.diagnoseTickerRollback = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { ticker, startTimestamp } = data;
  if (!ticker || !startTimestamp) {
    throw new functions.https.HttpsError('invalid-argument', 'ticker and startTimestamp required');
  }

  const startDate = new Date(startTimestamp);

  // 1. Get price at start from priceHistory
  const marketSnap = await db.collection('market').doc('current').get();
  const marketData = marketSnap.data() || {};
  const currentPrice = (marketData.prices || {})[ticker] || 0;
  const histSnap = await priceHistoryRef().get();
  const priceHistory = ((histSnap.data() || {})[ticker]) || [];

  // Find price closest to (but before) startTimestamp
  let priceAtStart = currentPrice;
  const startMs = startDate.getTime();
  let closestBefore = null;
  for (const entry of priceHistory) {
    const entryMs = entry.timestamp?._seconds
      ? entry.timestamp._seconds * 1000
      : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
        : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
    if (entryMs <= startMs && (!closestBefore || entryMs > closestBefore.ms)) {
      closestBefore = { ms: entryMs, price: entry.price };
    }
  }
  if (closestBefore) priceAtStart = closestBefore.price;

  // 2. Query all trades for this ticker after startTimestamp
  const tradesSnap = await db.collection('trades')
    .where('ticker', '==', ticker)
    .where('timestamp', '>', startDate)
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

  // 3. Group by uid
  const userMap = {};
  for (const t of trades) {
    if (!userMap[t.uid]) {
      userMap[t.uid] = { buys: [], sells: [], shorts: [], covers: [] };
    }
    const action = (t.action || '').toLowerCase();
    if (action === 'buy') {
      userMap[t.uid].buys.push(t);
    } else if (action === 'sell') {
      userMap[t.uid].sells.push(t);
    } else if (action === 'short') {
      userMap[t.uid].shorts.push(t);
    } else if (action === 'cover') {
      userMap[t.uid].covers.push(t);
    }
  }

  const uids = Object.keys(userMap);

  // Fetch user docs
  const userDocs = {};
  for (const uid of uids) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) userDocs[uid] = snap.data();
  }

  // Build per-user breakdown
  const userBreakdowns = [];
  const profiteers = []; // users with positive net cash flow

  for (const uid of uids) {
    const { buys, sells, shorts, covers } = userMap[uid];
    const userData = userDocs[uid] || {};

    const totalTrades = buys.length + sells.length + shorts.length + covers.length;

    // Skip users with no actual trades (defensive)
    if (totalTrades === 0) continue;

    const sharesBought = buys.reduce((s, t) => s + (t.amount || 0), 0);
    const cashSpent = buys.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesSold = sells.reduce((s, t) => s + (t.amount || 0), 0);
    const cashReceived = sells.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesShorted = shorts.reduce((s, t) => s + (t.amount || 0), 0);
    const cashFromShorts = shorts.reduce((s, t) => s + (t.totalValue || 0), 0);
    const sharesCovered = covers.reduce((s, t) => s + (t.amount || 0), 0);
    const cashToCover = covers.reduce((s, t) => s + (t.totalValue || 0), 0);

    // Net cash: money in (sells + shorts) minus money out (buys + covers)
    const netCashFlow = (cashReceived + cashFromShorts) - (cashSpent + cashToCover);
    const currentHoldings = (userData.holdings || {})[ticker] || 0;
    const netSharesTraded = sharesBought - sharesSold;
    const giftedShares = Math.max(0, currentHoldings - netSharesTraded);

    const firstSellTs = sells.length > 0 ? Math.min(...sells.map(s => s._ts)) : null;
    const firstShortTs = shorts.length > 0 ? Math.min(...shorts.map(s => s._ts)) : null;
    // Earliest cash-generating trade (sell or short)
    const firstCashInTs = [firstSellTs, firstShortTs].filter(Boolean).length > 0
      ? Math.min(...[firstSellTs, firstShortTs].filter(Boolean))
      : null;

    const entry = {
      uid,
      displayName: userData.displayName || 'Unknown',
      isBot: userData.isBot || false,
      sharesBought,
      cashSpent: Math.round(cashSpent * 100) / 100,
      sharesSold,
      cashReceived: Math.round(cashReceived * 100) / 100,
      sharesShorted,
      cashFromShorts: Math.round(cashFromShorts * 100) / 100,
      sharesCovered,
      cashToCover: Math.round(cashToCover * 100) / 100,
      netCashFlow: Math.round(netCashFlow * 100) / 100,
      currentHoldings,
      currentCash: Math.round((userData.cash || 0) * 100) / 100,
      giftedShares,
      totalTrades,
      firstSellTs,
      firstCashInTs
    };

    userBreakdowns.push(entry);
    if (netCashFlow > 0 && firstCashInTs) {
      profiteers.push({ uid, netCashFlow, firstCashInTs, displayName: entry.displayName });
    }
  }

  // Sort by net cash flow descending
  userBreakdowns.sort((a, b) => b.netCashFlow - a.netCashFlow);

  // 4. Ripple effects — what did profiteers buy after selling ticker?
  const rippleByTicker = {};
  const userRipples = {};

  for (const p of profiteers) {
    // Get all non-ticker trades after first cash-generating trade
    const otherTradesSnap = await db.collection('trades')
      .where('uid', '==', p.uid)
      .where('timestamp', '>', new Date(p.firstCashInTs))
      .get();

    let spentOnOthers = 0;
    const byTicker = {};

    otherTradesSnap.forEach(doc => {
      const t = doc.data();
      if (t.ticker === ticker) return; // skip same ticker
      const action = (t.action || '').toLowerCase();
      if (action !== 'buy') return;
      const cost = t.totalValue || 0;
      spentOnOthers += cost;
      byTicker[t.ticker] = (byTicker[t.ticker] || 0) + cost;
    });

    // Cap at their profit from the target ticker
    const cappedSpent = Math.min(spentOnOthers, p.netCashFlow);

    if (cappedSpent > 0) {
      userRipples[p.uid] = {
        displayName: p.displayName,
        shroProfit: Math.round(p.netCashFlow * 100) / 100,
        spentOnOtherStocks: Math.round(cappedSpent * 100) / 100,
        breakdown: {}
      };

      // Scale per-ticker amounts if we capped
      const scale = spentOnOthers > 0 ? cappedSpent / spentOnOthers : 0;
      for (const [t, amount] of Object.entries(byTicker)) {
        const scaled = Math.round(amount * scale * 100) / 100;
        userRipples[p.uid].breakdown[t] = scaled;
        rippleByTicker[t] = (rippleByTicker[t] || 0) + scaled;
      }
    }
  }

  // Round ripple totals
  for (const t of Object.keys(rippleByTicker)) {
    rippleByTicker[t] = Math.round(rippleByTicker[t] * 100) / 100;
  }

  // Sort ripple by amount
  const sortedRipple = Object.entries(rippleByTicker)
    .sort((a, b) => b[1] - a[1])
    .map(([t, amount]) => ({ ticker: t, amount }));

  // 5. Summary
  const totalCashOut = userBreakdowns
    .filter(u => u.netCashFlow > 0)
    .reduce((s, u) => s + u.netCashFlow, 0);
  const totalCashIntoOthers = Object.values(rippleByTicker).reduce((s, v) => s + v, 0);

  const summary = {
    ticker,
    priceAtStart: Math.round(priceAtStart * 100) / 100,
    currentPrice: Math.round(currentPrice * 100) / 100,
    priceInflation: priceAtStart > 0
      ? Math.round(((currentPrice - priceAtStart) / priceAtStart) * 10000) / 100
      : 0,
    totalUsers: userBreakdowns.length,
    totalTrades: trades.length,
    totalCashOut: Math.round(totalCashOut * 100) / 100,
    cashIntoOtherStocks: Math.round(totalCashIntoOthers * 100) / 100,
    cashSittingAsCash: Math.round((totalCashOut - totalCashIntoOthers) * 100) / 100,
    windowStart: startDate.toISOString()
  };

  return {
    summary,
    users: userBreakdowns,
    rippleByTicker: sortedRipple,
    userRipples
  };
});

// ─── TICKER RECOVERY ────────────────────────────────────────────────────────
exports.recoverTicker = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { ticker, startTimestamp, rollbackToTimestamp, dryRun } = data;
  if (!ticker || !startTimestamp || !rollbackToTimestamp) {
    throw new functions.https.HttpsError('invalid-argument', 'ticker, startTimestamp, and rollbackToTimestamp required');
  }

  // 1. Re-run diagnostic server-side (don't trust client data)
  const startDate = new Date(startTimestamp);

  const marketSnap = await db.collection('market').doc('current').get();
  const marketData = marketSnap.data() || {};
  const currentPrice = (marketData.prices || {})[ticker] || 0;

  // Look up price at rollback timestamp from priceHistory
  const rollbackHistSnap = await priceHistoryRef().get();
  const fullHistory = ((rollbackHistSnap.data() || {})[ticker]) || [];
  let targetPrice = null;
  for (const entry of fullHistory) {
    const entryTs = entry.timestamp?._seconds
      ? entry.timestamp._seconds * 1000
      : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
        : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
    if (entryTs <= rollbackToTimestamp) {
      targetPrice = entry.price;
    }
  }
  // Fallback: check archived price history if live array had no match
  if (targetPrice === null) {
    const archiveSnap = await db.collection('market').doc('current')
      .collection('price_history').doc(ticker).get();
    if (archiveSnap.exists) {
      const archiveData = archiveSnap.data();
      const archiveHistory = archiveData.history || [];
      for (const entry of archiveHistory) {
        const entryTs = entry.timestamp?._seconds
          ? entry.timestamp._seconds * 1000
          : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
            : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
        if (entryTs <= rollbackToTimestamp) {
          targetPrice = entry.price;
        }
      }
    }
  }

  if (targetPrice === null) {
    throw new functions.https.HttpsError('not-found', `No price history found at or before rollback timestamp for ${ticker}`);
  }

  // Query all trades for this ticker after startTimestamp
  const tradesSnap = await db.collection('trades')
    .where('ticker', '==', ticker)
    .where('timestamp', '>', startDate)
    .get();

  const trades = [];
  tradesSnap.forEach(doc => {
    const t = doc.data();
    const ts = t.timestamp?._seconds
      ? t.timestamp._seconds * 1000
      : (t.timestamp?.seconds ? t.timestamp.seconds * 1000 : 0);
    trades.push({ ...t, _ts: ts, id: doc.id });
  });

  // Group by uid
  const userMap = {};
  for (const t of trades) {
    if (!userMap[t.uid]) {
      userMap[t.uid] = { buys: [], sells: [], shorts: [], covers: [] };
    }
    const action = (t.action || '').toLowerCase();
    if (action === 'buy') userMap[t.uid].buys.push(t);
    else if (action === 'sell') userMap[t.uid].sells.push(t);
    else if (action === 'short') userMap[t.uid].shorts.push(t);
    else if (action === 'cover') userMap[t.uid].covers.push(t);
  }

  const uids = Object.keys(userMap);

  // Fetch user docs
  const userDocs = {};
  for (const uid of uids) {
    const snap = await db.collection('users').doc(uid).get();
    if (snap.exists) userDocs[uid] = snap.data();
  }

  // Build per-user net cash flow
  const clawbacks = [];
  const holdersAffected = [];
  let totalClawedBack = 0;
  let totalUnrecoverable = 0;

  const recoveryId = `recover_${ticker}_${Date.now()}`;

  for (const uid of uids) {
    const { buys, sells, shorts, covers } = userMap[uid];
    const userData = userDocs[uid] || {};

    // Skip bots
    if (userData.isBot) continue;

    const totalTrades = buys.length + sells.length + shorts.length + covers.length;
    if (totalTrades === 0) continue;

    const cashSpent = buys.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashReceived = sells.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashFromShorts = shorts.reduce((s, t) => s + (t.totalValue || 0), 0);
    const cashToCover = covers.reduce((s, t) => s + (t.totalValue || 0), 0);
    const netCashFlow = (cashReceived + cashFromShorts) - (cashSpent + cashToCover);

    // Track holders who will see value drop from price reset
    const currentHoldings = (userData.holdings || {})[ticker] || 0;
    if (currentHoldings > 0 && targetPrice < currentPrice) {
      const valueDrop = currentHoldings * (currentPrice - targetPrice);
      holdersAffected.push({
        uid,
        displayName: userData.displayName || 'Unknown',
        holdings: currentHoldings,
        valueDrop: Math.round(valueDrop * 100) / 100
      });
    }

    // Only claw back from profiteers
    if (netCashFlow <= 0) continue;

    // Check for existing recovery log (idempotent)
    const repairLog = userData._repairLog || [];
    if (repairLog.some(entry => entry.recoveryId === recoveryId)) continue;

    const previousCash = Math.round((userData.cash || 0) * 100) / 100;
    const clawbackAmount = Math.round(netCashFlow * 100) / 100;
    const newCash = Math.max(0, previousCash - clawbackAmount);
    const actualClawback = Math.round((previousCash - newCash) * 100) / 100;
    const wasFloored = actualClawback < clawbackAmount;

    if (wasFloored) {
      totalUnrecoverable += (clawbackAmount - actualClawback);
    }
    totalClawedBack += actualClawback;

    clawbacks.push({
      uid,
      displayName: userData.displayName || 'Unknown',
      previousCash,
      newCash,
      clawbackAmount,
      actualClawback,
      wasFloored
    });
  }

  totalClawedBack = Math.round(totalClawedBack * 100) / 100;
  totalUnrecoverable = Math.round(totalUnrecoverable * 100) / 100;

  // Build new price history: keep entries before rollback, add flat line
  const keptHistory = [];
  let removedCount = 0;
  for (const entry of fullHistory) {
    const entryTs = entry.timestamp?._seconds
      ? entry.timestamp._seconds * 1000
      : (entry.timestamp?.seconds ? entry.timestamp.seconds * 1000
        : (typeof entry.timestamp === 'number' ? entry.timestamp : 0));
    if (entryTs <= rollbackToTimestamp) {
      keptHistory.push(entry);
    } else {
      removedCount++;
    }
  }
  // Add flat line anchors
  const newHistoryEntries = [
    { timestamp: rollbackToTimestamp, price: targetPrice },
    { timestamp: Date.now(), price: targetPrice }
  ];
  const newHistory = [...keptHistory, ...newHistoryEntries];

  const result = {
    dryRun: !!dryRun,
    ticker,
    priceReset: { from: Math.round(currentPrice * 100) / 100, to: targetPrice },
    clawbacks,
    holdersAffected,
    totalClawedBack,
    totalUnrecoverable,
    historyRewrite: { removedEntries: removedCount, keptEntries: keptHistory.length, newTotalEntries: newHistory.length }
  };

  // If dry run, return preview only
  if (dryRun) return result;

  // 2. Execute writes
  const batch = db.batch();

  // Reset price and rewrite price history (history lives in its own doc)
  batch.update(db.collection('market').doc('current'), {
    [`prices.${ticker}`]: targetPrice
  });
  batch.set(priceHistoryRef(), { [ticker]: newHistory }, { merge: true });

  // Claw back cash from profiteers
  for (const cb of clawbacks) {
    const userRef = db.collection('users').doc(cb.uid);
    batch.update(userRef, {
      cash: cb.newCash,
      _repairLog: admin.firestore.FieldValue.arrayUnion({
        recoveryId,
        type: 'ticker_recovery',
        ticker,
        clawbackAmount: cb.actualClawback,
        previousCash: cb.previousCash,
        newCash: cb.newCash,
        timestamp: new Date().toISOString()
      })
    });
  }

  await batch.commit();

  return result;
});

// ─── DROP AUDIT ─────────────────────────────────────────────────────────────
exports.auditUserDrops = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  const { uid, username } = data;
  if (!uid && !username) {
    throw new functions.https.HttpsError('invalid-argument', 'uid or username required');
  }

  // Find user
  let userSnap;
  if (uid) {
    userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
  } else {
    const q = await db.collection('users').where('displayName', '==', username).limit(1).get();
    if (q.empty) throw new functions.https.HttpsError('not-found', 'User not found');
    userSnap = q.docs[0];
  }

  const userData = userSnap.data();
  const userId = userSnap.id;
  const claimedMessages = userData.claimedDailyStockMessages || [];

  // Extract timestamps from Discord snowflake IDs
  const DISCORD_EPOCH = 1420070400000n;
  const claimTimestamps = claimedMessages.map(id => {
    try {
      const snowflake = BigInt(id);
      const ms = Number((snowflake >> 22n) + DISCORD_EPOCH);
      return ms;
    } catch { return null; }
  }).filter(Boolean).sort((a, b) => a - b);

  // Calculate expected claims (1 per day since first claim)
  const firstClaim = claimTimestamps.length > 0 ? claimTimestamps[0] : null;
  const now = Date.now();
  const daysSinceFirst = firstClaim ? Math.floor((now - firstClaim) / (24 * 60 * 60 * 1000)) + 1 : 0;

  // Get market prices
  const marketSnap = await db.collection('market').doc('current').get();
  const marketData = marketSnap.data() || {};
  const prices = marketData.prices || {};

  // Get ALL trades for this user
  const tradesSnap = await db.collection('trades').where('uid', '==', userId).get();
  const trades = tradesSnap.docs.map(d => d.data());

  // Calculate gifted shares per ticker
  const holdings = userData.holdings || {};
  const giftedSharesByTicker = {};
  let totalGiftedValue = 0;

  for (const [ticker, held] of Object.entries(holdings)) {
    if (held <= 0) continue;
    const tickerTrades = trades.filter(t => t.ticker === ticker);
    const bought = tickerTrades.filter(t => t.action === 'buy').reduce((s, t) => s + (t.amount || 0), 0);
    const sold = tickerTrades.filter(t => t.action === 'sell').reduce((s, t) => s + (t.amount || 0), 0);
    const netTraded = bought - sold;
    const gifted = Math.max(0, held - netTraded);
    if (gifted > 0) {
      const price = prices[ticker] || 0;
      giftedSharesByTicker[ticker] = { shares: gifted, price, value: Math.round(gifted * price * 100) / 100 };
      totalGiftedValue += gifted * price;
    }
  }

  totalGiftedValue = Math.round(totalGiftedValue * 100) / 100;

  // Claim frequency analysis — group claims by day
  const claimsByDay = {};
  for (const ts of claimTimestamps) {
    const day = new Date(ts).toISOString().split('T')[0];
    claimsByDay[day] = (claimsByDay[day] || 0) + 1;
  }

  // Find days with suspicious multi-claims
  const suspiciousDays = Object.entries(claimsByDay)
    .filter(([, count]) => count > 3)
    .sort((a, b) => b[1] - a[1])
    .map(([day, count]) => ({ day, count }));

  return {
    uid: userId,
    displayName: userData.displayName || 'Unknown',
    totalClaims: claimedMessages.length,
    expectedClaims: daysSinceFirst,
    excessClaims: Math.max(0, claimedMessages.length - daysSinceFirst),
    firstClaimDate: firstClaim ? new Date(firstClaim).toISOString() : null,
    claimTimestamps,
    claimsByDay,
    suspiciousDays,
    giftedSharesByTicker,
    totalGiftedValue,
    cash: Math.round((userData.cash || 0) * 100) / 100
  };
});

