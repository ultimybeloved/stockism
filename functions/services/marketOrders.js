'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTER_MAP } = require('../characters');
const { ADMIN_UID, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MAX_PRICE_CHANGE_PERCENT, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS, MAX_DAILY_IMPACT } = require('../constants');
const { writeNotification, writeFeedEntry, calculateMarginalImpact, getAccountAgeImpactFactor, pruneAndSumTradeHistory, applyDueIPOJumps, reportError, appendPriceHistory } = require('../helpers');

const round2 = (n) => Math.round(n * 100) / 100;

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

const getSpread = (ticker) => (CHARACTER_MAP[ticker]?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD);

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
        const estAsk = basePrice * (1 + getSpread(order.ticker) / 2);
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

      const spread = getSpread(ticker);
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
            transaction.update(userRef, {
              cash: admin.firestore.FieldValue.increment(-executionPrice * localFillShares),
              [`holdings.${order.ticker}`]: newHoldings,
              [`costBasis.${order.ticker}`]: newCostBasis,
              [`lastBuyTime.${order.ticker}`]: admin.firestore.Timestamp.now(),
              lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
              totalTrades: admin.firestore.FieldValue.increment(1)
            });
          } else {
            const userShares = ud.holdings?.[order.ticker] || 0;
            localFillShares = round2(Math.min(localFillShares, userShares));
            if (localFillShares < 0.01) throw new Error('Insufficient shares');

            const newHoldings = Math.round((userShares - localFillShares) * 10000) / 10000;
            const updates = {
              cash: admin.firestore.FieldValue.increment(executionPrice * localFillShares),
              lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
              totalTrades: admin.firestore.FieldValue.increment(1)
            };
            if (newHoldings <= 0) {
              updates[`holdings.${order.ticker}`] = admin.firestore.FieldValue.delete();
              updates[`costBasis.${order.ticker}`] = admin.firestore.FieldValue.delete();
              updates[`lowestWhileHolding.${order.ticker}`] = admin.firestore.FieldValue.delete();
            } else {
              updates[`holdings.${order.ticker}`] = newHoldings;
            }
            transaction.update(userRef, updates);
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
  const openingPrices = marketSnap.data().prices || {};

  const ordersSnapshot = await db.collection('limitOrders')
    .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
    .get();

  console.log(`runMarketOpenProcessing: checking ${ordersSnapshot.size} limit orders`);

  for (const orderDoc of ordersSnapshot.docs) {
    const order = orderDoc.data();
    if (order.type !== 'STOP_LOSS') continue;

    const openingPrice = openingPrices[order.ticker];
    if (!openingPrice || openingPrice > order.limitPrice) continue;

    const userRef = db.collection('users').doc(order.userId);
    const alreadyFilled = order.filledShares || 0;
    let fillShares = order.shares - alreadyFilled;
    let executedPrice = 0;
    let feedDisplayName = '';
    let feedCrew = null;

    try {
      await db.runTransaction(async (transaction) => {
        const freshOrderSnap = await transaction.get(orderDoc.ref);
        if (!freshOrderSnap.exists || !['PENDING', 'PARTIALLY_FILLED'].includes(freshOrderSnap.data().status)) {
          throw new Error('Order already processed');
        }
        const freshAlreadyFilled = freshOrderSnap.data().filledShares || 0;
        fillShares = order.shares - freshAlreadyFilled;
        const userSnap = await transaction.get(userRef);
        const freshMarketSnap = await transaction.get(marketRef);
        if (!userSnap.exists) throw new Error('User not found');
        const userData = userSnap.data();
        feedDisplayName = userData.displayName || 'Anonymous';
        feedCrew = userData.crew || null;
        const freshPrice = freshMarketSnap.data().prices?.[order.ticker] || openingPrice;

        if (userData.isBankrupt || (userData.cash || 0) < 0) throw new Error('User is bankrupt');
        if (userData.requiresDiscordLink && !userData.discordId) throw new Error('Discord verification required');
        const userShares = userData.holdings?.[order.ticker] || 0;
        if (userShares < fillShares) {
          if (order.allowPartialFills && userShares > 0) {
            fillShares = userShares;
          } else {
            throw new Error('Insufficient shares');
          }
        }

        const now = Date.now();
        const limitTradeHistory = userData.tickerTradeHistory || {};
        const limitActionHistory = limitTradeHistory[order.ticker]?.['sell'] || [];
        const { totalShares: cumVol, count: tradeCount } = pruneAndSumTradeHistory(limitActionHistory, now);
        if (tradeCount >= MAX_TRADES_PER_TICKER_24H) throw new Error('Trade limit reached');

        // Daily 10% impact cap (same rule as executeTrade): the stop loss still
        // fills, but stops moving the price once the user's daily impact
        // allowance on this ticker is used up. New accounts move less.
        let sweepDailyImpact = 0;
        for (const act of ['buy', 'sell', 'short', 'cover']) {
          const { totalImpact } = pruneAndSumTradeHistory(limitTradeHistory[order.ticker]?.[act] || [], now);
          sweepDailyImpact += totalImpact;
        }
        const remainingSweepImpact = Math.max(0, MAX_DAILY_IMPACT - sweepDailyImpact);
        const effectiveImpact = Math.min(
          calculateMarginalImpact(freshPrice, fillShares, cumVol) * getAccountAgeImpactFactor(userData),
          freshPrice * remainingSweepImpact
        );
        const spread = getSpread(order.ticker);
        const newMarketPrice = Math.max(0.01, round2(freshPrice - effectiveImpact));
        const bidPrice = newMarketPrice * (1 - spread / 2);
        executedPrice = round2(bidPrice);

        const updatedHistory = JSON.parse(JSON.stringify(limitTradeHistory));
        if (!updatedHistory[order.ticker]) updatedHistory[order.ticker] = {};
        if (!updatedHistory[order.ticker]['sell']) updatedHistory[order.ticker]['sell'] = [];
        const cutoff = now - TWENTY_FOUR_HOURS_MS;
        updatedHistory[order.ticker]['sell'] = updatedHistory[order.ticker]['sell'].filter(e => e.ts > cutoff);
        updatedHistory[order.ticker]['sell'].push({
          ts: now,
          shares: fillShares,
          impact: freshPrice > 0 ? effectiveImpact / freshPrice : 0
        });

        const newHoldings = Math.round(((userData.holdings?.[order.ticker] || 0) - fillShares) * 10000) / 10000;
        const updates = {
          cash: admin.firestore.FieldValue.increment(executedPrice * fillShares),
          [`holdings.${order.ticker}`]: newHoldings,
          lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
          totalTrades: admin.firestore.FieldValue.increment(1),
          tickerTradeHistory: updatedHistory
        };
        if (newHoldings <= 0) {
          updates[`holdings.${order.ticker}`] = admin.firestore.FieldValue.delete();
          updates[`costBasis.${order.ticker}`] = admin.firestore.FieldValue.delete();
          updates[`lowestWhileHolding.${order.ticker}`] = admin.firestore.FieldValue.delete();
        }
        transaction.update(userRef, updates);
        if (effectiveImpact > 0) {
          transaction.update(marketRef, {
            [`prices.${order.ticker}`]: newMarketPrice
          });
          appendPriceHistory(transaction, {
            [order.ticker]: { timestamp: now, price: newMarketPrice }
          });
        }
        const newFilledTotal = freshAlreadyFilled + fillShares;
        const isPartial = order.allowPartialFills && newFilledTotal < order.shares;
        transaction.update(orderDoc.ref, {
          status: isPartial ? 'PARTIALLY_FILLED' : 'FILLED',
          filledShares: newFilledTotal,
          executedPrice,
          executedAt: admin.firestore.FieldValue.serverTimestamp(),
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });
      });
      await writeNotification(order.userId, {
        type: 'trade',
        title: 'Stop Loss Filled',
        message: `Your stop loss for ${fillShares} $${order.ticker} executed at $${executedPrice.toFixed(2)}`,
        data: { ticker: order.ticker, orderId: orderDoc.id, price: executedPrice }
      });
      writeFeedEntry({
        type: 'trade',
        userId: order.userId,
        displayName: feedDisplayName,
        crew: feedCrew,
        ticker: order.ticker,
        action: 'sell',
        amount: fillShares,
        price: executedPrice,
        message: `sold ${fillShares} $${order.ticker} via stop loss`
      });
      summary.stopLossFilled++;
    } catch (err) {
      console.log(`runMarketOpenProcessing: stop loss ${orderDoc.id} skipped — ${err.message}`);
      summary.stopLossSkipped++;
    }
  }

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
