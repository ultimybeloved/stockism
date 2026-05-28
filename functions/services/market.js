'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS } = require('../characters');
const { ADMIN_UID, BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MAX_DAILY_IMPACT, MAX_PRICE_CHANGE_PERCENT, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS } = require('../constants');
const { writeNotification, writeFeedEntry, sendDiscordMessage, calculateMarginalImpact, pruneAndSumTradeHistory } = require('../helpers');

exports.dailyMarketSummary = functions.pubsub
  .schedule('0 21 * * *')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.log('No market data found');
        return null;
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};

      // Get all users for stats
      const usersSnap = await db.collection('users').get();
      const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate 24h changes
      const now = Date.now();
      const dayAgo = now - (24 * 60 * 60 * 1000);
      const gainers = [];
      const losers = [];
      const athStocks = [];

      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        // Find price 24h ago
        let price24hAgo = history[0].price;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= dayAgo) {
            price24hAgo = history[i].price;
            break;
          }
        }

        const change = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
        const stock = { ticker, price: currentPrice, change };

        if (change > 0) gainers.push(stock);
        if (change < 0) losers.push(stock);

        // Check for ATH
        const highestHistorical = Math.max(...history.map(h => h.price));
        if (currentPrice >= highestHistorical) {
          athStocks.push(ticker);
        }
      });

      gainers.sort((a, b) => b.change - a.change);
      losers.sort((a, b) => a.change - b.change);

      // Calculate trading volume (from transaction logs)
      let totalVolume = 0;
      let tradeCount = 0;
      const traderActivity = {};

      users.forEach(user => {
        const txLog = user.transactionLog || [];
        txLog.forEach(tx => {
          if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.timestamp > dayAgo) {
            totalVolume += tx.totalCost || tx.totalRevenue || 0;
            tradeCount++;
            traderActivity[user.id] = (traderActivity[user.id] || 0) + 1;
          }
        });
      });

      const topTraders = Object.entries(traderActivity)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);

      // Build Discord embed
      const embed = {
        title: '📊 Daily Market Summary',
        description: `Market close - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
        color: 0xFF6B35,
        fields: [
          {
            name: '📈 Market Activity',
            value: `${tradeCount} trades • $${totalVolume.toFixed(2)} volume`,
            inline: false
          },
          {
            name: '🔥 Top Gainers (24h)',
            value: gainers.slice(0, 3).map(s =>
              `**${s.ticker}** $${s.price.toFixed(2)} (+${s.change.toFixed(1)}%)`
            ).join('\n') || 'None',
            inline: true
          },
          {
            name: '📉 Top Losers (24h)',
            value: losers.slice(0, 3).map(s =>
              `**${s.ticker}** $${s.price.toFixed(2)} (${s.change.toFixed(1)}%)`
            ).join('\n') || 'None',
            inline: true
          }
        ],
        timestamp: new Date().toISOString()
      };

      if (athStocks.length > 0) {
        embed.fields.push({
          name: '🎯 New All-Time Highs',
          value: athStocks.slice(0, 5).join(', '),
          inline: false
        });
      }

      if (topTraders.length > 0) {
        embed.fields.push({
          name: '⚡ Most Active Traders',
          value: topTraders.map((_, i) => `#${i + 1}: ${topTraders[i][1]} trades`).join('\n'),
          inline: false
        });
      }

      embed.fields.push({
        name: '💰 Market Stats',
        value: `Total Cash: $${Math.round(users.reduce((sum, u) => sum + (u.cash || 0), 0)).toLocaleString()}\nActive Traders: ${users.length}`,
        inline: false
      });

      await sendDiscordMessage(null, [embed]);
      return null;
    } catch (error) {
      console.error('Error in dailyMarketSummary:', error);
      return null;
    }
  });

/**
 * Save pre-halt prices snapshot every Thursday at 12:55 UTC (5 min before halt)
 */
exports.savePreHaltPrices = functions.pubsub
  .schedule('55 12 * * 4')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) {
        console.log('No market data found for pre-halt snapshot');
        return null;
      }

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};

      await db.collection('market').doc('preHaltSnapshot').set({
        prices,
        savedAt: admin.firestore.FieldValue.serverTimestamp()
      });

      console.log(`Pre-halt snapshot saved with ${Object.keys(prices).length} tickers`);
      return null;
    } catch (error) {
      console.error('Error saving pre-halt snapshot:', error);
      return null;
    }
  });

