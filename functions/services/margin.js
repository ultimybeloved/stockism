'use strict';
const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTERS } = require('../characters');
const {
  ADMIN_UID, isWeeklyTradingHalt,
  TWENTY_FOUR_HOURS_MS, ONE_WEEK_MS, THIRTY_DAYS_MS,
  MARGIN_INTEREST_RATE, CREW_SWITCH_PENALTY, BAILOUT_CASH,
  BASE_IMPACT, BASE_LIQUIDITY, MAX_PRICE_CHANGE_PERCENT, ANIMAL_TICKERS,
  WEEKLY_HALT_END_MINUTE, MARKET_OPEN_GRACE_PERIOD_MINUTES,
  SHORT_MARGIN_CALL_THRESHOLD, SHORT_MARGIN_DAMPENING_FACTOR,
  LONG_MARGIN_CALL_THRESHOLD, LONG_MARGIN_LIQUIDATION_THRESHOLD,
  UNIFIER_FULL_SHARE_MIN,
} = require('../constants');
const { checkBanned, checkDiscordWall, writeNotification, sendDiscordMessage, reportError, touchLastActive } = require('../helpers');

exports.repayMargin = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { amount } = data;

  if (!amount || !Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid repay amount.');
  }

  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    const marginUsed = userData.marginUsed || 0;

    if (marginUsed <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'No margin debt.');
    }
    if ((userData.cash || 0) < amount) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    const repayAmount = Math.min(amount, marginUsed);
    const newMarginUsed = marginUsed - repayAmount;

    transaction.update(userRef, {
      cash: (userData.cash || 0) - repayAmount,
      marginUsed: newMarginUsed < 0.01 ? 0 : Math.round(newMarginUsed * 100) / 100,
      marginCallAt: null
    });

    return { success: true, repaid: repayAmount, remaining: newMarginUsed < 0.01 ? 0 : newMarginUsed };
  });
});

/**
 * Bankruptcy bailout - reset to $500
 */
exports.bailout = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    if (!userData.isBankrupt) {
      throw new functions.https.HttpsError('failed-precondition', 'You can still recover. Sell or close a position to clear your debt. A bailout is only for a fully wiped out account.');
    }

    // Enforce 24-hour cooldown between bailouts
    if (userData.lastBailout && (Date.now() - userData.lastBailout) < TWENTY_FOUR_HOURS_MS) {
      throw new functions.https.HttpsError('failed-precondition', 'Bailout available once per 24 hours.');
    }

    const currentCrew = userData.crew;
    const crewHistory = userData.crewHistory || [];
    const updatedHistory = currentCrew && !crewHistory.includes(currentCrew)
      ? [...crewHistory, currentCrew]
      : crewHistory;

    transaction.update(userRef, {
      cash: BAILOUT_CASH,
      holdings: {},
      shorts: {},
      costBasis: {},
      portfolioValue: BAILOUT_CASH,
      marginEnabled: false,
      marginUsed: 0,
      isBankrupt: false,
      bankruptAt: null,
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      crewHistory: updatedHistory,
      lastBailout: Date.now(),
      shortHistory: {},
      lowestWhileHolding: {},
      tickerTradeHistory: {}
    });

    return { success: true, hadCrew: !!currentCrew };
  });
});

/**
 * Leave crew with 15% penalty
 */
exports.leaveCrew = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(marketRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    if (!userData.crew) {
      throw new functions.https.HttpsError('failed-precondition', 'Not in a crew.');
    }
    if ((userData.cash || 0) < 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Cannot leave crew while in debt.');
    }

    const prices = marketDoc.exists ? (marketDoc.data().prices || {}) : {};
    const penaltyRate = CREW_SWITCH_PENALTY;

    // 15% cash penalty
    const newCash = Math.floor((userData.cash || 0) * (1 - penaltyRate));

    // 15% holdings penalty (floor to never take more than 15%)
    const newHoldings = {};
    let holdingsValueTaken = 0;
    Object.entries(userData.holdings || {}).forEach(([ticker, shares]) => {
      if (shares > 0) {
        const sharesToTake = Math.floor(shares * penaltyRate);
        const sharesToKeep = shares - sharesToTake;
        newHoldings[ticker] = sharesToKeep;
        holdingsValueTaken += sharesToTake * (prices[ticker] || 0);
      }
    });

    const totalTaken = ((userData.cash || 0) - newCash) + holdingsValueTaken;
    const newPortfolioValue = (userData.portfolioValue || 0) - totalTaken;

    transaction.update(userRef, {
      crew: null,
      crewJoinedAt: null,
      isCrewHead: false,
      crewHeadColor: null,
      cash: newCash,
      holdings: newHoldings,
      portfolioValue: Math.max(0, newPortfolioValue),
      lastCrewChange: Date.now()
    });

    return { success: true, totalTaken, crewLeft: userData.crew };
  });
});

