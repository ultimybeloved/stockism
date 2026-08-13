'use strict';

const functions = require('firebase-functions');
const { cf, requireAppCheck } = require('../fnConfig');
const admin = require('firebase-admin');
// Modular import (not admin.firestore.FieldValue): the emulator sandbox strips
// the namespaced statics, and this form works in both prod and sandbox.
const { FieldValue } = require('firebase-admin/firestore');
const db = admin.firestore();

const { CHARACTER_MAP, CHARACTERS } = require('../characters');
const {
  BID_ASK_SPREAD, ETF_BID_ASK_SPREAD, MIN_PRICE, DUST_MAX_VALUE, isWeeklyTradingHalt,
  TWENTY_FOUR_HOURS_MS, ONE_WEEK_MS, THIRTY_DAYS_MS, ANIMAL_TICKERS, UNIFIER_FULL_SHARE_MIN,
  DIVIDEND_DEMON_HOLD_MS,
} = require('../constants');
const { touchLastActive, lockedShares, reportError, checkDiscordWall, checkBanned, round2 } = require('../helpers');

const getSpread = (ticker) => (CHARACTER_MAP[ticker]?.isETF ? ETF_BID_ASK_SPREAD : BID_ASK_SPREAD);

/**
 * Dust cleanup: liquidate all of a user's tiny long positions (market value
 * below DUST_MAX_VALUE) to cash in a single pass.
 *
 * Why this exists and isn't just a "sell all" loop: the normal trade path only
 * accepts sell amounts of >= 0.01 shares in 0.01 steps, but holdings are stored
 * to 4 decimals. Sub-0.01-share slivers are therefore un-sellable and pile up as
 * "a few cents in every stock". This sweep sells at the current bid with no
 * price impact (the amounts are far below what moves the market) and clears the
 * whole position, slivers included.
 *
 * Deliberately NOT a trade: it does not touch trade history, trade counts, or
 * mission progress, so it can't be used to farm trade-count missions. Locked
 * shares (IPO / margin holds) are skipped entirely.
 */
exports.sweepDustPositions = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  // Selling dust is still selling — it follows the same halt rules as trades.
  if (isWeeklyTradingHalt()) {
    throw new functions.https.HttpsError('failed-precondition', 'Market is closed for the weekly halt.');
  }

  const uid = context.auth.uid;
  touchLastActive(uid, 'portfolio');

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  let result = { swept: 0, proceeds: 0 };

  try {
    await db.runTransaction(async (transaction) => {
      const userSnap = await transaction.get(userRef);
      if (!userSnap.exists) {
        throw new functions.https.HttpsError('not-found', 'User not found.');
      }
      const marketSnap = await transaction.get(marketRef);

      const userData = userSnap.data();
      if (userData.isBanned) {
        throw new functions.https.HttpsError('permission-denied', 'Account is banned.');
      }
      // Suspected-alt wall: a dust sweep converts shares to cash like any sell
      checkDiscordWall(userData);

      const marketData = marketSnap.exists ? marketSnap.data() : {};
      if (marketData.marketHalted) {
        throw new functions.https.HttpsError('failed-precondition', marketData.haltReason || 'Market is currently halted.');
      }

      const prices = marketData.prices || {};
      const haltedTickers = marketData.haltedTickers || {};
      const holdings = userData.holdings || {};
      const now = Date.now();

      let proceeds = 0;
      let swept = 0;
      const updates = {};

      for (const [ticker, sharesRaw] of Object.entries(holdings)) {
        const shares = sharesRaw || 0;
        if (shares <= 0) continue;

        const price = prices[ticker] != null ? prices[ticker] : (CHARACTER_MAP[ticker]?.basePrice || 0);
        if (!(price > 0)) continue;

        // Only tiny positions.
        if (shares * price >= DUST_MAX_VALUE) continue;

        // Skip tickers under a circuit-breaker halt.
        const tickerHalt = haltedTickers[ticker];
        if (tickerHalt && tickerHalt.resumeAt && now < tickerHalt.resumeAt) continue;

        // Never sweep locked shares (IPO lockup / margin-funded holds). If any
        // part of the position is locked, leave the whole thing alone.
        if (lockedShares(userData, ticker, now).total > 0) continue;

        const bid = Math.max(MIN_PRICE, round2(price * (1 - getSpread(ticker) / 2)));
        proceeds += bid * shares;
        swept++;

        updates[`holdings.${ticker}`] = FieldValue.delete();
        updates[`costBasis.${ticker}`] = FieldValue.delete();
        updates[`lowestWhileHolding.${ticker}`] = FieldValue.delete();
        // Position is fully closed — drop the dividend cohort like the normal
        // sell path does (also resets the ETF firstHeldAt clock).
        updates[`holdingCohorts.${ticker}`] = FieldValue.delete();
      }

      if (swept === 0) {
        result = { swept: 0, proceeds: 0 };
        return;
      }

      proceeds = round2(proceeds);
      updates.cash = FieldValue.increment(proceeds);
      updates.lastTradeTime = FieldValue.serverTimestamp();
      transaction.update(userRef, updates);

      result = { swept, proceeds };
    });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    reportError(err, { where: 'sweepDustPositions', uid });
    throw new functions.https.HttpsError('internal', 'Could not clean up dust.');
  }

  return { success: true, ...result };
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

  // Daily samples of cumulative granted value, so grants over any window up to
  // ~40 days can be worked out exactly. Percent return has to be measured net of
  // free money (see grantedValueUpdate in helpers.js), and the window differs by
  // caller — 7 days for the leaderboard, 30 for the admin readout, a whole arc
  // for a season. One number a day, capped, is cheaper than a subcollection.
  const grantedSamples = Array.isArray(userData.grantedSamples) ? userData.grantedSamples : [];
  const lastSample = grantedSamples[grantedSamples.length - 1];
  if (!lastSample || (now - lastSample.ts) >= TWENTY_FOUR_HOURS_MS) {
    updateData.grantedSamples = [...grantedSamples, { ts: now, total: userData.grantedValue || 0 }].slice(-40);
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
  const holdingCohorts = userData.holdingCohorts || {};
  const hasHeldETF50Days = Object.entries(holdingCohorts).some(([t, cohort]) => {
    const char = CHARACTERS.find(c => c.ticker === t);
    return char?.isETF && cohort?.firstHeldAt && (now - cohort.firstHeldAt >= DIVIDEND_DEMON_HOLD_MS);
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