/**
 * Chapter review recap - posts Discord alert every Thursday at 21:05 UTC
 * Compares pre-halt prices to current prices after admin adjustments
 */
exports.chapterReviewRecap = functions.pubsub
  .schedule('30 20 * * 4')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      // Read pre-halt snapshot
      const snapshotRef = db.collection('market').doc('preHaltSnapshot');
      const snapshotSnap = await snapshotRef.get();

      if (!snapshotSnap.exists) {
        console.warn('No pre-halt snapshot found, skipping chapter review recap');
        return null;
      }

      const beforePrices = snapshotSnap.data().prices || {};

      // Read current prices
      const marketSnap = await db.collection('market').doc('current').get();
      if (!marketSnap.exists) {
        console.error('No current market data found');
        return null;
      }

      const afterPrices = marketSnap.data().prices || {};

      // Build ETF ticker set from CHARACTERS
      const etfTickers = new Set(CHARACTERS.filter(c => c.isETF).map(c => c.ticker));

      // Compute changes per ticker (excluding ETFs)
      const gainers = [];
      const losers = [];
      let unchangedCount = 0;

      for (const [ticker, afterPrice] of Object.entries(afterPrices)) {
        if (etfTickers.has(ticker)) continue;
        const beforePrice = beforePrices[ticker];
        if (beforePrice == null) continue;

        const pctChange = beforePrice > 0
          ? ((afterPrice - beforePrice) / beforePrice) * 100
          : 0;

        if (Math.abs(pctChange) < 0.01) {
          unchangedCount++;
        } else if (pctChange > 0) {
          gainers.push({ ticker, before: beforePrice, after: afterPrice, change: pctChange });
        } else {
          losers.push({ ticker, before: beforePrice, after: afterPrice, change: pctChange });
        }
      }

      gainers.sort((a, b) => b.change - a.change);
      losers.sort((a, b) => a.change - b.change);

      // Compute SMI before and after
      const nonETFChars = CHARACTERS.filter(c => !c.isETF);
      const computeSMI = (prices) => {
        let sum = 0;
        let count = 0;
        for (const char of nonETFChars) {
          const base = char.basePrice;
          if (base <= 0) continue;
          const price = prices[char.ticker];
          sum += (price != null ? price : base) / base;
          count++;
        }
        return count > 0 ? 1000 * (sum / count) : 1000;
      };

      const smiBefore = computeSMI(beforePrices);
      const smiAfter = computeSMI(afterPrices);
      const smiChange = smiBefore > 0
        ? ((smiAfter - smiBefore) / smiBefore) * 100
        : 0;

      // Build Discord embed
      const dateStr = new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        year: 'numeric'
      });

      const formatLine = (s) =>
        `**${s.ticker}**  $${s.before.toFixed(2)} → $${s.after.toFixed(2)}  (${s.change > 0 ? '+' : ''}${s.change.toFixed(1)}%)`;

      const fields = [];

      if (gainers.length > 0) {
        fields.push({
          name: '📈 Price Increases',
          value: gainers.slice(0, 10).map(formatLine).join('\n'),
          inline: false
        });
      }

      if (losers.length > 0) {
        fields.push({
          name: '📉 Price Decreases',
          value: losers.slice(0, 10).map(formatLine).join('\n'),
          inline: false
        });
      }

      if (gainers.length === 0 && losers.length === 0) {
        fields.push({
          name: '➖ No Changes',
          value: 'No price adjustments were made this week.',
          inline: false
        });
      } else if (unchangedCount > 0) {
        fields.push({
          name: '➖ Unchanged',
          value: `${unchangedCount} stock${unchangedCount !== 1 ? 's' : ''}`,
          inline: false
        });
      }

      const smiSign = smiChange >= 0 ? '+' : '';
      fields.push({
        name: '📊 Stockism Market Index',
        value: `${Math.round(smiBefore).toLocaleString()} → ${Math.round(smiAfter).toLocaleString()} (${smiSign}${smiChange.toFixed(1)}%)`,
        inline: false
      });

      const embed = {
        title: '📖 Chapter Review Recap',
        description: dateStr,
        color: 0x9B59B6,
        fields,
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);

      // Cleanup snapshot
      await snapshotRef.delete();
      console.log(`Chapter review recap sent: ${gainers.length} gainers, ${losers.length} losers, ${unchangedCount} unchanged`);

      return null;
    } catch (error) {
      console.error('Error in chapterReviewRecap:', error);
      return null;
    }
  });

