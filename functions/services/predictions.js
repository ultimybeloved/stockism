'use strict';
const functions = require('firebase-functions');
const admin = require('firebase-admin');
const db = admin.firestore();
const { CHARACTERS } = require('../characters');
const { isWeeklyTradingHalt, IPO_PRICE_JUMP } = require('../constants');
const { checkBanned, checkDiscordWall, sendDiscordMessage, getTotalInvested, writeNotification, reportError, applyDueIPOJumps } = require('../helpers');

exports.placeBet = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { predictionId, option, amount } = data;

  if (!predictionId || !option || !amount || !Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid bet data.');
  }

  const userRef = db.collection('users').doc(uid);
  const predictionsRef = db.collection('predictions').doc('current');

  return db.runTransaction(async (transaction) => {
    const [userDoc, predictionsDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(predictionsRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!predictionsDoc.exists) throw new functions.https.HttpsError('not-found', 'Predictions not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    const predictionsData = predictionsDoc.data();
    const predictionsList = predictionsData.list || [];

    // Find the prediction
    const predictionIndex = predictionsList.findIndex(p => p.id === predictionId);
    if (predictionIndex === -1) throw new functions.https.HttpsError('not-found', 'Prediction not found.');

    const prediction = predictionsList[predictionIndex];
    if (prediction.resolved || (prediction.endsAt && prediction.endsAt < Date.now())) {
      throw new functions.https.HttpsError('failed-precondition', 'Betting has ended.');
    }

    // Check cash
    if ((userData.cash || 0) < amount) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    // Check bet limit (can't bet more than total invested value)
    const totalInvested = getTotalInvested(userData);

    if (totalInvested <= 0) {
      throw new functions.https.HttpsError('failed-precondition', 'Must invest in stocks before betting.');
    }

    // Enforce bet limit: can't bet more than total invested or available cash
    const betLimit = Math.min(totalInvested, userData.cash || 0);
    const existingBetOnThis = userData.bets?.[predictionId]?.amount || 0;
    if (amount > betLimit - existingBetOnThis) {
      throw new functions.https.HttpsError('failed-precondition',
        `Bet exceeds limit. Max: $${Math.max(0, betLimit - existingBetOnThis).toFixed(2)}`);
    }

    // Check existing bet on different option
    const existingBet = userData.bets?.[predictionId];
    if (existingBet && existingBet.option !== option) {
      throw new functions.https.HttpsError('failed-precondition', 'Already bet on a different option.');
    }

    // Update prediction pools
    const updatedList = [...predictionsList];
    const updatedPrediction = { ...updatedList[predictionIndex] };
    const newPools = { ...(updatedPrediction.pools || {}) };
    newPools[option] = (newPools[option] || 0) + amount;
    updatedPrediction.pools = newPools;
    updatedList[predictionIndex] = updatedPrediction;

    const newBetAmount = (existingBet?.amount || 0) + amount;
    const today = new Date().toISOString().split('T')[0];

    transaction.update(predictionsRef, { list: updatedList });
    transaction.update(userRef, {
      cash: (userData.cash || 0) - amount,
      [`bets.${predictionId}`]: {
        option,
        amount: newBetAmount,
        placedAt: Date.now(),
        question: prediction.question
      },
      [`dailyMissions.${today}.placedBet`]: true
    });

    return { success: true, newBetAmount };
  });
});

/**
 * Claim prediction payout (winning or losing)
 */