/**
 * Toggle margin trading (enable/disable)
 */
exports.toggleMargin = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid);
  const { enable } = data;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);

    if (enable) {
      // Check eligibility: $2000 min cash
      const isAdmin = uid === ADMIN_UID;
      if (!isAdmin && (userData.cash || 0) < 2000) {
        throw new functions.https.HttpsError('failed-precondition', 'Need $2,000 minimum cash.');
      }
      transaction.update(userRef, {
        marginEnabled: true,
        marginUsed: 0,
        marginEnabledAt: Date.now()
      });
    } else {
      // Check no outstanding margin
      if ((userData.marginUsed || 0) >= 0.01) {
        throw new functions.https.HttpsError('failed-precondition', 'Repay all margin debt first.');
      }
      transaction.update(userRef, {
        marginEnabled: false,
        marginUsed: 0
      });
    }

    return { success: true, marginEnabled: enable };
  });
});

/**
 * Charge daily margin interest
 */
exports.chargeMarginInterest = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const userRef = db.collection('users').doc(uid);

  return db.runTransaction(async (transaction) => {
    const userDoc = await transaction.get(userRef);
    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');

    const userData = userDoc.data();
    const marginUsed = userData.marginUsed || 0;

    if (marginUsed <= 0 || !userData.marginEnabled) {
      return { success: true, charged: 0 };
    }

    const lastCharge = userData.lastMarginInterestCharge || 0;
    const now = Date.now();
    if (now - lastCharge < TWENTY_FOUR_HOURS_MS) {
      return { success: true, charged: 0, reason: 'Already charged today' };
    }

    const interest = marginUsed * MARGIN_INTEREST_RATE;
    transaction.update(userRef, {
      marginUsed: marginUsed + interest,
      lastMarginInterestCharge: now
    });

    return { success: true, charged: interest };
  });
});

/**
 * Server-side short margin call checker
 * Runs every 5 minutes - checks all users with active shorts
 * If equity ratio drops below 25%, force-covers the position
 * Uses 50% dampened price impact to prevent cascading short squeezes
 */
