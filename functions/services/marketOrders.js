'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTER_MAP } = require('../characters');
const { ADMIN_UID, MAX_PRICE_CHANGE_PERCENT } = require('../constants');
const { writeNotification, writeFeedEntry, calculateMarginalImpact, applyDueIPOJumps, reportError, appendPriceHistory, lockedShares, buildTradeCreditUpdates, recordTrade, round2, spreadFor } = require('../helpers');
const { updateCrewMissionProgress } = require('./crewMissionProgress');
// Same propagation executeTrade and limit fills use, so the auction moves
// related characters and parent ETFs the same way every other lane does.
const { computePriceUpdates } = require('./tradePricing');
// The stop-loss sweep that runs on the opening prices this file computes.
const { runStopLossSweep } = require('./marketOpenStopLoss');


// Most recent Thursday 20:30 UTC — the start of the current pre-market session.
// A manual re-run later in the same week still targets that session's orders;
// anything older is expired by the cleanup pass instead of filled.
const getSessionPreMarketStart = () => {
  const d = new Date();
  const day = d.getUTCDay();
  const utcMins = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (!(day === 4 && utcMins >= 1230)) {
    const daysBack = (day - 4 + 7) % 7 || 7;
    d.setUTCDate(d.getUTCDate() - daysBack);
  }
  d.setUTCHours(20, 30, 0, 0);
  return d;
};


/**
 * Pre-market opening auction + stop-loss sweep + stranded-order cleanup.
 *
 * Runs Thursday 20:56 UTC — AFTER the order lock (20:55) and BEFORE the market
 * reopens (21:00) — so opening prices settle while the market is still halted
 * and never fight with live trades.
 *
 * Shared by the cron schedule and the admin-only manual trigger
 * (triggerMarketOpenOrders) for recovery if a run fails.
 */