exports.claimPredictionPayout = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;
  const { predictionId } = data;

  if (!predictionId) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing prediction ID.');
  }

  const userRef = db.collection('users').doc(uid);
  const predictionsRef = db.collection('predictions').doc('current');

  let predictionLabel = 'your prediction';
  const result = await db.runTransaction(async (transaction) => {
    const [userDoc, predictionsDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(predictionsRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!predictionsDoc.exists) throw new functions.https.HttpsError('not-found', 'Predictions not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    const predictionsData = predictionsDoc.data();
    const predictionsList = predictionsData.list || [];

    const prediction = predictionsList.find(p => p.id === predictionId);
    if (!prediction) throw new functions.https.HttpsError('not-found', 'Prediction not found.');
    if (!prediction.resolved) throw new functions.https.HttpsError('failed-precondition', 'Not resolved yet.');
    predictionLabel = prediction.question || prediction.title || predictionLabel;

    const userBet = userData.bets?.[predictionId];
    if (!userBet) throw new functions.https.HttpsError('not-found', 'No bet found.');
    if (userBet.paid) throw new functions.https.HttpsError('already-exists', 'Already paid out.');

    const updates = {};

    const winningOutcomes = prediction.outcomes || (prediction.outcome ? [prediction.outcome] : []);
    if (winningOutcomes.includes(userBet.option)) {
      // Winner - calculate payout
      const options = prediction.options || ['Yes', 'No'];
      const pools = prediction.pools || {};
      const winningPool = winningOutcomes.reduce((sum, opt) => sum + (pools[opt] || 0), 0);
      const totalPool = options.reduce((sum, opt) => sum + (pools[opt] || 0), 0);

      let payout = userBet.amount;
      if (winningPool > 0 && totalPool > 0) {
        const userShare = userBet.amount / winningPool;
        payout = userShare * totalPool;
      }

      const newPredictionWins = (userData.predictionWins || 0) + 1;
      updates.cash = (userData.cash || 0) + payout;
      updates[`bets.${predictionId}.paid`] = true;
      updates[`bets.${predictionId}.payout`] = payout;
      updates.predictionWins = newPredictionWins;

      // Check achievements
      const achievements = userData.achievements || [];
      const predictionAchievements = [];
      if (newPredictionWins >= 10 && !achievements.includes('PROPHET')) predictionAchievements.push('PROPHET');
      else if (newPredictionWins >= 3 && !achievements.includes('ORACLE')) predictionAchievements.push('ORACLE');

      // Underdog: win when <20% of the pool backed the winning side
      if (winningPool > 0 && totalPool > 0 && (winningPool / totalPool) < 0.20 && !achievements.includes('UNDERDOG')) {
        predictionAchievements.push('UNDERDOG');
      }

      if (predictionAchievements.length > 0) {
        updates.achievements = admin.firestore.FieldValue.arrayUnion(...predictionAchievements);
        for (const achId of predictionAchievements) {
          updates[`achievementDates.${achId}`] = Date.now();
        }
      }

      transaction.update(userRef, updates);
      return { success: true, won: true, payout, newPredictionWins };
    } else {
      // Loser - mark as processed
      transaction.update(userRef, {
        [`bets.${predictionId}.paid`]: true,
        [`bets.${predictionId}.payout`]: 0
      });
      return { success: true, won: false, payout: 0 };
    }
  });

  // Persistent bell notification for winners (stays until manually cleared)
  if (result.won) {
    await writeNotification(uid, {
      type: 'system',
      title: 'Prediction Payout',
      message: `You won $${Math.round(result.payout).toLocaleString()} on "${predictionLabel}".`,
      data: { predictionId }
    });
  }

  return result;
});

/**
 * Buy IPO shares
 */
