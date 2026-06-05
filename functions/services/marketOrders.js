'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const { ADMIN_UID, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MAX_DAILY_IMPACT, MAX_PRICE_CHANGE_PERCENT, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS } = require('../constants');
const { writeNotification, writeFeedEntry, sendDiscordMessage, calculateMarginalImpact, pruneAndSumTradeHistory } = require('../helpers');


exports.processMarketOpenOrders = functions.pubsub
  .schedule('0 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const marketRef = db.collection('market').doc('current');
      let marketSnap = await marketRef.get();
      if (!marketSnap.exists) return null;

      const ipoSnap = await db.collection('market').doc('ipos').get();
      const ipoMap = {};
      (ipoSnap.data()?.list || []).forEach(ipo => { ipoMap[ipo.ticker] = ipo; });

      // ─── Pre-market opening auction ────────────────────────────────────────
      // Collect all PENDING pre-market orders placed today (after 20:30 UTC)
      const now = new Date();
      const preMarketStart = new Date(now);
      preMarketStart.setUTCHours(20, 30, 0, 0);

      const preMarketSnap = await db.collection('preMarketOrders')
        .where('status', '==', 'PENDING')
        .where('createdAt', '>=', admin.firestore.Timestamp.fromDate(preMarketStart))
        .get();

      console.log(`processMarketOpenOrders: ${preMarketSnap.size} pre-market orders in opening auction`);

      if (!preMarketSnap.empty) {
        const currentPrices = marketSnap.data().prices || {};

        // Group by ticker to compute a single opening price per ticker
        const byTicker = {};
        for (const doc of preMarketSnap.docs) {
          const o = doc.data();
          if (!byTicker[o.ticker]) byTicker[o.ticker] = { buys: [], sells: [] };
          byTicker[o.ticker][o.action === 'buy' ? 'buys' : 'sells'].push({ doc, order: o });
        }

        // Compute opening price for each ticker (net aggregate impact — one move, not per-order)
        const auctionPrices = {}; // ticker -> { openingPrice, openingAsk, openingBid }
        for (const [ticker, { buys, sells }] of Object.entries(byTicker)) {
          const basePrice = currentPrices[ticker] || CHARACTER_MAP[ticker]?.basePrice;
          if (!basePrice) continue;

          const totalBuy = buys.reduce((s, { order: o }) => s + o.shares, 0);
          const totalSell = sells.reduce((s, { order: o }) => s + o.shares, 0);
          const netDemand = totalBuy - totalSell;

          const orderChar = CHARACTERS.find(c => c.ticker === ticker);
          const spread = orderChar?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;

          let openingPrice = basePrice;
          if (Math.abs(netDemand) >= 0.01) {
            const impact = calculateMarginalImpact(basePrice, Math.abs(netDemand), 0);
            openingPrice = netDemand > 0
              ? Math.min(basePrice + impact, basePrice * (1 + MAX_PRICE_CHANGE_PERCENT))
              : Math.max(0.01, Math.max(basePrice - impact, basePrice * (1 - MAX_PRICE_CHANGE_PERCENT)));
          }
          openingPrice = Math.round(openingPrice * 100) / 100;

          auctionPrices[ticker] = {
            openingPrice,
            openingAsk: Math.round(openingPrice * (1 + spread / 2) * 100) / 100,
            openingBid: Math.round(openingPrice * (1 - spread / 2) * 100) / 100
          };

          // Skip price write for IPO tickers whose jump already set the correct price
          if (ipoMap[ticker]?.priceJumped) continue;

          // Write the new opening price to the market once per ticker
          await marketRef.update({
            [`prices.${ticker}`]: openingPrice,
            [`priceHistory.${ticker}`]: admin.firestore.FieldValue.arrayUnion({
              timestamp: Date.now(),
              price: openingPrice,
              source: 'pre_market_auction'
            })
          });
        }

        // Execute each pre-market order at the pre-computed opening price
        let pmFilled = 0, pmFailed = 0;
        for (const { doc, order } of Object.values(byTicker).flatMap(g => [...g.buys, ...g.sells])) {
          const prices = auctionPrices[order.ticker];
          if (!prices) {
            await doc.ref.update({ status: 'FAILED', failReason: 'No market price', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
            pmFailed++;
            continue;
          }

          const executionPrice = order.action === 'buy' ? prices.openingAsk : prices.openingBid;
          const userRef = db.collection('users').doc(order.userId);
          let fillShares = order.shares; // will be overwritten by the committed transaction result
          let feedDisplayName = '';
          let feedCrew = null;

          try {
            await db.runTransaction(async (transaction) => {
              // Re-read the order doc inside the transaction so we can mark it FILLED atomically.
              // This prevents double-fills if Cloud Scheduler delivers the cron event twice.
              const freshOrderSnap = await transaction.get(doc.ref);
              if (!freshOrderSnap.exists || freshOrderSnap.data().status !== 'PENDING') {
                throw new Error('Order already processed');
              }

              const userSnap = await transaction.get(userRef);
              if (!userSnap.exists) throw new Error('User not found');
              const ud = userSnap.data();
              feedDisplayName = ud.displayName || 'Anonymous';
              feedCrew = ud.crew || null;
              if (ud.isBankrupt) throw new Error('User is bankrupt');

              // Use a local variable that resets correctly on each transaction retry.
              let localFillShares = order.shares;

              if (order.action === 'buy') {
                const totalCost = executionPrice * localFillShares;
                if ((ud.cash || 0) < totalCost) {
                  if (order.allowPartialFills && (ud.cash || 0) >= executionPrice) {
                    localFillShares = Math.round(Math.floor((ud.cash || 0) / executionPrice * 100) / 100 * 100) / 100;
                  } else {
                    throw new Error('Insufficient cash');
                  }
                }
                const currentHoldings = ud.holdings?.[order.ticker] || 0;
                const currentCostBasis = ud.costBasis?.[order.ticker] || 0;
                const newHoldings = Math.round((currentHoldings + localFillShares) * 10000) / 10000;
                const newCostBasis = currentHoldings > 0
                  ? Math.round(((currentCostBasis * currentHoldings) + (executionPrice * localFillShares)) / newHoldings * 100) / 100
                  : executionPrice;
                transaction.update(userRef, {
                  cash: admin.firestore.FieldValue.increment(-executionPrice * localFillShares),
                  [`holdings.${order.ticker}`]: newHoldings,
                  [`costBasis.${order.ticker}`]: newCostBasis,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1)
                });
              } else {
                const userShares = ud.holdings?.[order.ticker] || 0;
                if (userShares < localFillShares) {
                  if (order.allowPartialFills && userShares > 0) {
                    localFillShares = userShares;
                  } else {
                    throw new Error('Insufficient shares');
                  }
                }
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

              // Mark the order FILLED atomically with the user update — prevents double-fill on retry.
              const isPartialLocal = order.allowPartialFills && localFillShares < order.shares;
              transaction.update(doc.ref, {
                status: isPartialLocal ? 'PARTIALLY_FILLED' : 'FILLED',
                filledShares: localFillShares,
                executedPrice: executionPrice,
                executedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });

              // Capture result for post-transaction notifications (safe: only written on commit).
              fillShares = localFillShares;
            });

            await writeNotification(order.userId, {
              type: 'trade',
              title: 'Market Open Order Filled',
              message: `Your ${order.action} of ${fillShares} $${order.ticker} executed at $${executionPrice.toFixed(2)} in the opening auction`,
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
            pmFilled++;
          } catch (err) {
            if (err.message !== 'Order already processed') {
              await doc.ref.update({
                status: 'FAILED',
                failReason: err.message,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              await writeNotification(order.userId, {
                type: 'trade',
                title: 'Market Open Order Failed',
                message: `Your ${order.action} of ${order.shares} $${order.ticker} could not be filled: ${err.message}`,
                data: { ticker: order.ticker, orderId: doc.id }
              });
              pmFailed++;
            }
          }
        }

        console.log(`Opening auction complete: ${pmFilled} filled, ${pmFailed} failed`);

        // Re-fetch market snapshot so stop-loss checks use post-auction prices
        marketSnap = await marketRef.get();
      }

      const openingPrices = marketSnap.data().prices || {};

      const ordersSnapshot = await db.collection('limitOrders')
        .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
        .get();

      console.log(`processMarketOpenOrders: checking ${ordersSnapshot.size} orders`);
      let filled = 0;
      let skipped = 0;

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

            const effectiveImpact = calculateMarginalImpact(freshPrice, fillShares, cumVol);
            const orderChar = CHARACTERS.find(c => c.ticker === order.ticker);
            const spread = orderChar?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;
            const newMarketPrice = Math.max(0.01, Math.round((freshPrice - effectiveImpact) * 100) / 100);
            const bidPrice = newMarketPrice * (1 - spread / 2);
            executedPrice = Math.round(bidPrice * 100) / 100;

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
                [`prices.${order.ticker}`]: newMarketPrice,
                [`priceHistory.${order.ticker}`]: admin.firestore.FieldValue.arrayUnion({
                  timestamp: now,
                  price: newMarketPrice
                })
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
          console.log(`processMarketOpenOrders: filled stop loss ${orderDoc.id} — ${fillShares} ${order.ticker} @ $${executedPrice}`);
          filled++;
        } catch (err) {
          console.log(`processMarketOpenOrders: order ${orderDoc.id} skipped — ${err.message}`);
          skipped++;
        }
      }

      console.log(`processMarketOpenOrders complete: ${filled} filled, ${skipped} skipped`);
      return null;
    } catch (err) {
      console.error('processMarketOpenOrders failed:', err);
      return null;
    }
  });