exports.checkShortMarginCalls = cf().pubsub
  .schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping short margin calls — weekly trading halt active');
      return null;
    }

    const now = new Date();
    if (now.getUTCDay() === 4) {
      const utcMins = now.getUTCHours() * 60 + now.getUTCMinutes();
      if (utcMins >= WEEKLY_HALT_END_MINUTE && utcMins < WEEKLY_HALT_END_MINUTE + MARKET_OPEN_GRACE_PERIOD_MINUTES) {
        console.log(`Market open grace period active — skipping margin calls until ${WEEKLY_HALT_END_MINUTE + MARKET_OPEN_GRACE_PERIOD_MINUTES} UTC min`);
        return null;
      }
    }

    const startTime = Date.now();
    console.log('Checking short margin calls...');

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return null;
      }

      const marketData = marketSnap.data();
      if (marketData.marketHalted) {
        console.log('Skipping short margin calls — emergency halt active');
        return null;
      }
      const prices = marketData.prices || {};

      // Query all users - filter for shorts client-side since Firestore
      // can't query on map key existence efficiently
      const usersSnap = await db.collection('users').get();

      let liquidatedCount = 0;
      let checkedCount = 0;
      let throttledCount = 0;
      const COVERS_PER_TICKER_PER_CYCLE = 3; // Max forced covers per ticker per 5-min cycle
      const tickerCoverCount = {};

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const shorts = userData.shorts || {};
        const shortEntries = Object.entries(shorts).filter(
          ([, pos]) => pos && pos.shares > 0
        );

        if (shortEntries.length === 0) continue;
        checkedCount++;

        for (const [ticker, position] of shortEntries) {
          const currentPrice = prices[ticker];
          if (!currentPrice) continue;

          // Throttle: max 3 forced covers per ticker per cycle to prevent cascading spikes
          if ((tickerCoverCount[ticker] || 0) >= COVERS_PER_TICKER_PER_CYCLE) {
            throttledCount++;
            continue; // Will be picked up in next 5-minute cycle
          }

          const costBasis = position.costBasis || position.entryPrice || currentPrice;
          const marginDeposited = position.margin || (costBasis * position.shares * 0.5);

          // Calculate equity: margin deposited minus unrealized loss
          const unrealizedLoss = (currentPrice - costBasis) * position.shares;
          const equity = marginDeposited - unrealizedLoss;
          const positionValue = currentPrice * position.shares;
          const equityRatio = positionValue > 0 ? equity / positionValue : 0;

          if (equityRatio < SHORT_MARGIN_CALL_THRESHOLD) {
            // Force-cover this position
            try {
              await db.runTransaction(async (transaction) => {
                // Re-read latest data inside transaction
                const freshUserDoc = await transaction.get(db.collection('users').doc(userDoc.id));
                const freshMarketDoc = await transaction.get(marketRef);

                if (!freshUserDoc.exists || !freshMarketDoc.exists) return;

                const freshUserData = freshUserDoc.data();
                const freshShorts = freshUserData.shorts || {};
                const freshPosition = freshShorts[ticker];

                if (!freshPosition || freshPosition.shares <= 0) return;

                const freshPrices = freshMarketDoc.data().prices || {};
                const freshPrice = freshPrices[ticker];
                if (!freshPrice) return;

                // Re-check equity ratio with fresh data
                const freshCostBasis = freshPosition.costBasis || freshPosition.entryPrice || freshPrice;
                const freshMargin = freshPosition.margin || (freshCostBasis * freshPosition.shares * 0.5);
                const freshLoss = (freshPrice - freshCostBasis) * freshPosition.shares;
                const freshEquity = freshMargin - freshLoss;
                const freshPositionValue = freshPrice * freshPosition.shares;
                const freshEquityRatio = freshPositionValue > 0 ? freshEquity / freshPositionValue : 0;

                if (freshEquityRatio >= SHORT_MARGIN_CALL_THRESHOLD) return; // No longer underwater

                // Calculate dampened price impact for forced cover (50% reduced)
                const priceImpact = freshPrice * BASE_IMPACT * Math.sqrt(freshPosition.shares / BASE_LIQUIDITY);
                const dampenedImpact = priceImpact * SHORT_MARGIN_DAMPENING_FACTOR;
                const maxImpact = freshPrice * MAX_PRICE_CHANGE_PERCENT;
                const cappedImpact = Math.min(dampenedImpact, maxImpact);
                const newPrice = Math.round((freshPrice + cappedImpact) * 100) / 100;

                // Calculate cover cost and margin return
                const coverPrice = newPrice;
                let cashChange;
                if ((freshPosition.system || 'v2') === 'v2') {
                  // v2: margin back + profit/loss
                  const shortProfit = (freshCostBasis - coverPrice) * freshPosition.shares;
                  cashChange = freshMargin + shortProfit;
                } else {
                  // Legacy: pay cover cost, get margin back (proceeds already in cash)
                  const coverCost = coverPrice * freshPosition.shares;
                  cashChange = freshMargin - coverCost;
                }

                // Update user: clear short, adjust cash
                const newCash = Math.round(((freshUserData.cash || 0) + cashChange) * 100) / 100;
                // Sanitize shorts to prevent undefined fields from crashing Firestore writes
                const updatedShorts = {};
                for (const [t, pos] of Object.entries(freshShorts)) {
                  if (t !== ticker && pos && pos.shares > 0) {
                    updatedShorts[t] = {
                      shares: pos.shares,
                      costBasis: pos.costBasis || pos.entryPrice || 0,
                      margin: pos.margin || 0,
                      openedAt: pos.openedAt || admin.firestore.Timestamp.now(),
                      system: pos.system || 'v2'
                    };
                  }
                }

                const userUpdates = {
                  shorts: updatedShorts,
                  cash: newCash
                };

                if (newCash < 0) {
                  userUpdates.isBankrupt = true;
                  userUpdates.bankruptAt = Date.now();
                }

                transaction.update(db.collection('users').doc(userDoc.id), userUpdates);

                // Update market price (dampened)
                transaction.update(marketRef, {
                  [`prices.${ticker}`]: newPrice,
                  [`priceHistory.${ticker}`]: admin.firestore.FieldValue.arrayUnion({
                    timestamp: Date.now(),
                    price: newPrice
                  })
                });

                // Log the liquidation trade
                const tradeRef = db.collection('trades').doc();
                transaction.set(tradeRef, {
                  uid: userDoc.id,
                  ticker,
                  action: 'margin_call_cover',
                  amount: freshPosition.shares,
                  price: coverPrice,
                  totalValue: coverPrice * freshPosition.shares,
                  cashBefore: freshUserData.cash || 0,
                  cashAfter: newCash,
                  timestamp: admin.firestore.FieldValue.serverTimestamp(),
                  automated: true
                });

                console.log(`Liquidated ${userDoc.id}'s short on ${ticker}: ${freshPosition.shares} shares at ${coverPrice}, cashChange: ${cashChange.toFixed(2)}`);
              });

              liquidatedCount++;
              tickerCoverCount[ticker] = (tickerCoverCount[ticker] || 0) + 1;

              // Notify user about margin call liquidation
              await writeNotification(userDoc.id, {
                type: 'margin',
                title: 'Margin Call - Position Liquidated',
                message: `Your short on $${ticker} (${position.shares} shares) was force-covered due to low equity.`,
                data: { ticker }
              });
            } catch (error) {
              console.error(`Failed to liquidate ${userDoc.id}'s ${ticker} short:`, error);
            }
          }
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Margin call check complete: ${checkedCount} users checked, ${liquidatedCount} positions liquidated, ${throttledCount} throttled in ${elapsed}s`);
      return { checked: checkedCount, liquidated: liquidatedCount, throttled: throttledCount, elapsed };

    } catch (error) {
      console.error('Margin call check failed:', error);
      return null;
    }
  });

/**
 * Server-side portfolio sync
 * Updates portfolioValue, portfolioHistory, peakPortfolioValue, and achievements
 * Called by clients instead of writing these fields directly (blocked by security rules)
 */
exports.syncPortfolio = cf().https.onCall(async (data, context) => {
    requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  const [userDoc, marketDoc] = await Promise.all([
    userRef.get(),
    marketRef.get()
  ]);

  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  if (!marketDoc.exists) throw new functions.https.HttpsError('not-found', 'Market data not found.');

  const userData = userDoc.data();
  checkBanned(userData);
  checkDiscordWall(userData);
  const prices = marketDoc.data().prices || {};
  const now = Date.now();

  // Rate limit: once per 30 seconds per user
  const lastSynced = userData.lastSynced || 0;
  if (now - lastSynced < 30000) {
    return {
      portfolioValue: userData.portfolioValue || 0,
      peakPortfolioValue: userData.peakPortfolioValue || 0,
      newAchievements: [],
      historyUpdated: false,
      rateLimited: true
    };
  }

  // Hourly rate limit: max 60 syncs per hour
  const syncCount = userData.syncCountHour || 0;
  const syncHourStart = userData.syncHourStart || 0;
  const oneHour = 60 * 60 * 1000;
  if (now - syncHourStart < oneHour && syncCount >= 60) {
    return {
      portfolioValue: userData.portfolioValue || 0,
      peakPortfolioValue: userData.peakPortfolioValue || 0,
      newAchievements: [],
      historyUpdated: false,
      rateLimited: true
    };
  }

  // Calculate portfolio value
  const holdingsValue = Object.entries(userData.holdings || {})
    .reduce((sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares, 0);

  const shortsValue = Object.entries(userData.shorts || {})
    .reduce((sum, [ticker, position]) => {
      if (!position || typeof position !== 'object') return sum;
      const shares = position.shares || 0;
      if (shares <= 0) return sum;
      const costBasis = position.costBasis || position.entryPrice || 0;
      const currentPrice = prices[ticker] || costBasis;
      const margin = position.margin || (costBasis * shares * 0.5);
      if ((position.system || 'v2') === 'v2') {
        // v2: margin + unrealized P&L (no proceeds in cash)
        return sum + margin + (costBasis - currentPrice) * shares;
      }
      // Legacy: margin collateral - cost to buy back shares
      return sum + margin - (currentPrice * shares);
    }, 0);

  const portfolioValue = Math.round(((userData.cash || 0) + holdingsValue + shortsValue) * 100) / 100;

  const updateData = {
    portfolioValue,
    lastSynced: now,
    // Track hourly sync count
    syncCountHour: (now - syncHourStart >= oneHour) ? 1 : syncCount + 1,
    syncHourStart: (now - syncHourStart >= oneHour) ? now : syncHourStart
  };

  // Initialize weekly mission startPortfolioValue if not set
  const syncNow = new Date();
  const syncWeekStart = new Date(syncNow);
  syncWeekStart.setDate(syncWeekStart.getDate() - syncWeekStart.getDay() + 1);
  if (syncWeekStart > syncNow) syncWeekStart.setDate(syncWeekStart.getDate() - 7);
  const syncWeekId = syncWeekStart.toISOString().split('T')[0];
  const weeklyData = userData.weeklyMissions?.[syncWeekId];
  if (!weeklyData || weeklyData.startPortfolioValue === undefined) {
    updateData[`weeklyMissions.${syncWeekId}.startPortfolioValue`] = portfolioValue;
  }

  // Track lowest price while holding for Diamond Hands achievement
  const holdings = userData.holdings || {};
  const lowestWhileHolding = userData.lowestWhileHolding || {};
  for (const [ticker, shares] of Object.entries(holdings)) {
    if (shares > 0 && prices[ticker]) {
      const currentPrice = prices[ticker];
      const currentLowest = lowestWhileHolding[ticker];
      if (currentLowest === undefined || currentPrice < currentLowest) {
        updateData[`lowestWhileHolding.${ticker}`] = Math.round(currentPrice * 100) / 100;
      }
    }
  }

  // Update peak portfolio value
  const peakPortfolioValue = Math.max(userData.peakPortfolioValue || 0, portfolioValue);
  if (peakPortfolioValue > (userData.peakPortfolioValue || 0)) {
    updateData.peakPortfolioValue = peakPortfolioValue;
  }

  // Update portfolio history — permanent subcollection, no cap
  const lastRecord = userData.lastPortfolioSnapshot || null;
  const tenMinutes = 10 * 60 * 1000;

  const valueChanged = lastRecord && lastRecord.value > 0 && Math.abs(portfolioValue - lastRecord.value) / lastRecord.value > 0.01;
  const timeElapsed = !lastRecord || (now - lastRecord.timestamp) > tenMinutes;

  let historyWritten = false;
  if (!lastRecord || timeElapsed || valueChanged) {
    await userRef.collection('portfolioHistory').add({ timestamp: now, value: portfolioValue });
    updateData.lastPortfolioSnapshot = { timestamp: now, value: portfolioValue };
    historyWritten = true;
  }

  // Rolling reference snapshots — used by leaderboard and dashboard
  const snap24h = userData.portfolioSnapshot24h;
  if (!snap24h || (now - snap24h.timestamp) >= TWENTY_FOUR_HOURS_MS) {
    updateData.portfolioSnapshot24h = { timestamp: now, value: portfolioValue };
  }
  const snap7d = userData.portfolioSnapshot7d;
  if (!snap7d || (now - snap7d.timestamp) >= ONE_WEEK_MS) {
    updateData.portfolioSnapshot7d = { timestamp: now, value: portfolioValue };
  }
  // 30-day reference is the user's ACTUAL portfolio value ~30 days ago, read
  // from the permanent portfolioHistory. Refreshed at most once a day so the
  // window slides without querying history on every sync (one read/user/day).
  const snap30d = userData.portfolioSnapshot30d;
  if (!snap30d || (now - (snap30d.refreshedAt || 0)) >= TWENTY_FOUR_HOURS_MS) {
    try {
      const cutoff = now - THIRTY_DAYS_MS;
      const atOrBefore = await userRef.collection('portfolioHistory')
        .where('timestamp', '<=', cutoff).orderBy('timestamp', 'desc').limit(1).get();
      let value;
      if (!atOrBefore.empty) {
        value = atOrBefore.docs[0].data().value;
      } else {
        // Account younger than 30 days — compare against the earliest point on record.
        const earliest = await userRef.collection('portfolioHistory')
          .orderBy('timestamp', 'asc').limit(1).get();
        value = earliest.empty ? portfolioValue : earliest.docs[0].data().value;
      }
      updateData.portfolioSnapshot30d = { refreshedAt: now, value };
    } catch (e) {
      // Non-fatal — keep the existing snapshot rather than blocking the sync.
      console.error('30d snapshot refresh failed:', e.message);
    }
  }

  // Prune stale mission-progress keys so the user doc doesn't grow forever
  // (one map entry per active day/week otherwise accumulates for the account's
  // lifetime). Keys are YYYY-MM-DD strings, so a lexicographic sort is
  // chronological. Anything older than the 2 most recent can't be claimed.
  const pruneMissionMap = (map, field) => {
    const keys = Object.keys(map || {}).sort();
    keys.slice(0, Math.max(0, keys.length - 2)).forEach(k => {
      updateData[`${field}.${k}`] = admin.firestore.FieldValue.delete();
    });
  };
  pruneMissionMap(userData.dailyMissions, 'dailyMissions');
  pruneMissionMap(userData.weeklyMissions, 'weeklyMissions');

  // Check achievements
  const currentAchievements = userData.achievements || [];
  const newAchievements = [];
  const revokedAchievements = [];
  const holdingsCount = Object.values(userData.holdings || {}).filter(shares => shares > 0).length;
  const totalTrades = userData.totalTrades || 0;

  if (totalTrades >= 1 && !currentAchievements.includes('FIRST_BLOOD')) newAchievements.push('FIRST_BLOOD');
  if (totalTrades >= 20 && !currentAchievements.includes('TRADER_20')) newAchievements.push('TRADER_20');
  if (totalTrades >= 100 && !currentAchievements.includes('TRADER_100')) newAchievements.push('TRADER_100');
  if (portfolioValue >= 2500 && !currentAchievements.includes('BROKE_2K')) newAchievements.push('BROKE_2K');
  if (portfolioValue >= 5000 && !currentAchievements.includes('BROKE_5K')) newAchievements.push('BROKE_5K');
  if (portfolioValue >= 10000 && !currentAchievements.includes('BROKE_10K')) newAchievements.push('BROKE_10K');
  if (portfolioValue >= 25000 && !currentAchievements.includes('BROKE_25K')) newAchievements.push('BROKE_25K');
  if (portfolioValue >= 50000 && !currentAchievements.includes('BROKE_50K')) newAchievements.push('BROKE_50K');
  if (portfolioValue >= 100000 && !currentAchievements.includes('BROKE_100K')) newAchievements.push('BROKE_100K');
  if (portfolioValue >= 250000 && !currentAchievements.includes('BROKE_250K')) newAchievements.push('BROKE_250K');
  if (portfolioValue >= 500000 && !currentAchievements.includes('BROKE_500K')) newAchievements.push('BROKE_500K');
  if (portfolioValue >= 1000000 && !currentAchievements.includes('BROKE_1M')) newAchievements.push('BROKE_1M');
  // Diversified: hold 5+ tickers. Auto-revoked if user drops below 5.
  if (holdingsCount >= 5 && !currentAchievements.includes('DIVERSIFIED')) {
    newAchievements.push('DIVERSIFIED');
  } else if (holdingsCount < 5 && currentAchievements.includes('DIVERSIFIED')) {
    revokedAchievements.push('DIVERSIFIED');
  }

  // Unifier of Seoul: own at least one FULL share of every tradeable character
  // (excludes ETFs). Partial/fractional holdings do not count. Auto-revoked if
  // the user no longer qualifies — e.g. they sold below a full share or a new
  // character was added to the roster since they earned it.
  const launchedTickers = marketDoc.data().launchedTickers || [];
  const tradeableCharacters = CHARACTERS.filter(c => !c.isETF && (!c.ipoRequired || launchedTickers.includes(c.ticker)));
  const totalCharacters = tradeableCharacters.length;
  const characterTickers = new Set(tradeableCharacters.map(c => c.ticker));
  const ownedCharacterCount = Object.entries(userData.holdings || {}).filter(([ticker, shares]) => shares >= UNIFIER_FULL_SHARE_MIN && characterTickers.has(ticker)).length;
  const qualifiesForUnifier = ownedCharacterCount >= totalCharacters && totalCharacters > 0;
  if (qualifiesForUnifier && !currentAchievements.includes('UNIFIER')) {
    newAchievements.push('UNIFIER');
  } else if (!qualifiesForUnifier && currentAchievements.includes('UNIFIER')) {
    revokedAchievements.push('UNIFIER');
  }

  // NPC Lover: check if accumulated profit reached $1,000
  if ((userData.npcProfit || 0) >= 1000 && !currentAchievements.includes('NPC_LOVER')) newAchievements.push('NPC_LOVER');

  // Plugged In: awarded to users who have linked their Discord
  if (userData.discordId && !currentAchievements.includes('DISCORD_LINKED')) newAchievements.push('DISCORD_LINKED');

  // Check leaderboard achievements (server-side, no client trust needed)
  const MIN_PORTFOLIO_FOR_LEADERBOARD = 5000;
  if (portfolioValue >= MIN_PORTFOLIO_FOR_LEADERBOARD && !currentAchievements.includes('TOP_1')) {
    try {
      const topSnap = await db.collection('users')
        .orderBy('portfolioValue', 'desc')
        .limit(10)
        .get();

      const topUsers = [];
      topSnap.forEach(doc => {
        const d = doc.data();
        if (!d.isBot && (d.portfolioValue || 0) >= MIN_PORTFOLIO_FOR_LEADERBOARD) {
          topUsers.push(doc.id);
        }
      });

      const userPosition = topUsers.indexOf(uid);
      if (userPosition !== -1) {
        const rank = userPosition + 1;
        if (rank <= 10 && !currentAchievements.includes('TOP_10')) newAchievements.push('TOP_10');
        if (rank <= 3 && !currentAchievements.includes('TOP_3')) newAchievements.push('TOP_3');
        if (rank === 1 && !currentAchievements.includes('TOP_1')) newAchievements.push('TOP_1');
      }
    } catch (err) {
      console.error('Leaderboard achievement check failed:', err);
    }
  }

  // Compute and store weekly gain for Profit Champion
  const valueSevenDaysAgo = (userData.portfolioSnapshot7d || updateData.portfolioSnapshot7d)?.value ?? portfolioValue;
  const weeklyGain = Math.round((portfolioValue - valueSevenDaysAgo) * 100) / 100;
  updateData.weeklyGain = weeklyGain;

  // Check Profit Champion: #1 in weekly gains
  if (weeklyGain > 0 && !currentAchievements.includes('PROFIT_CHAMPION')) {
    try {
      const topGainerSnap = await db.collection('users')
        .orderBy('weeklyGain', 'desc')
        .limit(1)
        .get();
      if (!topGainerSnap.empty) {
        const topDoc = topGainerSnap.docs[0];
        const topGain = topDoc.data().weeklyGain || 0;
        // Award if user's new gain beats the current top (or they ARE the current top)
        if (topDoc.id === uid || weeklyGain > topGain) {
          newAchievements.push('PROFIT_CHAMPION');
        }
      }
    } catch (err) {
      console.error('Profit Champion check failed:', err);
    }
  }

  // Check checkin achievements (server-side)
  const totalCheckins = userData.totalCheckins || 0;
  if (totalCheckins >= 7 && !currentAchievements.includes('DEDICATED_7')) newAchievements.push('DEDICATED_7');
  if (totalCheckins >= 14 && !currentAchievements.includes('DEDICATED_14')) newAchievements.push('DEDICATED_14');
  if (totalCheckins >= 30 && !currentAchievements.includes('DEDICATED_30')) newAchievements.push('DEDICATED_30');
  if (totalCheckins >= 100 && !currentAchievements.includes('DEDICATED_100')) newAchievements.push('DEDICATED_100');

  // You're a Worker: gained 25%+ of net worth in a week
  const weeklyGainPercent = valueSevenDaysAgo > 0 ? ((weeklyGain / valueSevenDaysAgo) * 100) : 0;
  if (weeklyGainPercent >= 25 && weeklyGain > 0 && !currentAchievements.includes('YOURE_A_WORKER')) newAchievements.push('YOURE_A_WORKER');

  // Dividend Demon: held any ETF for 50 consecutive days
  const FIFTY_DAYS_MS = 50 * 24 * 60 * 60 * 1000;
  const holdingCohorts = userData.holdingCohorts || {};
  const hasHeldETF50Days = Object.entries(holdingCohorts).some(([t, cohort]) => {
    const char = CHARACTERS.find(c => c.ticker === t);
    return char?.isETF && cohort?.firstHeldAt && (now - cohort.firstHeldAt >= FIFTY_DAYS_MS);
  });
  if (hasHeldETF50Days && !currentAchievements.includes('DIVIDEND_DEMON')) newAchievements.push('DIVIDEND_DEMON');

  // Animal Instinct: check cumulative profit in case it was already tracked
  const pbt = userData.profitByTicker || {};
  const totalAnimalProfit = [...ANIMAL_TICKERS].reduce((s, t) => s + (pbt[t] || 0), 0);
  if (totalAnimalProfit >= 250 && !currentAchievements.includes('ANIMAL_INSTINCT')) newAchievements.push('ANIMAL_INSTINCT');

  if (newAchievements.length > 0) {
    updateData.achievements = admin.firestore.FieldValue.arrayUnion(...newAchievements);
    // Track when each achievement was earned
    for (const achId of newAchievements) {
      updateData[`achievementDates.${achId}`] = Date.now();
    }
  }

  // Check bankruptcy
  if (portfolioValue <= 100 && !userData.isBankrupt && userData.displayName) {
    updateData.isBankrupt = true;
  }

  // Auto-clear bankruptcy if account has recovered
  if (userData.isBankrupt && portfolioValue > 500 && (userData.cash || 0) >= 0) {
    updateData.isBankrupt = false;
    if (userData.bankruptAt) {
      updateData.bankruptAt = admin.firestore.FieldValue.delete();
    }
  }

  await userRef.update(updateData);

  // Revocations go in a separate write — Firestore forbids mixing arrayUnion
  // and arrayRemove on the same field in one update. Also drop any revoked
  // achievement from the displayed pins so it can't keep occupying a profile
  // slot the user can no longer see to free up.
  if (revokedAchievements.length > 0) {
    await userRef.update({
      achievements: admin.firestore.FieldValue.arrayRemove(...revokedAchievements),
      displayedAchievementPins: admin.firestore.FieldValue.arrayRemove(...revokedAchievements),
    });
  }

  return {
    portfolioValue,
    peakPortfolioValue,
    newAchievements,
    revokedAchievements,
    historyUpdated: historyWritten
  };
});

/**
 * Check Margin Lending - Scheduled every 5 minutes
 * Monitors users with margin debt and auto-liquidates if equity drops too low
 */
exports.checkMarginLending = cf().pubsub
  .schedule('every 30 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping margin lending check — weekly trading halt active');
      return null;
    }

    const startTime = Date.now();
    console.log('Checking margin lending positions...');

    try {
      const marketRef = db.collection('market').doc('current');
      const marketSnap = await marketRef.get();

      if (!marketSnap.exists) {
        console.error('Market data not found');
        return null;
      }

      const marketSnapData = marketSnap.data();
      if (marketSnapData.marketHalted) {
        console.log('Skipping margin lending check — emergency halt active');
        return null;
      }
      const prices = marketSnapData.prices || {};

      // Query users with margin enabled
      const usersSnap = await db.collection('users')
        .where('marginEnabled', '==', true)
        .get();

      let liquidatedCount = 0;
      let marginCallCount = 0;
      let checkedCount = 0;

      const MARGIN_CALL_GRACE_PERIOD = TWENTY_FOUR_HOURS_MS;

      for (const userDoc of usersSnap.docs) {
        const userData = userDoc.data();
        const marginUsed = userData.marginUsed || 0;
        if (marginUsed <= 0) continue;
        checkedCount++;

        const cash = userData.cash || 0;
        const holdings = userData.holdings || {};

        // Calculate holdings value
        let holdingsValue = 0;
        Object.entries(holdings).forEach(([ticker, shares]) => {
          if (shares > 0) {
            holdingsValue += (prices[ticker] || 0) * shares;
          }
        });

        const grossValue = cash + holdingsValue;
        const portfolioValue = grossValue - marginUsed;
        const equityRatio = grossValue > 0 ? portfolioValue / grossValue : 0;

        const now = Date.now();

        if (equityRatio <= LONG_MARGIN_LIQUIDATION_THRESHOLD) {
          // AUTO-LIQUIDATION
          try {
            await db.runTransaction(async (transaction) => {
              const freshUserDoc = await transaction.get(db.collection('users').doc(userDoc.id));
              if (!freshUserDoc.exists) return;

              const freshData = freshUserDoc.data();
              const freshMarginUsed = freshData.marginUsed || 0;
              if (freshMarginUsed <= 0) return;

              const freshHoldings = freshData.holdings || {};
              let totalRecovered = 0;
              const updateData = {};

              // Sell ALL positions with 5% slippage
              Object.entries(freshHoldings).forEach(([ticker, shares]) => {
                if (shares > 0) {
                  const sellValue = (prices[ticker] || 0) * shares * 0.95;
                  totalRecovered += sellValue;
                  updateData[`holdings.${ticker}`] = 0;
                  updateData[`costBasis.${ticker}`] = 0;
                }
              });

              const freshCash = freshData.cash || 0;
              const totalAvailable = freshCash + totalRecovered;
              const finalCash = Math.round((totalAvailable - freshMarginUsed) * 100) / 100;

              updateData.cash = finalCash;
              updateData.marginUsed = 0;
              updateData.marginCallAt = null;
              updateData.lastLiquidation = now;
              updateData.marginEnabled = false;

              if (finalCash < 0) {
                updateData.isBankrupt = true;
                updateData.bankruptAt = now;
              }

              transaction.update(db.collection('users').doc(userDoc.id), updateData);

              // Log liquidation trade
              const tradeRef = db.collection('trades').doc();
              transaction.set(tradeRef, {
                uid: userDoc.id,
                action: 'margin_liquidation',
                totalValue: totalRecovered,
                marginDebt: freshMarginUsed,
                cashBefore: freshCash,
                cashAfter: finalCash,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
                automated: true
              });

              console.log(`Liquidated margin for ${userDoc.id}: recovered ${totalRecovered.toFixed(2)}, final cash ${finalCash.toFixed(2)}`);
            });

            liquidatedCount++;

            // Send Discord alert
            try {
              await sendDiscordMessage(null, [{
                title: '💥 Margin Liquidation',
                description: 'A trader was just **LIQUIDATED** by the margin system',
                color: 0xFF0000,
                timestamp: new Date().toISOString()
              }]);
            } catch (e) { reportError(e, { where: 'margin liquidation alert' }); }

          } catch (error) {
            console.error(`Failed to liquidate margin for ${userDoc.id}:`, error);
          }

        } else if (equityRatio <= LONG_MARGIN_CALL_THRESHOLD) {
          // MARGIN CALL
          const marginCallAt = userData.marginCallAt || 0;

          if (!marginCallAt) {
            // First margin call - set grace period
            await db.collection('users').doc(userDoc.id).update({
              marginCallAt: now
            });
            marginCallCount++;
          } else if (now >= marginCallAt + MARGIN_CALL_GRACE_PERIOD) {
            // Grace period expired - will liquidate on next check (equity will still be low)
            console.log(`Grace period expired for ${userDoc.id}, will liquidate on next cycle`);
          }

        } else if (userData.marginCallAt) {
          // Recovered from margin call
          await db.collection('users').doc(userDoc.id).update({
            marginCallAt: null
          });
        }
      }

      const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
      console.log(`Margin lending check: ${checkedCount} checked, ${liquidatedCount} liquidated, ${marginCallCount} new margin calls in ${elapsed}s`);
      return { checked: checkedCount, liquidated: liquidatedCount, marginCalls: marginCallCount };

    } catch (error) {
      console.error('Margin lending check failed:', error);
      return null;
    }
  });