exports.buyIPOShares = functions.https.onCall(async (data, context) => {
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
  const { ticker, quantity } = data;

  if (!ticker || !quantity || !Number.isFinite(quantity) || quantity < 0.01 || Math.round(quantity * 100) / 100 !== quantity) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid IPO purchase data.');
  }

  const validTicker = CHARACTERS.some(c => c.ticker === ticker);
  if (!validTicker) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid ticker.');
  }

  const userRef = db.collection('users').doc(uid);
  const ipoRef = db.collection('market').doc('ipos');
  const marketRef = db.collection('market').doc('current');

  const result = await db.runTransaction(async (transaction) => {
    const [userDoc, ipoDoc, marketDoc] = await Promise.all([
      transaction.get(userRef),
      transaction.get(ipoRef),
      transaction.get(marketRef)
    ]);

    if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
    if (!ipoDoc.exists) throw new functions.https.HttpsError('not-found', 'IPO data not found.');

    const userData = userDoc.data();
    checkBanned(userData);
    checkDiscordWall(userData);
    const ipoData = ipoDoc.data();
    const ipoList = ipoData.list || [];

    const ipo = ipoList.find(i => i.ticker === ticker);
    if (!ipo) throw new functions.https.HttpsError('not-found', 'IPO not found.');

    const maxPerUser = ipo.maxPerUser || 10;

    // Validate quantity against per-IPO limit
    if (quantity > maxPerUser) {
      throw new functions.https.HttpsError('invalid-argument', `Max ${maxPerUser} shares per user.`);
    }

    // Validate IPO is active
    const now = Date.now();
    if (!ipo.ipoStartsAt || now < ipo.ipoStartsAt || now > ipo.ipoEndsAt) {
      throw new functions.https.HttpsError('failed-precondition', 'IPO is not active.');
    }

    // Check shares remaining
    const sharesRemaining = ipo.sharesRemaining || 0;
    if (quantity > sharesRemaining) {
      throw new functions.https.HttpsError('failed-precondition', 'Not enough shares available.');
    }

    // Check per-user limit
    const userIPOPurchases = userData.ipoPurchases?.[ticker] || 0;
    if (userIPOPurchases + quantity > maxPerUser) {
      throw new functions.https.HttpsError('failed-precondition', `Exceeds per-user IPO limit (${maxPerUser}).`);
    }

    // Check cash
    const totalCost = ipo.basePrice * quantity;
    if ((userData.cash || 0) < totalCost) {
      throw new functions.https.HttpsError('failed-precondition', 'Insufficient funds.');
    }

    // Calculate new cost basis
    const currentHoldings = userData.holdings?.[ticker] || 0;
    const currentCostBasis = userData.costBasis?.[ticker] || ipo.basePrice;
    const newHoldings = currentHoldings + quantity;
    const newCostBasis = currentHoldings > 0
      ? (newHoldings > 0 ? ((currentCostBasis * currentHoldings) + (ipo.basePrice * quantity)) / newHoldings : ipo.basePrice)
      : ipo.basePrice;

    // Update user
    transaction.update(userRef, {
      cash: (userData.cash || 0) - totalCost,
      [`holdings.${ticker}`]: newHoldings,
      [`costBasis.${ticker}`]: Math.round(newCostBasis * 100) / 100,
      [`ipoPurchases.${ticker}`]: userIPOPurchases + quantity,
      [`lastBuyTime.${ticker}`]: now,
      totalTrades: (userData.totalTrades || 0) + 1
    });

    // Update IPO shares remaining
    const newSharesRemaining = sharesRemaining - quantity;
    const soldOut = newSharesRemaining <= 0;

    const updatedList = ipoList.map(i =>
      i.ticker === ticker ? { ...i, sharesRemaining: newSharesRemaining, ...(soldOut ? { priceJumped: true } : {}) } : i
    );
    transaction.update(ipoRef, { list: updatedList });

    // If sold out, immediately apply price jump and launch into normal trading
    if (soldOut) {
      const newPrice = Math.round(ipo.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;
      transaction.update(marketRef, {
        [`prices.${ticker}`]: newPrice,
        [`priceHistory.${ticker}`]: admin.firestore.FieldValue.arrayUnion({
          timestamp: now,
          price: newPrice
        }),
        launchedTickers: admin.firestore.FieldValue.arrayUnion(ticker)
      });
    } else if (marketDoc.exists) {
      // Initialize price if not set
      const marketData = marketDoc.data();
      if (!marketData.prices?.[ticker]) {
        transaction.update(marketRef, {
          [`prices.${ticker}`]: ipo.basePrice,
          [`volumes.${ticker}`]: quantity
        });
      }
    }

    return { success: true, totalCost, newHoldings, soldOut, ticker: ipo.ticker, basePrice: ipo.basePrice, ipoTotalShares: ipo.totalShares || 150 };
  });

  // Send Discord alert after transaction if sold out
  if (result.soldOut) {
    try {
      const newPrice = Math.round(result.basePrice * (1 + IPO_PRICE_JUMP) * 100) / 100;
      await sendDiscordMessage(null, [{
        title: '🎉 IPO Sold Out!',
        description: `**${result.ticker}** IPO sold out! Price jumped to $${newPrice.toFixed(2)} — now trading normally.`,
        color: 0x00FF00,
        fields: [
          { name: 'Shares Sold', value: `${result.ipoTotalShares}/${result.ipoTotalShares}`, inline: true },
          { name: 'New Price', value: `$${newPrice.toFixed(2)}`, inline: true }
        ],
        timestamp: new Date().toISOString()
      }]);
    } catch (e) { reportError(e, { where: 'IPO sold-out alert' }); }
  }

  return result;
});

/**
 * Process IPO Price Jumps - Scheduled every 5 minutes
 * Checks for ended IPOs that haven't had their price jump applied
 */
exports.processIPOPriceJumps = functions.pubsub
  .schedule('every 5 minutes')
  .timeZone('UTC')
  .onRun(async (context) => {
    if (isWeeklyTradingHalt()) {
      console.log('Skipping IPO price jumps — weekly trading halt active');
      return null;
    }

    try {
      // Check emergency halt
      const marketSnap = await db.collection('market').doc('current').get();
      if (marketSnap.exists && marketSnap.data().marketHalted) {
        console.log('Skipping IPO price jumps — emergency halt active');
        return null;
      }

      // Shared jump logic (helpers.applyDueIPOJumps) — also run by the
      // pre-market auction at 20:56 Thursday so jumps land before opening prices.
      const discordNotifications = await applyDueIPOJumps();
      if (discordNotifications.length > 0) {
        console.log(`Processed ${discordNotifications.length} IPO price jumps`);
      }

      // Send Discord notifications outside transaction (non-critical)
      for (const n of discordNotifications) {
        try {
          await sendDiscordMessage(null, [{
            title: '🎉 IPO Closed',
            description: `**${n.ticker}** IPO has ended! Price jumped to $${n.newPrice.toFixed(2)}`,
            color: 0x00FF00,
            fields: [
              { name: 'Shares Sold', value: `${n.sharesSold}/${n.ipoTotalShares}`, inline: true },
              { name: 'New Price', value: `$${n.newPrice.toFixed(2)}`, inline: true }
            ],
            timestamp: new Date().toISOString()
          }]);
        } catch (e) { reportError(e, { where: 'IPO closed alert' }); }
      }

      return { processed: discordNotifications.length };
    } catch (error) {
      reportError(error, { where: 'processIPOPriceJumps' });
      return null;
    }
  });

/**
 * Remove an achievement from a user (admin only)
 * Used to clean up achievements awarded due to glitches
 */
