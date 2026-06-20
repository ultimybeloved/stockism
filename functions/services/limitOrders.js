'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();

const { CHARACTERS, CHARACTER_MAP } = require('../characters');
const { BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, isWeeklyTradingHalt, NINETY_DAYS_MS, MAX_TRADES_PER_TICKER_24H, TWENTY_FOUR_HOURS_MS, MAX_DAILY_IMPACT } = require('../constants');
const { calculateMarginalImpact, getAccountAgeImpactFactor, pruneAndSumTradeHistory, writeNotification, writeFeedEntry, touchLastActive } = require('../helpers');

exports.createLimitOrder = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Block during weekly halt
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'Market closed for chapter review. Trading resumes at 21:00 UTC.'
    );
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { ticker, type, shares, limitPrice, allowPartialFills } = data;

  // Validate ticker against character whitelist
  if (!ticker || !CHARACTERS.some(c => c.ticker === ticker)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }

  // Validate order type (BUY/SELL/STOP_LOSS supported — SHORT/COVER can't execute in checkLimitOrders)
  if (!type || !['BUY', 'SELL', 'STOP_LOSS'].includes(type)) {
    throw new functions.https.HttpsError('invalid-argument', 'Limit orders support BUY, SELL, and STOP_LOSS only.');
  }

  // Validate shares (finite, positive, max 2 decimal places, max 10000)
  if (!shares || !Number.isFinite(shares) || shares < 0.01 || shares > 10000 || Math.round(shares * 100) / 100 !== shares) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid share quantity.');
  }

  // Validate limit price (must be finite positive number, max 10000)
  if (!limitPrice || !Number.isFinite(limitPrice) || limitPrice <= 0 || limitPrice > 10000) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid limit price.');
  }

  const userRef = db.collection('users').doc(uid);
  const userDoc = await userRef.get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found.');
  }

  const userData = userDoc.data();

  // Check if user is banned
  if (userData.isBanned) {
    throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
  }

  // Check if user is bankrupt or in debt
  if (userData.isBankrupt) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot create orders while bankrupt.');
  }
  if ((userData.cash || 0) < 0) {
    throw new functions.https.HttpsError('failed-precondition', 'Cannot create orders while in debt.');
  }

  // Block orders on IPO-phase tickers that haven't launched — queued orders
  // would otherwise bypass the IPO's per-user and supply limits entirely.
  if (CHARACTER_MAP[ticker]?.ipoRequired) {
    const marketSnap = await db.collection('market').doc('current').get();
    const launchedTickers = marketSnap.data()?.launchedTickers || [];
    if (!launchedTickers.includes(ticker)) {
      throw new functions.https.HttpsError(
        'failed-precondition',
        `${ticker} is in IPO phase. Use the IPO panel to purchase shares.`
      );
    }
  }

  // Fetch active orders early (needed for validation checks below).
  // PARTIALLY_FILLED orders are still live, so they count toward the cap,
  // reserved shares, and the duplicate check just like PENDING ones.
  const pendingOrders = await db.collection('limitOrders')
    .where('userId', '==', uid)
    .where('status', 'in', ['PENDING', 'PARTIALLY_FILLED'])
    .get();

  if (pendingOrders.size >= 20) {
    throw new functions.https.HttpsError('resource-exhausted', 'Maximum 20 pending orders allowed.');
  }

  // Validate holdings for SELL/STOP_LOSS orders (account for shares reserved by pending sells/stop losses)
  if (type === 'SELL' || type === 'STOP_LOSS') {
    const currentHoldings = userData.holdings?.[ticker] || 0;
    if (currentHoldings < shares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient holdings to sell.');
    }
    const pendingSellShares = pendingOrders.docs
      .filter(doc => {
        const o = doc.data();
        return o.ticker === ticker && (o.type === 'SELL' || o.type === 'STOP_LOSS');
      })
      .reduce((sum, doc) => {
        const o = doc.data();
        return sum + (o.shares - (o.filledShares || 0)); // only the unfilled remainder is still reserved
      }, 0);
    if (currentHoldings < shares + pendingSellShares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient holdings (some shares reserved by pending orders).');
    }

    // IPO lockup: can't queue a sell / stop-loss against still-locked IPO shares
    // (otherwise a queued order would dodge the lockup and flip the launch pop).
    const ipoLock = userData.ipoLockup?.[ticker];
    if (ipoLock && Date.now() < (ipoLock.until || 0)) {
      const freeShares = Math.max(0, currentHoldings - (ipoLock.shares || 0));
      if (shares > freeShares) {
        const unlockDate = new Date(ipoLock.until).toISOString().split('T')[0];
        throw new functions.https.HttpsError('failed-precondition',
          `${ipoLock.shares} of your $${ticker} shares are IPO-locked until ${unlockDate}. You can place a sell for up to ${freeShares} now.`);
      }
    }
  }

  // Validate short positions for COVER orders
  if (type === 'COVER') {
    const shortShares = userData.shorts?.[ticker]?.shares || 0;
    if (shortShares < shares) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient short shares to cover.');
    }
  }

  // Anti-manipulation: Block SELL/STOP_LOSS if user has an active short on same ticker
  if (type === 'SELL' || type === 'STOP_LOSS') {
    const shortShares = userData.shorts?.[ticker]?.shares || 0;
    if (shortShares > 0) {
      throw new functions.https.HttpsError('failed-precondition',
        'Cannot place a sell order while you have an active short on this stock.');
    }
  }

  // Block duplicate limit orders on same ticker + type
  // Treat SELL and STOP_LOSS as equivalent to prevent double-selling
  const sellTypes = ['SELL', 'STOP_LOSS'];
  const isSellType = sellTypes.includes(type);
  const existingOrderOnTicker = pendingOrders.docs.some(doc => {
    const o = doc.data();
    const isExistingSellType = sellTypes.includes(o.type);
    return o.ticker === ticker && (isSellType ? isExistingSellType : o.type === type);
  });
  if (existingOrderOnTicker) {
    throw new functions.https.HttpsError('already-exists',
      `You already have a pending sell or stop-loss order on ${ticker}. Cancel it first.`);
  }

  // Create the order
  const expiresAt = Date.now() + NINETY_DAYS_MS; // 90 days
  const orderRef = await db.collection('limitOrders').add({
    userId: uid,
    ticker,
    type,
    shares,
    limitPrice,
    allowPartialFills: !!allowPartialFills,
    status: 'PENDING',
    filledShares: 0,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    expiresAt,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return { success: true, orderId: orderRef.id };
});