const runMarketOpenProcessing = async (trigger) => {
  const summary = { trigger, ipoJumps: 0, pmFilled: 0, pmFailed: 0, pmExpired: 0, stopLossFilled: 0, stopLossSkipped: 0 };
  const marketRef = db.collection('market').doc('current');

  // ── 1. Apply IPO jumps deferred by the halt ──────────────────────────────
  // The +15% jump must land before opening prices are computed, otherwise the
  // jump and the auction overwrite each other's prices.
  try {
    const jumped = await applyDueIPOJumps();
    summary.ipoJumps = jumped.length;
  } catch (err) {
    reportError(err, { where: 'runMarketOpenProcessing: IPO jumps' });
  }

  let marketSnap = await marketRef.get();
  if (!marketSnap.exists) return summary;

  const sessionStart = getSessionPreMarketStart();
  const currentPrices = marketSnap.data().prices || {};
  const launchedTickers = marketSnap.data().launchedTickers || [];

  // ── 2. Collect this session's pending pre-market orders ──────────────────
  const preMarketSnap = await db.collection('preMarketOrders')
    .where('status', '==', 'PENDING')
    .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(sessionStart))
    .get();

  console.log(`runMarketOpenProcessing(${trigger}): ${preMarketSnap.size} pre-market orders in opening auction`);

  const failOrder = async (doc, order, reason) => {
    await doc.ref.update({ status: 'FAILED', failReason: reason, updatedAt: admin.firestore.FieldValue.serverTimestamp() });
    await writeNotification(order.userId, {
      type: 'trade',
      title: 'Market Open Order Failed',
      message: `Your ${order.action} of ${order.shares} $${order.ticker} could not be filled: ${reason}`,
      data: { ticker: order.ticker, orderId: doc.id }
    });
    summary.pmFailed++;
  };

  if (!preMarketSnap.empty) {
    // ── 3. Pass 1: pre-validate orders and compute fillable shares ─────────
    // Opening prices must only move on demand that can actually execute.
    // Orders that can't fill (no cash, banned, unlaunched IPO ticker) are
    // failed here and contribute nothing — no more phantom demand pumping
    // the open, and no free manipulation by queueing unaffordable buys.
    const orders = preMarketSnap.docs
      .map(doc => ({ doc, order: doc.data() }))
      .sort((a, b) => (a.order.createdAt?.toMillis?.() || 0) - (b.order.createdAt?.toMillis?.() || 0));

    const userCache = new Map();
    for (const { order } of orders) {
      if (!userCache.has(order.userId)) {
        const snap = await db.collection('users').doc(order.userId).get();
        userCache.set(order.userId, snap.exists ? snap.data() : null);
      }
    }

    const cashAvail = new Map();   // userId -> uncommitted cash across their buy orders
    const sharesAvail = new Map(); // userId_ticker -> uncommitted shares across their sell orders
    const executable = [];

    for (const { doc, order } of orders) {
      const ud = userCache.get(order.userId);
      let failReason = null;
      if (!ud) failReason = 'User not found';
      else if (ud.isBanned) failReason = 'Account is banned';
      else if (ud.requiresDiscordLink && !ud.discordId) failReason = 'Discord verification required';
      else if (ud.isBankrupt || (ud.cash || 0) < 0) failReason = 'Account is bankrupt or in debt';
      else if (CHARACTER_MAP[order.ticker]?.ipoRequired && !launchedTickers.includes(order.ticker)) failReason = 'Stock is still in IPO phase';
      if (failReason) { await failOrder(doc, order, failReason); continue; }

      const basePrice = currentPrices[order.ticker] || CHARACTER_MAP[order.ticker]?.basePrice;
      if (!basePrice) { await failOrder(doc, order, 'No market price'); continue; }

      let fillable = 0;
      if (order.action === 'buy') {
        if (!cashAvail.has(order.userId)) cashAvail.set(order.userId, ud.cash || 0);
        const estAsk = basePrice * (1 + spreadFor(order.ticker) / 2);
        fillable = Math.min(order.shares, Math.floor(cashAvail.get(order.userId) / estAsk * 100) / 100);
        if (fillable >= 0.01) cashAvail.set(order.userId, cashAvail.get(order.userId) - estAsk * fillable);
      } else {
        const key = `${order.userId}_${order.ticker}`;
        if (!sharesAvail.has(key)) sharesAvail.set(key, ud.holdings?.[order.ticker] || 0);
        fillable = Math.min(order.shares, sharesAvail.get(key));
        if (fillable >= 0.01) sharesAvail.set(key, sharesAvail.get(key) - fillable);
      }
      fillable = round2(fillable);
      if (fillable < 0.01) {
        await failOrder(doc, order, order.action === 'buy' ? 'Insufficient cash' : 'Insufficient shares');
        continue;
      }
      executable.push({ doc, order, fillableShares: fillable });
    }

    // ── 4. Pass 2: one opening price per ticker from fillable demand ───────
    const byTicker = {};
    for (const e of executable) {
      if (!byTicker[e.order.ticker]) byTicker[e.order.ticker] = { buys: 0, sells: 0 };
      byTicker[e.order.ticker][e.order.action === 'buy' ? 'buys' : 'sells'] += e.fillableShares;
    }

    const auctionPrices = {}; // ticker -> { openingPrice, openingAsk, openingBid }
    const priceWrites = {};
    const auctionHistoryPoints = {};
    for (const [ticker, { buys, sells }] of Object.entries(byTicker)) {
      const basePrice = currentPrices[ticker] || CHARACTER_MAP[ticker]?.basePrice;
      const netDemand = buys - sells;

      let openingPrice = basePrice;
      if (Math.abs(netDemand) >= 0.01) {
        const impact = calculateMarginalImpact(basePrice, Math.abs(netDemand), 0);
        openingPrice = netDemand > 0
          ? Math.min(basePrice + impact, basePrice * (1 + MAX_PRICE_CHANGE_PERCENT))
          : Math.max(0.01, Math.max(basePrice - impact, basePrice * (1 - MAX_PRICE_CHANGE_PERCENT)));
      }
      openingPrice = round2(openingPrice);

      const spread = spreadFor(ticker);
      auctionPrices[ticker] = {
        openingPrice,
        openingAsk: round2(openingPrice * (1 + spread / 2)),
        openingBid: round2(openingPrice * (1 - spread / 2))
      };

      if (openingPrice !== basePrice) {
        priceWrites[`prices.${ticker}`] = openingPrice;
        auctionHistoryPoints[ticker] = {
          timestamp: Date.now(),
          price: openingPrice,
          source: 'pre_market_auction'
        };
      }
    }
    // Trailing effects + parent-ETF propagation from each ticker the auction
    // moved. A ticker the auction priced itself keeps that price: the auction
    // IS its price discovery, and letting a sibling's trailing overwrite it
    // would undo the opening cross. So propagation only writes tickers the
    // auction did not price.
    const auctionTickers = new Set(Object.keys(byTicker));
    const working = { ...currentPrices };
    for (const t of auctionTickers) working[t] = auctionPrices[t].openingPrice;

    for (const t of auctionTickers) {
      const basePrice = currentPrices[t] || CHARACTER_MAP[t]?.basePrice;
      const { openingPrice } = auctionPrices[t];
      if (!basePrice || openingPrice === basePrice) continue;

      const moved = computePriceUpdates({
        ticker: t, currentPrice: basePrice, newPrice: openingPrice, prices: working,
      });
      for (const [movedTicker, price] of Object.entries(moved)) {
        if (auctionTickers.has(movedTicker)) continue;
        working[movedTicker] = price;
        priceWrites[`prices.${movedTicker}`] = price;
        auctionHistoryPoints[movedTicker] = {
          timestamp: Date.now(),
          price,
          source: 'pre_market_auction'
        };
      }
    }

    if (Object.keys(priceWrites).length > 0) {
      await marketRef.update(priceWrites);
      await appendPriceHistory(null, auctionHistoryPoints);
    }

    // ── 5. Execute fills at the opening price ──────────────────────────────
    // Fills always clamp to what the user can afford/holds (an auction has no
    // meaningful "all or nothing at an unknown price"); the notification says
    // how much filled. The transaction re-checks everything fresh.
    for (const { doc, order } of executable) {
      const prices = auctionPrices[order.ticker];
      const executionPrice = order.action === 'buy' ? prices.openingAsk : prices.openingBid;
      const userRef = db.collection('users').doc(order.userId);
      let fillShares = order.shares; // overwritten by the committed transaction result
      let feedDisplayName = '';
      let feedCrew = null;

      try {
        await db.runTransaction(async (transaction) => {
          // Re-read the order doc inside the transaction so we can mark it FILLED
          // atomically — prevents double-fills if the cron event delivers twice.
          const freshOrderSnap = await transaction.get(doc.ref);
          if (!freshOrderSnap.exists || freshOrderSnap.data().status !== 'PENDING') {
            throw new Error('Order already processed');
          }

          const userSnap = await transaction.get(userRef);
          if (!userSnap.exists) throw new Error('User not found');
          const ud = userSnap.data();
          feedDisplayName = ud.displayName || 'Anonymous';
          feedCrew = ud.crew || null;
          if (ud.isBanned) throw new Error('Account is banned');
          if (ud.requiresDiscordLink && !ud.discordId) throw new Error('Discord verification required');
          if (ud.isBankrupt || (ud.cash || 0) < 0) throw new Error('Account is bankrupt or in debt');

          // Local variable resets correctly on each transaction retry.
          let localFillShares = order.shares;

          if (order.action === 'buy') {
            const affordable = Math.floor((ud.cash || 0) / executionPrice * 100) / 100;
            localFillShares = round2(Math.min(localFillShares, affordable));
            if (localFillShares < 0.01) throw new Error('Insufficient cash');

            const currentHoldings = ud.holdings?.[order.ticker] || 0;
            const currentCostBasis = ud.costBasis?.[order.ticker] || 0;
            const newHoldings = Math.round((currentHoldings + localFillShares) * 10000) / 10000;
            const newCostBasis = currentHoldings > 0
              ? round2(((currentCostBasis * currentHoldings) + (executionPrice * localFillShares)) / newHoldings)
              : executionPrice;
            // Mission/stat credit — same fields executeTrade writes, so
            // pre-market fills count toward missions like regular trades.
            const { updates: creditUpdates } = buildTradeCreditUpdates({
              userData: ud, ticker: order.ticker, action: 'buy', shares: localFillShares,
              totalValue: executionPrice * localFillShares, executionPrice,
              marketPrice: prices.openingPrice
            });
            transaction.update(userRef, {
              cash: admin.firestore.FieldValue.increment(-executionPrice * localFillShares),
              [`holdings.${order.ticker}`]: newHoldings,
              [`costBasis.${order.ticker}`]: newCostBasis,
              [`lastBuyTime.${order.ticker}`]: admin.firestore.Timestamp.now(),
              lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
              ...creditUpdates
            });

            // Same trade record executeTrade writes, so the fill shows up in
            // the player's trade history and the market reports.
            const buyTotal = executionPrice * localFillShares;
            recordTrade(transaction, {
              uid: order.userId,
              ticker: order.ticker,
              action: 'buy',
              amount: localFillShares,
              price: executionPrice,
              totalValue: buyTotal,
              orderId: doc.id,
              cashBefore: ud.cash || 0,
              cashAfter: round2((ud.cash || 0) - buyTotal),
              source: 'premarket',
            });
          } else {
            // Clamp to sellable (holdings minus IPO/margin locks) — locks placed
            // after the order was queued must not be sellable at the auction.
            const userShares = ud.holdings?.[order.ticker] || 0;
            const lockedNow = lockedShares(ud, order.ticker).total;
            const sellableShares = Math.max(0, Math.round((userShares - lockedNow) * 10000) / 10000);
            localFillShares = round2(Math.min(localFillShares, sellableShares));
            if (localFillShares < 0.01) throw new Error('Insufficient shares');

            const newHoldings = Math.round((userShares - localFillShares) * 10000) / 10000;
            // Mission/stat credit — same fields executeTrade writes, so
            // pre-market fills count toward missions like regular trades.
            const { updates: creditUpdates } = buildTradeCreditUpdates({
              userData: ud, ticker: order.ticker, action: 'sell', shares: localFillShares,
              totalValue: executionPrice * localFillShares, executionPrice,
              marketPrice: prices.openingPrice
            });
            const updates = {
              cash: admin.firestore.FieldValue.increment(executionPrice * localFillShares),
              lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
              ...creditUpdates
            };
            if (newHoldings <= 0) {
              updates[`holdings.${order.ticker}`] = admin.firestore.FieldValue.delete();
              updates[`costBasis.${order.ticker}`] = admin.firestore.FieldValue.delete();
              updates[`lowestWhileHolding.${order.ticker}`] = admin.firestore.FieldValue.delete();
            } else {
              updates[`holdings.${order.ticker}`] = newHoldings;
            }
            transaction.update(userRef, updates);

            // Same trade record executeTrade writes, so the fill shows up in
            // the player's trade history and the market reports.
            const sellTotal = executionPrice * localFillShares;
            recordTrade(transaction, {
              uid: order.userId,
              ticker: order.ticker,
              action: 'sell',
              amount: localFillShares,
              price: executionPrice,
              totalValue: sellTotal,
              orderId: doc.id,
              cashBefore: ud.cash || 0,
              cashAfter: round2((ud.cash || 0) + sellTotal),
              source: 'premarket',
            });
          }

          // Mark the order done atomically with the balance change.
          transaction.update(doc.ref, {
            status: localFillShares < order.shares ? 'PARTIALLY_FILLED' : 'FILLED',
            filledShares: localFillShares,
            executedPrice: executionPrice,
            executedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });

          fillShares = localFillShares;
        });

        // Crew mission progress (fire-and-forget, same as executeTrade)
        if (feedCrew) {
          updateCrewMissionProgress(feedCrew, order.userId, order.action, fillShares, order.ticker, executionPrice * fillShares);
        }

        const partialNote = fillShares < order.shares ? ` (filled ${fillShares} of ${order.shares})` : '';
        await writeNotification(order.userId, {
          type: 'trade',
          title: 'Market Open Order Filled',
          message: `Your ${order.action} of ${fillShares} $${order.ticker} executed at $${executionPrice.toFixed(2)} in the opening auction${partialNote}`,
          data: { ticker: order.ticker, orderId: doc.id, price: executionPrice }
        });
        writeFeedEntry({
          type: 'trade',
          userId: order.userId,
          displayName: feedDisplayName,
          crew: feedCrew,
          ticker: order.ticker,
          action: order.action,
          amount: fillShares,
          price: executionPrice,
          message: `${order.action === 'buy' ? 'bought' : 'sold'} ${fillShares} $${order.ticker} via market open auction at $${executionPrice.toFixed(2)}`
        });
        summary.pmFilled++;
      } catch (err) {
        if (err.message !== 'Order already processed') {
          await failOrder(doc, order, err.message);
        }
      }
    }

    console.log(`Opening auction complete: ${summary.pmFilled} filled, ${summary.pmFailed} failed`);

    // Re-fetch market snapshot so stop-loss checks use post-auction prices
    marketSnap = await marketRef.get();
  }

  // ── 6. Stop-loss sweep at opening prices ──────────────────────────────────
  // Its own module (marketOpenStopLoss.js) — a per-order liquidation is a
  // different mechanism from the batch auction above.
  await runStopLossSweep({
    marketRef,
    openingPrices: marketSnap.data().prices || {},
    summary,
  });

  // ── 7. Stranded-order cleanup ─────────────────────────────────────────────
  // Any PENDING pre-market order from a previous session can never fill —
  // expire it and tell the owner, so nothing sits in the queue forever.
  const staleSnap = await db.collection('preMarketOrders')
    .where('status', '==', 'PENDING')
    .where('createdAt', '<', admin.firestore.Timestamp.fromDate(sessionStart))
    .get();
  for (const doc of staleSnap.docs) {
    const order = doc.data();
    await doc.ref.update({
      status: 'EXPIRED',
      failReason: 'Order missed its opening auction',
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });
    await writeNotification(order.userId, {
      type: 'trade',
      title: 'Pre-Market Order Expired',
      message: `Your ${order.action} of ${order.shares} $${order.ticker} missed its opening auction and was cancelled. No cash or shares were taken.`,
      data: { ticker: order.ticker, orderId: doc.id }
    });
    summary.pmExpired++;
  }

  console.log('runMarketOpenProcessing complete:', JSON.stringify(summary));
  return summary;
};

exports.processMarketOpenOrders = cf().pubsub
  .schedule('56 20 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      await runMarketOpenProcessing('schedule');
    } catch (err) {
      reportError(err, { where: 'processMarketOpenOrders' });
    }
    return null;
  });

// Exposed for the emulator end-to-end test (scripts/test-premarket-emulator.cjs)
exports.runMarketOpenProcessing = runMarketOpenProcessing;

// Admin-only recovery: re-runs the same processing (idempotent — filled orders
// are skipped) if the scheduled run failed or was missed.
exports.triggerMarketOpenOrders = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only.');
  }
  try {
    const summary = await runMarketOpenProcessing('manual');
    return { success: true, ...summary };
  } catch (err) {
    reportError(err, { where: 'triggerMarketOpenOrders' });
    throw new functions.https.HttpsError('internal', err.message);
  }
});
