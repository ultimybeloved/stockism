'use strict';
// Limit-order matching engine. INTERNAL MODULE — not exported through
// functions/index.js, same pattern as tradeGuards/tradeActions.
//
// runLimitOrderCheck() is the whole order book sweep: it walks open orders, fills
// the ones whose trigger price has been crossed, moves the market price, and
// credits mission/stat progress for each fill. limitOrders.js owns the callable
// and the schedule that drive it; this file is just the engine, split out when
// limitOrders.js passed the 600-line limit.
//
// npm run test:limitorders covers this — run it before and after any change.

const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS, CHARACTER_MAP, exitLoyaltyDiscount } = require('../characters');
const { BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, isWeeklyTradingHalt, NINETY_DAYS_MS, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS, MAX_DAILY_IMPACT } = require('../constants');
const { calculateMarginalImpact, getAccountAgeImpactFactor, pruneAndSumTradeHistory, writeNotification, writeFeedEntry, lockedShares, appendPriceHistory, buildTradeCreditUpdates, recordTrade } = require('../helpers');
const { updateCrewMissionProgress } = require('./crewMissionProgress');

/**
 * Check and Execute Limit Orders
 * Runs every 2 minutes to check if any pending limit orders should execute
 */
const runLimitOrderCheck = async () => {
    try {
      console.log('Checking limit orders...');
      const startTime = Date.now();

      // Get current market prices
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return { success: false, error: 'Market data missing' };
      }

      const marketData = marketSnap.data();

      // Also skip if admin emergency halt is active
      if (marketData.marketHalted) {
        console.log('Skipping limit order check — emergency halt active');
        return { success: true, skipped: true, reason: 'emergency_halt' };
      }

      const prices = marketData.prices || {};
      const haltedTickersMap = marketData.haltedTickers || {};
      const launchedTickers = marketData.launchedTickers || [];

      // Get all pending limit orders
      const ordersSnapshot = await db.collection('limitOrders')
        .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
        .get();

      console.log(`Found ${ordersSnapshot.size} pending limit orders`);

      let executed = 0;
      let canceled = 0;
      let expired = 0;
      const now = Date.now();

      // Per-ticker execution cap: max 3 orders per ticker per cycle
      const ORDERS_PER_TICKER_PER_CYCLE = 3;
      const tickerExecutionCount = {};

      for (const orderDoc of ordersSnapshot.docs) {
        try {
          const order = orderDoc.data();
          const orderId = orderDoc.id;

          // Auto-cancel unsupported SHORT/COVER orders
          if (order.type === 'SHORT' || order.type === 'COVER') {
            await db.collection('limitOrders').doc(orderId).update({
              status: 'CANCELED',
              cancelReason: 'SHORT/COVER limit orders not supported',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            canceled++;
            continue;
          }

          // Auto-cancel orders on tickers still in IPO phase (would bypass IPO limits)
          if (CHARACTER_MAP[order.ticker]?.ipoRequired && !launchedTickers.includes(order.ticker)) {
            await db.collection('limitOrders').doc(orderId).update({
              status: 'CANCELED',
              cancelReason: 'Stock is still in IPO phase',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            canceled++;
            continue;
          }

          // Check expiration (30 days)
          if (order.expiresAt && now > order.expiresAt) {
            await db.collection('limitOrders').doc(orderId).update({
              status: 'EXPIRED',
              updatedAt: admin.firestore.FieldValue.serverTimestamp()
            });
            console.log(`Expired order ${orderId}`);
            expired++;
            continue;
          }

          // Cancel orders for bankrupt/indebted users
          const orderUserDoc = await db.collection('users').doc(order.userId).get();
          if (orderUserDoc.exists) {
            const orderUserData = orderUserDoc.data();
            // Banned after the order was placed. createLimitOrder blocks banned
            // users from placing NEW orders, but orders already on the book kept
            // filling — a ban left the queued lane open. The pre-market auction
            // has always checked this (marketOrders.js); this lane did not.
            if (orderUserData.isBanned) {
              await db.collection('limitOrders').doc(orderId).update({
                status: 'CANCELED',
                cancelReason: 'Account is banned',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              console.log(`Cancelled order ${orderId}: account banned`);
              canceled++;
              continue;
            }
            if (orderUserData.isBankrupt || (orderUserData.cash || 0) < 0) {
              await db.collection('limitOrders').doc(orderId).update({
                status: 'CANCELED',
                cancelReason: 'User bankrupt or in debt',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              console.log(`Cancelled order ${orderId}: user bankrupt/in debt`);
              canceled++;
              continue;
            }
            // Suspected-alt wall (user may have been flagged after placing the order)
            if (orderUserData.requiresDiscordLink && !orderUserData.discordId) {
              await db.collection('limitOrders').doc(orderId).update({
                status: 'CANCELED',
                cancelReason: 'Discord verification required',
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              console.log(`Cancelled order ${orderId}: Discord verification required`);
              canceled++;
              continue;
            }
          }

          const currentPrice = prices[order.ticker];
          if (!currentPrice) {
            console.log(`No price data for ${order.ticker}, skipping order ${orderId}`);
            continue;
          }

          // Skip halted tickers (circuit breaker)
          const tickerHalt = haltedTickersMap[order.ticker];
          if (tickerHalt && tickerHalt.resumeAt && Date.now() < tickerHalt.resumeAt) {
            continue;
          }

          // Check if order should execute
          let shouldExecute = false;
          if (order.type === 'BUY' && currentPrice <= order.limitPrice) {
            shouldExecute = true;
          } else if (order.type === 'SELL' && currentPrice >= order.limitPrice) {
            shouldExecute = true;
          } else if (order.type === 'STOP_LOSS' && currentPrice <= order.limitPrice) {
            shouldExecute = true;
          }

          if (!shouldExecute) {
            continue;
          }

          // Per-ticker throttle: max 3 orders per ticker per cycle
          const tickerCount = tickerExecutionCount[order.ticker] || 0;
          if (tickerCount >= ORDERS_PER_TICKER_PER_CYCLE) {
            console.log(`Throttled order ${orderId}: ${order.ticker} already had ${tickerCount} executions this cycle`);
            continue; // Will be picked up in the next 2-minute cycle
          }

          console.log(`Order ${orderId} should execute: ${order.type} ${order.shares} ${order.ticker} @ $${order.limitPrice} (current: $${currentPrice})`);

          // Execute trade in transaction to prevent race conditions
          const userRef = db.collection('users').doc(order.userId);
          const totalShares = order.shares;
          const alreadyFilled = order.filledShares || 0;
          const remainingShares = totalShares - alreadyFilled;
          let fillShares = remainingShares;
          let executedPrice = 0;
          let tradeValue = 0;
          let feedDisplayName = '';
          let feedCrew = null;

          try {
            await db.runTransaction(async (transaction) => {
              executedPrice = 0;
              const orderRef = db.collection('limitOrders').doc(orderId);
              const freshOrderSnap = await transaction.get(orderRef);
              const userSnap = await transaction.get(userRef);
              const freshMarketSnap = await transaction.get(marketRef);

              // Re-read the order inside the transaction: the client cancels by
              // writing the doc directly, and a blind FILLED write here would
              // otherwise overwrite that cancel (or double-fill on overlapping
              // runs) and execute a trade the user no longer wants.
              if (!freshOrderSnap.exists) {
                throw new Error('Order no longer exists');
              }
              const freshOrder = freshOrderSnap.data();
              if (!['PENDING', 'PARTIALLY_FILLED'].includes(freshOrder.status)) {
                throw new Error('Order no longer active');
              }
              const freshFilled = freshOrder.filledShares || 0;
              fillShares = totalShares - freshFilled;  // Reset on every retry
              if (fillShares <= 0) {
                throw new Error('Order no longer active');
              }

              if (!userSnap.exists) {
                throw new Error('User not found');
              }
              if (!freshMarketSnap.exists) {
                throw new Error('Market data not found');
              }

              const userData = userSnap.data();
              feedDisplayName = userData.displayName || 'Anonymous';
              feedCrew = userData.crew || null;
              const freshPrices = freshMarketSnap.data().prices || {};
              const freshPrice = freshPrices[order.ticker] || currentPrice;

              // Re-validate limit condition with fresh price
              if (order.type === 'BUY' && freshPrice > order.limitPrice) {
                throw new Error('Price no longer meets limit condition');
              }
              if (order.type === 'SELL' && freshPrice < order.limitPrice) {
                throw new Error('Price no longer meets limit condition');
              }
              if (order.type === 'STOP_LOSS' && freshPrice > order.limitPrice) {
                throw new Error('Price no longer meets limit condition');
              }

              // Banned (could have happened between the outer check and here)
              if (userData.isBanned) {
                throw new Error('Account is banned');
              }
              // Check if user is bankrupt/in debt (could have changed since order was created)
              if (userData.isBankrupt || (userData.cash || 0) < 0) {
                throw new Error('User is bankrupt or in debt');
              }
              // Suspected-alt wall (could have been flagged since order was created)
              if (userData.requiresDiscordLink && !userData.discordId) {
                throw new Error('Discord verification required');
              }

              // STOP_LOSS executes as a sell — normalize for validation/execution
              const effectiveType = order.type === 'STOP_LOSS' ? 'SELL' : order.type;
              // Tags the trade record so the player can see why it happened
              const fillSource = order.type === 'STOP_LOSS' ? 'stop_loss' : 'limit';

              // Validate user has sufficient funds/shares
              if (effectiveType === 'BUY') {
                const totalCost = freshPrice * fillShares;
                if (userData.cash < totalCost) {
                  if (order.allowPartialFills) {
                    const affordableShares = freshPrice > 0 ? Math.floor(userData.cash / freshPrice) : 0;
                    if (affordableShares > 0) {
                      fillShares = affordableShares;
                      console.log(`Partial fill: can only afford ${affordableShares} shares`);
                    } else {
                      throw new Error('Insufficient cash');
                    }
                  } else {
                    throw new Error('Insufficient cash');
                  }
                }
              } else if (effectiveType === 'SELL') {
                // Locks are re-checked at fill time, not just at creation: shares
                // locked AFTER the order was placed (e.g. a margin buy on the same
                // ticker) must not be sellable through a fill or partial clamp.
                const userShares = userData.holdings?.[order.ticker] || 0;
                const lockedNow = lockedShares(userData, order.ticker).total;
                const sellableShares = Math.max(0, Math.round((userShares - lockedNow) * 10000) / 10000);
                if (sellableShares < fillShares) {
                  if (order.allowPartialFills && sellableShares > 0) {
                    fillShares = sellableShares;
                    console.log(`Partial fill: only ${sellableShares} sellable shares (${lockedNow} locked)`);
                  } else if (userShares >= fillShares) {
                    // Enough shares, but some are locked — defer, don't cancel;
                    // locks expire well within the order's 30-day lifetime.
                    throw new Error('Shares locked (IPO or margin hold)');
                  } else {
                    throw new Error('Insufficient shares');
                  }
                }
              }

              // Calculate marginal price impact using cumulative volume from tickerTradeHistory
              const limitAction = effectiveType.toLowerCase(); // 'buy' or 'sell'
              const limitTradeHistory = userData.tickerTradeHistory || {};
              const limitActionHistory = limitTradeHistory[order.ticker]?.[limitAction] || [];
              const { totalShares: limitCumVolume, count: limitTradeCount } = pruneAndSumTradeHistory(limitActionHistory, now);

              // Enforce 10-trade limit per action per ticker
              if (limitTradeCount >= MAX_TRADES_PER_TICKER_24H) {
                throw new Error(`Trade limit reached: ${MAX_TRADES_PER_TICKER_24H} ${limitAction}s on ${order.ticker} in 24h`);
              }

              // Daily 10% impact cap (same rule as executeTrade): the fill still
              // executes, but stops moving the price once the user's daily impact
              // allowance on this ticker is used up. New accounts move less.
              let limitDailyImpact = 0;
              for (const act of ['buy', 'sell', 'short', 'cover']) {
                const { totalImpact } = pruneAndSumTradeHistory(limitTradeHistory[order.ticker]?.[act] || [], now);
                limitDailyImpact += totalImpact;
              }
              const remainingLimitImpact = Math.max(0, MAX_DAILY_IMPACT - limitDailyImpact);
              const effectiveImpact = Math.min(
                calculateMarginalImpact(freshPrice, fillShares, limitCumVolume) * getAccountAgeImpactFactor(userData),
                freshPrice * remainingLimitImpact
              );
              const limitImpactPercent = freshPrice > 0 ? effectiveImpact / freshPrice : 0;

              // Execute the trade
              const orderChar = CHARACTERS.find(c => c.ticker === order.ticker);
              const limitSpread = orderChar?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD;

              // Build trade history entry for this limit order fill
              const limitTradeEntry = { ts: now, shares: fillShares, impact: limitImpactPercent };

              if (effectiveType === 'BUY') {
                // Price goes UP on buy
                const newMarketPrice = Math.round((freshPrice + effectiveImpact) * 100) / 100;
                const askPrice = newMarketPrice * (1 + limitSpread / 2);
                executedPrice = Math.round(askPrice * 100) / 100;

                // Limit semantics: never fill above the user's limit price.
                // The trigger checks the mid price, but execution pays the ask
                // after impact — defer until the ask itself is within the limit.
                if (executedPrice > order.limitPrice) {
                  throw new Error('Ask price exceeds limit after impact and spread');
                }

                const totalCost = askPrice * fillShares;

                // Re-validate with actual cost
                if (userData.cash < totalCost) {
                  throw new Error('Insufficient cash after price impact');
                }

                const currentHoldings = userData.holdings?.[order.ticker] || 0;
                const currentCostBasis = userData.costBasis?.[order.ticker] || 0;
                const newHoldings = currentHoldings + fillShares;
                const newCostBasis = currentHoldings > 0
                  ? (newHoldings > 0 ? ((currentCostBasis * currentHoldings) + (askPrice * fillShares)) / newHoldings : askPrice)
                  : askPrice;

                // Build updated tickerTradeHistory with new entry appended
                const updatedLimitHistory = JSON.parse(JSON.stringify(limitTradeHistory));
                if (!updatedLimitHistory[order.ticker]) updatedLimitHistory[order.ticker] = {};
                if (!updatedLimitHistory[order.ticker][limitAction]) updatedLimitHistory[order.ticker][limitAction] = [];
                // Prune old entries
                const cutoff = now - TWENTY_FOUR_HOURS_MS;
                updatedLimitHistory[order.ticker][limitAction] = updatedLimitHistory[order.ticker][limitAction].filter(e => e.ts > cutoff);
                updatedLimitHistory[order.ticker][limitAction].push(limitTradeEntry);

                // Mission/stat credit — same fields executeTrade writes, so
                // limit fills count toward missions like regular trades.
                const { updates: creditUpdates } = buildTradeCreditUpdates({
                  userData, ticker: order.ticker, action: 'buy', shares: fillShares,
                  totalValue: totalCost, executionPrice: executedPrice, marketPrice: freshPrice, now
                });
                tradeValue = totalCost;

                transaction.update(userRef, {
                  cash: admin.firestore.FieldValue.increment(-totalCost),
                  [`holdings.${order.ticker}`]: newHoldings,
                  [`costBasis.${order.ticker}`]: Math.round(newCostBasis * 100) / 100,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  tickerTradeHistory: updatedLimitHistory,
                  ...creditUpdates
                });

                // Same trade record executeTrade writes, so the fill shows up in
                // the player's trade history and the market reports.
                recordTrade(transaction, {
                  uid: order.userId,
                  ticker: order.ticker,
                  action: 'buy',
                  amount: fillShares,
                  price: executedPrice,
                  priceImpact: limitImpactPercent,
                  totalValue: totalCost,
                  cashBefore: userData.cash,
                  cashAfter: Math.round((userData.cash - totalCost) * 100) / 100,
                  source: fillSource,
                  orderId,
                });

                // Apply price impact to market (only if there's actual impact)
                if (effectiveImpact > 0) {
                  transaction.update(marketRef, {
                    [`prices.${order.ticker}`]: newMarketPrice
                  });
                  appendPriceHistory(transaction, {
                    [order.ticker]: { timestamp: Date.now(), price: newMarketPrice }
                  });
                }

                console.log(`Executed BUY: ${fillShares} ${order.ticker} @ $${askPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              } else if (effectiveType === 'SELL') {
                // Price goes DOWN on sell — the market takes the full impact
                const newMarketPrice = Math.max(0.01, Math.round((freshPrice - effectiveImpact) * 100) / 100);

                // Exit loyalty, same rule as tradeActions.computeSell: a long-held
                // position is priced against a reduced impact. The limit check below
                // uses this price because it's what the seller actually receives.
                const limitLoyalty = exitLoyaltyDiscount(userData.holdingCohorts?.[order.ticker], fillShares, now);
                const sellerMid = Math.max(0.01, Math.round((freshPrice - effectiveImpact * (1 - limitLoyalty)) * 100) / 100);
                const bidPrice = sellerMid * (1 - limitSpread / 2);
                executedPrice = Math.round(bidPrice * 100) / 100;

                // Limit semantics for SELL only: never fill below the user's
                // limit price. Stop losses are exempt — they sell on the way
                // down by design.
                if (order.type === 'SELL' && executedPrice < order.limitPrice) {
                  throw new Error('Bid price below limit after impact and spread');
                }

                const totalRevenue = bidPrice * fillShares;

                const currentHoldings = userData.holdings?.[order.ticker] || 0;
                const newHoldings = currentHoldings - fillShares;

                // Build updated tickerTradeHistory with new entry appended
                const updatedLimitHistory = JSON.parse(JSON.stringify(limitTradeHistory));
                if (!updatedLimitHistory[order.ticker]) updatedLimitHistory[order.ticker] = {};
                if (!updatedLimitHistory[order.ticker][limitAction]) updatedLimitHistory[order.ticker][limitAction] = [];
                const cutoff = now - TWENTY_FOUR_HOURS_MS;
                updatedLimitHistory[order.ticker][limitAction] = updatedLimitHistory[order.ticker][limitAction].filter(e => e.ts > cutoff);
                updatedLimitHistory[order.ticker][limitAction].push(limitTradeEntry);

                // Mission/stat credit — same fields executeTrade writes, so
                // limit fills count toward missions like regular trades.
                const { updates: creditUpdates } = buildTradeCreditUpdates({
                  userData, ticker: order.ticker, action: 'sell', shares: fillShares,
                  totalValue: totalRevenue, executionPrice: executedPrice, marketPrice: freshPrice, now
                });
                tradeValue = totalRevenue;

                const updates = {
                  cash: admin.firestore.FieldValue.increment(totalRevenue),
                  [`holdings.${order.ticker}`]: newHoldings,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  tickerTradeHistory: updatedLimitHistory,
                  ...creditUpdates
                };

                if (newHoldings <= 0) {
                  updates[`holdings.${order.ticker}`] = admin.firestore.FieldValue.delete();
                  updates[`costBasis.${order.ticker}`] = admin.firestore.FieldValue.delete();
                  updates[`lowestWhileHolding.${order.ticker}`] = admin.firestore.FieldValue.delete();
                }

                transaction.update(userRef, updates);

                // Same trade record executeTrade writes, so the fill shows up in
                // the player's trade history and the market reports.
                recordTrade(transaction, {
                  uid: order.userId,
                  ticker: order.ticker,
                  action: 'sell',
                  amount: fillShares,
                  price: executedPrice,
                  priceImpact: limitImpactPercent,
                  totalValue: totalRevenue,
                  cashBefore: userData.cash,
                  cashAfter: Math.round((userData.cash + totalRevenue) * 100) / 100,
                  source: fillSource,
                  orderId,
                });

                // Apply price impact to market (only if there's actual impact)
                if (effectiveImpact > 0) {
                  transaction.update(marketRef, {
                    [`prices.${order.ticker}`]: newMarketPrice
                  });
                  appendPriceHistory(transaction, {
                    [order.ticker]: { timestamp: Date.now(), price: newMarketPrice }
                  });
                }

                console.log(`Executed ${order.type}: ${fillShares} ${order.ticker} @ $${bidPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              }

              // Mark the order filled inside the same transaction as the balance
              // change, so a crash here can't leave it PENDING and double-fill it
              // on the next 2-minute cycle.
              const newFilledTotal = freshFilled + fillShares;
              const isPartialFill = order.allowPartialFills && newFilledTotal < totalShares;
              transaction.update(orderRef, {
                status: isPartialFill ? 'PARTIALLY_FILLED' : 'FILLED',
                filledShares: newFilledTotal,
                executedPrice: executedPrice,
                executedAt: admin.firestore.FieldValue.serverTimestamp(),
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
            });
          } catch (transactionError) {
            const msg = transactionError.message || '';
            const shouldCancel = [
              'User not found',
              'User is bankrupt',
              'Insufficient cash',
              'Insufficient shares',
              'Trade limit reached'
            ].some(reason => msg.includes(reason));

            if (shouldCancel) {
              console.log(`Canceling order ${orderId}: ${msg}`);
              await db.collection('limitOrders').doc(orderId).update({
                status: 'CANCELED',
                cancelReason: msg,
                updatedAt: admin.firestore.FieldValue.serverTimestamp()
              });
              // Tell the user — a silently vanished stop loss leaves them
              // thinking they're still protected.
              const canceledLabel = order.type === 'STOP_LOSS' ? 'Stop Loss' : `${order.type} Limit Order`;
              await writeNotification(order.userId, {
                type: 'trade',
                title: `${canceledLabel} Canceled`,
                message: `Your ${canceledLabel.toLowerCase()} for ${order.shares} $${order.ticker} was canceled: ${msg}`,
                data: { ticker: order.ticker, orderId }
              });
              canceled++;
            } else {
              console.log(`Order ${orderId} deferred (will retry): ${msg}`);
            }
            continue;
          }

          // Track per-ticker execution count for throttling
          tickerExecutionCount[order.ticker] = (tickerExecutionCount[order.ticker] || 0) + 1;

          // Notify user that their limit order filled
          const effectiveType2 = order.type === 'STOP_LOSS' ? 'Stop loss' : `${order.type} limit order`;
          await writeNotification(order.userId, {
            type: 'trade',
            title: `${effectiveType2} Filled`,
            message: `Your ${effectiveType2.toLowerCase()} for ${fillShares} $${order.ticker} executed at $${executedPrice.toFixed(2)}`,
            data: { ticker: order.ticker, orderId, price: executedPrice }
          });

          const feedAction = order.type === 'BUY' ? 'buy' : order.type === 'COVER' ? 'cover' : 'sell';

          // Crew mission progress (fire-and-forget, same as executeTrade)
          if (feedCrew && (feedAction === 'buy' || feedAction === 'sell')) {
            updateCrewMissionProgress(feedCrew, order.userId, feedAction, fillShares, order.ticker, tradeValue);
          }

          const feedMsg = order.type === 'STOP_LOSS'
            ? `sold ${fillShares} $${order.ticker} via stop loss`
            : order.type === 'BUY'
              ? `bought ${fillShares} $${order.ticker} via limit order`
              : order.type === 'COVER'
                ? `covered ${fillShares} $${order.ticker} via limit order`
                : `sold ${fillShares} $${order.ticker} via limit order`;
          writeFeedEntry({
            type: 'trade',
            userId: order.userId,
            displayName: feedDisplayName,
            crew: feedCrew,
            ticker: order.ticker,
            action: feedAction,
            amount: fillShares,
            price: executedPrice,
            message: feedMsg
          });

          executed++;

        } catch (error) {
          console.error(`Error processing order ${orderDoc.id}:`, error);
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      const result = {
        success: true,
        totalOrders: ordersSnapshot.size,
        executed,
        canceled,
        expired,
        elapsedSeconds: elapsed
      };

      console.log('Limit order check complete:', result);
      return result;

    } catch (error) {
      console.error('Limit order check failed:', error);
      return { success: false, error: error.message };
    }
};

module.exports = { runLimitOrderCheck };