/**
 * Check and Execute Limit Orders
 * Runs every 2 minutes to check if any pending limit orders should execute
 */
exports.checkLimitOrders = cf().pubsub
  .schedule('every 15 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    // Skip during weekly halt — don't execute pending orders
    if (isWeeklyTradingHalt()) {
      console.log('Skipping limit order check — weekly trading halt active');
      return { success: true, skipped: true, reason: 'weekly_halt' };
    }

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
          let feedDisplayName = '';
          let feedCrew = null;

          try {
            await db.runTransaction(async (transaction) => {
              fillShares = remainingShares;  // Reset on every retry
              executedPrice = 0;
              const userSnap = await transaction.get(userRef);
              const freshMarketSnap = await transaction.get(marketRef);

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

              // Check if user is bankrupt/in debt (could have changed since order was created)
              if (userData.isBankrupt || (userData.cash || 0) < 0) {
                throw new Error('User is bankrupt or in debt');
              }

              // STOP_LOSS executes as a sell — normalize for validation/execution
              const effectiveType = order.type === 'STOP_LOSS' ? 'SELL' : order.type;

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
                const userShares = userData.holdings?.[order.ticker] || 0;
                if (userShares < fillShares) {
                  if (order.allowPartialFills) {
                    if (userShares > 0) {
                      fillShares = userShares;
                      console.log(`Partial fill: only have ${userShares} shares`);
                    } else {
                      throw new Error('Insufficient shares');
                    }
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

                transaction.update(userRef, {
                  cash: admin.firestore.FieldValue.increment(-totalCost),
                  [`holdings.${order.ticker}`]: newHoldings,
                  [`costBasis.${order.ticker}`]: Math.round(newCostBasis * 100) / 100,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1),
                  tickerTradeHistory: updatedLimitHistory
                });

                // Apply price impact to market (only if there's actual impact)
                if (effectiveImpact > 0) {
                  transaction.update(marketRef, {
                    [`prices.${order.ticker}`]: newMarketPrice,
                    [`priceHistory.${order.ticker}`]: admin.firestore.FieldValue.arrayUnion({
                      timestamp: Date.now(),
                      price: newMarketPrice
                    })
                  });
                }

                console.log(`Executed BUY: ${fillShares} ${order.ticker} @ $${askPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              } else if (effectiveType === 'SELL') {
                // Price goes DOWN on sell
                const newMarketPrice = Math.max(0.01, Math.round((freshPrice - effectiveImpact) * 100) / 100);
                const bidPrice = newMarketPrice * (1 - limitSpread / 2);
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

                const updates = {
                  cash: admin.firestore.FieldValue.increment(totalRevenue),
                  [`holdings.${order.ticker}`]: newHoldings,
                  lastTradeTime: admin.firestore.FieldValue.serverTimestamp(),
                  totalTrades: admin.firestore.FieldValue.increment(1),
                  tickerTradeHistory: updatedLimitHistory
                };

                if (newHoldings <= 0) {
                  updates[`holdings.${order.ticker}`] = admin.firestore.FieldValue.delete();
                  updates[`costBasis.${order.ticker}`] = admin.firestore.FieldValue.delete();
                  updates[`lowestWhileHolding.${order.ticker}`] = admin.firestore.FieldValue.delete();
                }

                transaction.update(userRef, updates);

                // Apply price impact to market (only if there's actual impact)
                if (effectiveImpact > 0) {
                  transaction.update(marketRef, {
                    [`prices.${order.ticker}`]: newMarketPrice,
                    [`priceHistory.${order.ticker}`]: admin.firestore.FieldValue.arrayUnion({
                      timestamp: Date.now(),
                      price: newMarketPrice
                    })
                  });
                }

                console.log(`Executed ${order.type}: ${fillShares} ${order.ticker} @ $${bidPrice.toFixed(2)} (impact: ${freshPrice} -> ${newMarketPrice}) for user ${order.userId}`);
              }

              // Mark the order filled inside the same transaction as the balance
              // change, so a crash here can't leave it PENDING and double-fill it
              // on the next 2-minute cycle.
              const newFilledTotal = alreadyFilled + fillShares;
              const isPartialFill = order.allowPartialFills && newFilledTotal < totalShares;
              transaction.update(db.collection('limitOrders').doc(orderId), {
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
  });

// ============================================
// SECURE OPERATIONS - Moved from client-side
// These operations modify protected fields (cash, holdings, shorts, marginUsed)
// and must go through Cloud Functions to prevent exploits
// ============================================

/**
 * Claim mission reward (daily or weekly)
 */