/**
 * Fill pending stop loss orders at market open after chapter review.
 * Also runs the opening auction for pre-market orders placed during 20:30-21:00 UTC.
 * Runs at exactly 21:00 UTC Thursday — same moment the halt ends.
 */
exports.processMarketOpenOrders = functions.pubsub
  .schedule('0 21 * * 4')
  .timeZone('UTC')
  .onRun(async () => {
    try {
      const marketRef = db.collection('market').doc('current');
      let marketSnap = await marketRef.get();
      if (!marketSnap.exists) return null;

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
          const basePrice = currentPrices[ticker];
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
          let fillShares = order.shares;
          let feedDisplayName = '';
          let feedCrew = null;

          try {
            await db.runTransaction(async (transaction) => {
              const userSnap = await transaction.get(userRef);
              if (!userSnap.exists) throw new Error('User not found');
              const ud = userSnap.data();
              feedDisplayName = ud.displayName || 'Anonymous';
              feedCrew = ud.crew || null;
              if (ud.isBankrupt) throw new Error('User is bankrupt');

              if (order.action === 'buy') {
                const totalCost = executionPrice * fillShares;
                if ((ud.cash || 0) < totalCost) {
                  if (order.allowPartialFills && (ud.cash || 0) >= executionPrice) {
                    fillShares = Math.round(Math.floor((ud.cash || 0) / executionPrice * 100) / 100 * 100) / 100;
                  } else {
                    throw new Error('Insufficient cash');
                  }
                }
                const currentHoldings = ud.holdings?.[order.ticker] || 0;
                const currentCostBasis = ud.costBasis?.[order.ticker] || 0;
                const newHoldings = Math.round((currentHoldings + fillShares) * 10000) / 10000;
                const newCostBasis = currentHoldings > 0
                  ? Math.round(((currentCostBasis * currentHoldings) + (executionPrice * fillShares)) / newHoldings * 100) / 100
                  : executionPrice;
                transaction.update(userRef, {
                  cash: admin.firestore.FieldValue.increment(-executionPrice * fillShares),
                  [`holdings.${order.ticker}`]: newHoldings,
                  [`costBasis.${order.ticker}`]: newCostBasis,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1)
                });
              } else {
                const userShares = ud.holdings?.[order.ticker] || 0;
                if (userShares < fillShares) {
                  if (order.allowPartialFills && userShares > 0) {
                    fillShares = userShares;
                  } else {
                    throw new Error('Insufficient shares');
                  }
                }
                const newHoldings = Math.round((userShares - fillShares) * 10000) / 10000;
                const updates = {
                  cash: admin.firestore.FieldValue.increment(executionPrice * fillShares),
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
            });

            const isPartial = order.allowPartialFills && fillShares < order.shares;
            await doc.ref.update({
              status: isPartial ? 'PARTIALLY_FILLED' : 'FILLED',
              filledShares: fillShares,
              executedPrice: executionPrice,
              executedAt: admin.firestore.FieldValue.serverTimestamp(),
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            writeNotification(order.userId, {
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
            await doc.ref.update({
              status: 'FAILED',
              failReason: err.message,
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            writeNotification(order.userId, {
              type: 'trade',
              title: 'Market Open Order Failed',
              message: `Your ${order.action} of ${order.shares} $${order.ticker} could not be filled: ${err.message}`,
              data: { ticker: order.ticker, orderId: doc.id }
            });
            pmFailed++;
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
            fillShares = order.shares - alreadyFilled;
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
          });

          const newFilledTotal = alreadyFilled + fillShares;
          const isPartial = order.allowPartialFills && newFilledTotal < order.shares;
          await db.collection('limitOrders').doc(orderDoc.id).update({
            status: isPartial ? 'PARTIALLY_FILLED' : 'FILLED',
            filledShares: newFilledTotal,
            executedPrice,
            executedAt: admin.firestore.FieldValue.serverTimestamp(),
            updatedAt: admin.firestore.FieldValue.serverTimestamp()
          });
          writeNotification(order.userId, {
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

/**
 * Manual trigger for daily market summary (admin only)
 */
exports.triggerDailyMarketSummary = functions.https.onCall(async (data, context) => {
  // Admin check
  if (!context.auth || context.auth.uid !== ADMIN_UID) {
    throw new functions.https.HttpsError('permission-denied', 'Admin only');
  }

  try {
    const marketRef = db.collection('market').doc('current');
    const marketSnap = await marketRef.get();

    if (!marketSnap.exists) {
      return { success: false, error: 'No market data found' };
    }

    const marketData = marketSnap.data();
    const prices = marketData.prices || {};
    const priceHistory = marketData.priceHistory || {};

    const usersSnap = await db.collection('users').get();
    const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const gainers = [];
    const losers = [];
    const athStocks = [];

    Object.entries(prices).forEach(([ticker, currentPrice]) => {
      const history = priceHistory[ticker] || [];
      if (history.length === 0) return;

      let price24hAgo = history[0].price;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].timestamp <= dayAgo) {
          price24hAgo = history[i].price;
          break;
        }
      }

      const change = price24hAgo > 0 ? ((currentPrice - price24hAgo) / price24hAgo) * 100 : 0;
      const stock = { ticker, price: currentPrice, change };

      if (change > 0) gainers.push(stock);
      if (change < 0) losers.push(stock);

      const highestHistorical = Math.max(...history.map(h => h.price));
      if (currentPrice >= highestHistorical) {
        athStocks.push(ticker);
      }
    });

    gainers.sort((a, b) => b.change - a.change);
    losers.sort((a, b) => a.change - b.change);

    let totalVolume = 0;
    let tradeCount = 0;
    const traderActivity = {};

    users.forEach(user => {
      const txLog = user.transactionLog || [];
      txLog.forEach(tx => {
        if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.timestamp > dayAgo) {
          totalVolume += tx.totalCost || tx.totalRevenue || 0;
          tradeCount++;
          traderActivity[user.id] = (traderActivity[user.id] || 0) + 1;
        }
      });
    });

    const topTraders = Object.entries(traderActivity)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);

    const embed = {
      title: '📊 Daily Market Summary',
      description: `Market close - ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`,
      color: 0xFF6B35,
      fields: [
        {
          name: '📈 Market Activity',
          value: `${tradeCount} trades • $${totalVolume.toFixed(2)} volume`,
          inline: false
        },
        {
          name: '🔥 Top Gainers (24h)',
          value: gainers.slice(0, 3).map(s =>
            `**${s.ticker}** $${s.price.toFixed(2)} (+${s.change.toFixed(1)}%)`
          ).join('\n') || 'None',
          inline: true
        },
        {
          name: '📉 Top Losers (24h)',
          value: losers.slice(0, 3).map(s =>
            `**${s.ticker}** $${s.price.toFixed(2)} (${s.change.toFixed(1)}%)`
          ).join('\n') || 'None',
          inline: true
        }
      ],
      timestamp: new Date().toISOString()
    };

    if (athStocks.length > 0) {
      embed.fields.push({
        name: '🎯 New All-Time Highs',
        value: athStocks.slice(0, 5).join(', '),
        inline: false
      });
    }

    if (topTraders.length > 0) {
      embed.fields.push({
        name: '⚡ Most Active Traders',
        value: topTraders.map((_, i) => `#${i + 1}: ${topTraders[i][1]} trades`).join('\n'),
        inline: false
      });
    }

    embed.fields.push({
      name: '💰 Market Stats',
      value: `Total Cash: $${users.reduce((sum, u) => sum + (u.cash || 0), 0).toLocaleString()}\nActive Traders: ${users.length}`,
      inline: false
    });

    await sendDiscordMessage(null, [embed]);
    return { success: true };
  } catch (error) {
    console.error('Error in triggerDailyMarketSummary:', error);
    return { success: false, error: error.message };
  }
});

/**
 * Weekly Market Summary - Runs Mondays at 00:00 UTC
 */
exports.weeklyMarketSummary = functions.pubsub
  .schedule('0 0 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) return null;

      const marketData = marketSnap.data();
      const prices = marketData.prices || {};
      const priceHistory = marketData.priceHistory || {};

      // Get all users
      const usersSnap = await db.collection('users').get();
      const users = usersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Calculate weekly stats
      const now = Date.now();
      const weekAgo = now - (7 * 24 * 60 * 60 * 1000);

      // Weekly price changes
      const weeklyChanges = [];
      Object.entries(prices).forEach(([ticker, currentPrice]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return;

        let priceWeekAgo = history[0].price;
        for (let i = history.length - 1; i >= 0; i--) {
          if (history[i].timestamp <= weekAgo) {
            priceWeekAgo = history[i].price;
            break;
          }
        }

        const change = priceWeekAgo > 0 ? ((currentPrice - priceWeekAgo) / priceWeekAgo) * 100 : 0;
        weeklyChanges.push({ ticker, price: currentPrice, change, priceWeekAgo });
      });

      weeklyChanges.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
      const topGainer = weeklyChanges.find(s => s.change > 0);
      const topLoser = weeklyChanges.find(s => s.change < 0);

      // Weekly volume
      let weeklyVolume = 0;
      let weeklyTrades = 0;
      users.forEach(user => {
        const txLog = user.transactionLog || [];
        txLog.forEach(tx => {
          if ((tx.type === 'BUY' || tx.type === 'SELL') && tx.timestamp > weekAgo) {
            weeklyVolume += tx.totalCost || tx.totalRevenue || 0;
            weeklyTrades++;
          }
        });
      });

      // Top portfolios
      const topPortfolios = users
        .filter(u => u.portfolioValue > 0)
        .sort((a, b) => b.portfolioValue - a.portfolioValue)
        .slice(0, 5);

      // Build comprehensive embed
      const embed = {
        title: '📈 Weekly Market Report',
        description: `Week ending ${new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`,
        color: 0x4ECDC4,
        fields: [
          {
            name: '📊 Weekly Activity',
            value: `${weeklyTrades} trades\n$${weeklyVolume.toLocaleString(undefined, {maximumFractionDigits: 0})} total volume\n${users.length} active traders`,
            inline: false
          },
          {
            name: '🚀 Biggest Mover (Up)',
            value: topGainer ? `**${topGainer.ticker}**\n$${topGainer.priceWeekAgo.toFixed(2)} → $${topGainer.price.toFixed(2)}\n+${topGainer.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '📉 Biggest Mover (Down)',
            value: topLoser ? `**${topLoser.ticker}**\n$${topLoser.priceWeekAgo.toFixed(2)} → $${topLoser.price.toFixed(2)}\n${topLoser.change.toFixed(1)}%` : 'None',
            inline: true
          },
          {
            name: '🏆 Top 5 Portfolios',
            value: topPortfolios.map((u, i) =>
              `${i + 1}. ${u.displayName || 'Anonymous'} - $${u.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 0})}`
            ).join('\n') || 'None',
            inline: false
          }
        ],
        footer: {
          text: 'Next report: Next Sunday 7 PM EST'
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      return null;
    } catch (error) {
      console.error('Error in weeklyMarketSummary:', error);
      return null;
    }
  });

/**
 * Weekly Leaderboard - Runs Mondays at 01:00 UTC
 */
exports.weeklyLeaderboard = functions.pubsub
  .schedule('0 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // Calculate portfolio values and sort
      const traders = [];
      usersSnapshot.forEach(doc => {
        const user = doc.data();
        if (!user.isBankrupt) {
          traders.push({
            username: user.displayName,
            portfolioValue: user.portfolioValue || user.cash || 0
          });
        }
      });

      traders.sort((a, b) => b.portfolioValue - a.portfolioValue);
      const top5 = traders.slice(0, 5);

      const leaderboardText = top5.map((trader, idx) => {
        const medal = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'][idx];
        return `${medal} **${trader.username}** - $${trader.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`;
      }).join('\n');

      const embed = {
        color: 0xFFD700, // Gold
        title: '🏆 Weekly Leaderboard',
        description: leaderboardText,
        footer: {
          text: `Total Active Traders: ${traders.length}`
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      console.log('Weekly leaderboard sent');
      return null;
    } catch (error) {
      console.error('Error in weekly leaderboard:', error);
      return null;
    }
  });

/**
 * Weekly Crew Rankings - Runs Mondays at 01:30 UTC
 */
exports.weeklyCrewRankings = functions.pubsub
  .schedule('30 1 * * 1')
  .timeZone('UTC')
  .onRun(async (context) => {
    try {
      const usersSnapshot = await db.collection('users').get();

      if (usersSnapshot.empty) {
        console.log('No users found');
        return null;
      }

      // Crew data structure
      const crews = {
        'ALLIED': { name: 'Allied', emblem: '🏛️', members: [], totalCash: 0, weeklyGain: 0 },
        'BIG_DEAL': { name: 'Big Deal', emblem: '🤝', members: [], totalCash: 0, weeklyGain: 0 },
        'FIST_GANG': { name: 'Fist Gang', emblem: '👊', members: [], totalCash: 0, weeklyGain: 0 },
        'GOD_DOG': { name: 'God Dog', emblem: '🐕', members: [], totalCash: 0, weeklyGain: 0 },
        'SECRET_FRIENDS': { name: 'Secret Friends', emblem: '🤫', members: [], totalCash: 0, weeklyGain: 0 },
        'HOSTEL': { name: 'Hostel', emblem: '🏠', members: [], totalCash: 0, weeklyGain: 0 },
        'WTJC': { name: 'White Tiger Job Center', emblem: '🐯', members: [], totalCash: 0, weeklyGain: 0 },
        'WORKERS': { name: 'Workers', emblem: '⚒️', members: [], totalCash: 0, weeklyGain: 0 },
        'YAMAZAKI': { name: 'Yamazaki Syndicate', emblem: '⛩️', members: [], totalCash: 0, weeklyGain: 0 }
      };

      // Get week-old data for comparison
      const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

      usersSnapshot.forEach(doc => {
        const user = doc.data();
        const crew = user.crew;

        if (crew && crews[crew]) {
          const portfolioValue = user.portfolioValue || user.cash || 0;

          crews[crew].members.push({
            username: user.displayName,
            portfolioValue: portfolioValue
          });
          crews[crew].totalCash += portfolioValue;

          // Calculate weekly gain from portfolio history
          if (user.portfolioHistory && Array.isArray(user.portfolioHistory)) {
            const weekOldEntry = user.portfolioHistory.find(h => h.timestamp >= oneWeekAgo);
            if (weekOldEntry) {
              const weeklyGain = portfolioValue - weekOldEntry.value;
              crews[crew].weeklyGain += weeklyGain;
            }
          }
        }
      });

      // Sort crews by total cash
      const sortedCrews = Object.values(crews)
        .filter(crew => crew.members.length > 0)
        .sort((a, b) => b.totalCash - a.totalCash);

      // Build embed fields
      const fields = sortedCrews.map((crew, idx) => {
        // Sort members by portfolio value
        crew.members.sort((a, b) => b.portfolioValue - a.portfolioValue);
        const top5Members = crew.members.slice(0, 5);

        // Calculate average
        const avgCash = crew.members.length > 0 ? crew.totalCash / crew.members.length : 0;

        // Top 50 total (or all if less than 50)
        const top50 = crew.members.slice(0, 50);
        const top50Total = top50.reduce((sum, m) => sum + m.portfolioValue, 0);
        const consolidatedNote = crew.members.length <= 50 ? ' (same as total)' : '';

        // Build top 5 list
        let top5Text = top5Members.map((m, i) =>
          `${i + 1}. ${m.username} - $${m.portfolioValue.toLocaleString(undefined, {maximumFractionDigits: 2})}`
        ).join('\n');

        // Add blank spaces if less than 5 members
        if (top5Members.length < 5) {
          for (let i = top5Members.length; i < 5; i++) {
            top5Text += `\n${i + 1}. `;
          }
        }

        const weeklyGainText = crew.weeklyGain >= 0
          ? `+$${crew.weeklyGain.toLocaleString(undefined, {maximumFractionDigits: 2})}`
          : `-$${Math.abs(crew.weeklyGain).toLocaleString(undefined, {maximumFractionDigits: 2})}`;

        return {
          name: `${idx + 1}. ${crew.emblem} ${crew.name}`,
          value: `**Members:** ${crew.members.length}\n` +
                 `**Total Cash:** $${crew.totalCash.toLocaleString(undefined, {maximumFractionDigits: 2})}\n` +
                 `**Top 50 Total:** $${top50Total.toLocaleString(undefined, {maximumFractionDigits: 2})}${consolidatedNote}\n` +
                 `**Average:** $${avgCash.toLocaleString(undefined, {maximumFractionDigits: 2})}\n` +
                 `**Weekly Gain:** ${weeklyGainText}\n\n` +
                 `**Top 5:**\n${top5Text}`,
          inline: false
        };
      });

      const embed = {
        color: 0x5865F2, // Discord blurple
        title: '⚔️ Weekly Crew Rankings',
        description: '*Crews ranked by total cash among all members*',
        fields: fields,
        footer: {
          text: 'Note: Some crews have fewer than 5 members as the game is still early. Rankings will balance out as more players join.'
        },
        timestamp: new Date().toISOString()
      };

      await sendDiscordMessage(null, [embed]);
      console.log('Weekly crew rankings sent');
      return null;
    } catch (error) {
      console.error('Error in weekly crew rankings:', error);
      return null;
    }
  });


/**
 * Create bot traders - Admin only
 */
