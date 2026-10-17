import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
// Modular import (not FieldValue): the emulator sandbox strips
// the namespaced statics, and this form works in both prod and sandbox.
import { FieldValue } from 'firebase-admin/firestore';
const db = admin.firestore();

import { CHARACTERS } from '../shared/characters';
import {
  TWENTY_FOUR_HOURS_MS,
  ONE_WEEK_MS,
  THIRTY_DAYS_MS,
  ANIMAL_TICKERS,
  UNIFIER_FULL_SHARE_MIN,
  DIVIDEND_DEMON_HOLD_MS,
} from '../shared/constants';
import { grantedSince, snapshotNetWorth } from '../shared/equity';
import { eventPositionsValue } from '../shared/lmsr';
import { checkDiscordWall, checkBanned } from '../shared/accountGuards';
import { getWeekId } from '../shared/tradeRecords';
import type { Cohort, ShortPosition } from '../shared/types';

type Holdings = Record<string, number>;

/**
 * Server-side portfolio sync
 * Updates portfolioValue, portfolioHistory, peakPortfolioValue, and achievements
 * Called by clients instead of writing these fields directly (blocked by security rules)
 */
export const syncPortfolio = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  }

  const uid = context.auth.uid;

  const userRef = db.collection('users').doc(uid);
  const marketRef = db.collection('market').doc('current');

  const [userDoc, marketDoc] = await Promise.all([userRef.get(), marketRef.get()]);

  if (!userDoc.exists) throw new functions.https.HttpsError('not-found', 'User not found.');
  if (!marketDoc.exists) throw new functions.https.HttpsError('not-found', 'Market data not found.');

  const userData = userDoc.data()!;
  checkBanned(userData);
  checkDiscordWall(userData);
  const prices: Record<string, number> = marketDoc.data()!.prices || {};
  const now = Date.now();

  // Rate limit: once per 30 seconds per user
  const lastSynced = userData.lastSynced || 0;
  if (now - lastSynced < 30000) {
    return {
      portfolioValue: userData.portfolioValue || 0,
      peakPortfolioValue: userData.peakPortfolioValue || 0,
      newAchievements: [],
      historyUpdated: false,
      rateLimited: true,
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
      rateLimited: true,
    };
  }

  // Calculate portfolio value
  const holdingsValue = Object.entries((userData.holdings || {}) as Holdings).reduce(
    (sum, [ticker, shares]) => sum + (prices[ticker] || 0) * shares,
    0,
  );

  const shortsValue = Object.entries((userData.shorts || {}) as Record<string, ShortPosition | null>).reduce(
    (sum, [ticker, position]) => {
      if (!position || typeof position !== 'object') return sum;
      const shares = position.shares || 0;
      if (shares <= 0) return sum;
      const costBasis = position.costBasis || position.entryPrice || 0;
      const currentPrice = prices[ticker] || costBasis;
      const margin = position.margin || costBasis * shares * 0.5;
      if ((position.system || 'v2') === 'v2') {
        // v2: margin + unrealized P&L (no proceeds in cash)
        return sum + margin + (costBasis - currentPrice) * shares;
      }
      // Legacy: margin collateral - cost to buy back shares
      return sum + margin - currentPrice * shares;
    },
    0,
  );

  const portfolioValue = Math.round(((userData.cash || 0) + holdingsValue + shortsValue) * 100) / 100;

  const updateData: Record<string, unknown> = {
    portfolioValue,
    lastSynced: now,
    // Track hourly sync count
    syncCountHour: now - syncHourStart >= oneHour ? 1 : syncCount + 1,
    syncHourStart: now - syncHourStart >= oneHour ? now : syncHourStart,
  };

  // Long-term market positions at sell-back value, counted in net worth. Only
  // players with an open position (or a stale value to clear) pay the extra read.
  const openEvent = Object.values(userData.eventPositions || {}).some(
    (p) => p && !(p as { settled?: boolean }).settled,
  );
  let eventValue = 0;
  if (openEvent) {
    const predSnap = await db.collection('predictions').doc('current').get();
    eventValue = eventPositionsValue(userData.eventPositions, predSnap.exists ? predSnap.data()!.list || [] : []);
  }
  if (openEvent || userData.eventPositionsValue) updateData.eventPositionsValue = eventValue;

  // Initialize weekly mission startPortfolioValue if not set
  const syncWeekId = getWeekId();
  const weeklyData = userData.weeklyMissions?.[syncWeekId];
  if (!weeklyData || weeklyData.startPortfolioValue === undefined) {
    updateData[`weeklyMissions.${syncWeekId}.startPortfolioValue`] = portfolioValue;
  }
  // Free money received from here on is taken out of the growth missions
  // (missionChecks.earnedGrowthPct).
  if (!weeklyData || weeklyData.startGrantedValue === undefined) {
    updateData[`weeklyMissions.${syncWeekId}.startGrantedValue`] = userData.grantedValue || 0;
  }
  // Debt at the start of the week, so the growth missions measure net worth.
  if (!weeklyData || weeklyData.startMarginUsed === undefined) {
    updateData[`weeklyMissions.${syncWeekId}.startMarginUsed`] = userData.marginUsed || 0;
  }

  // What the player is actually worth: portfolioValue counts stock bought with
  // borrowed money but not the loan. Peak value (which sets the margin tier) and
  // the value achievements use this, so borrowing can't unlock more borrowing or
  // award "broke $10K" on someone else's money (2026-10-13).
  const netWorth = Math.round((portfolioValue - (userData.marginUsed || 0)) * 100) / 100;

  // Track lowest price while holding for Diamond Hands achievement
  const holdings: Record<string, number> = userData.holdings || {};
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
  const peakPortfolioValue = Math.max(userData.peakPortfolioValue || 0, netWorth);
  if (peakPortfolioValue > (userData.peakPortfolioValue || 0)) {
    updateData.peakPortfolioValue = peakPortfolioValue;
  }

  // Update portfolio history — permanent subcollection, no cap
  const lastRecord = userData.lastPortfolioSnapshot || null;
  const tenMinutes = 10 * 60 * 1000;

  const valueChanged =
    lastRecord && lastRecord.value > 0 && Math.abs(portfolioValue - lastRecord.value) / lastRecord.value > 0.01;
  const timeElapsed = !lastRecord || now - lastRecord.timestamp > tenMinutes;

  let historyWritten = false;
  if (!lastRecord || timeElapsed || valueChanged) {
    // The debt rides along so public views can show net worth (snapshotNetWorth).
    await userRef.collection('portfolioHistory').add({
      timestamp: now,
      value: portfolioValue,
      marginUsed: userData.marginUsed || 0,
      eventPositionsValue: eventValue,
    });
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
  if (!lastSample || now - lastSample.ts >= TWENTY_FOUR_HOURS_MS) {
    updateData.grantedSamples = [...grantedSamples, { ts: now, total: userData.grantedValue || 0 }].slice(-40);
  }

  // Rolling reference snapshots — used by leaderboard and dashboard
  const snap24h = userData.portfolioSnapshot24h;
  // marginUsed is recorded so the weekly-gain boards can measure net worth at
  // both ends (a margin buy is not a gain).
  if (!snap24h || now - snap24h.timestamp >= TWENTY_FOUR_HOURS_MS) {
    updateData.portfolioSnapshot24h = { timestamp: now, value: portfolioValue, marginUsed: userData.marginUsed || 0 };
  }
  const snap7d = userData.portfolioSnapshot7d;
  if (!snap7d || now - snap7d.timestamp >= ONE_WEEK_MS) {
    updateData.portfolioSnapshot7d = { timestamp: now, value: portfolioValue, marginUsed: userData.marginUsed || 0 };
  }
  // 30-day reference is the user's ACTUAL portfolio value ~30 days ago, read
  // from the permanent portfolioHistory. Refreshed at most once a day so the
  // window slides without querying history on every sync (one read/user/day).
  const snap30d = userData.portfolioSnapshot30d;
  if (!snap30d || now - (snap30d.refreshedAt || 0) >= TWENTY_FOUR_HOURS_MS) {
    try {
      const cutoff = now - THIRTY_DAYS_MS;
      const atOrBefore = await userRef
        .collection('portfolioHistory')
        .where('timestamp', '<=', cutoff)
        .orderBy('timestamp', 'desc')
        .limit(1)
        .get();
      let value;
      if (!atOrBefore.empty) {
        value = atOrBefore.docs[0]!.data()!.value;
      } else {
        // Account younger than 30 days — compare against the earliest point on record.
        const earliest = await userRef.collection('portfolioHistory').orderBy('timestamp', 'asc').limit(1).get();
        value = earliest.empty ? portfolioValue : earliest.docs[0]!.data()!.value;
      }
      updateData.portfolioSnapshot30d = { refreshedAt: now, value };
    } catch (e) {
      // Non-fatal — keep the existing snapshot rather than blocking the sync.
      logger.error('30d snapshot refresh failed:', (e as Error).message);
    }
  }

  // Prune stale mission-progress keys so the user doc doesn't grow forever
  // (one map entry per active day/week otherwise accumulates for the account's
  // lifetime). Keys are YYYY-MM-DD strings, so a lexicographic sort is
  // chronological. Anything older than the 2 most recent can't be claimed.
  const pruneMissionMap = (map: Record<string, unknown> | undefined, field: string) => {
    const keys = Object.keys(map || {}).sort();
    keys.slice(0, Math.max(0, keys.length - 2)).forEach((k) => {
      updateData[`${field}.${k}`] = FieldValue.delete();
    });
  };
  pruneMissionMap(userData.dailyMissions, 'dailyMissions');
  pruneMissionMap(userData.weeklyMissions, 'weeklyMissions');

  // Check achievements
  const currentAchievements = userData.achievements || [];
  const newAchievements = [];
  const revokedAchievements = [];
  const holdingsCount = Object.values((userData.holdings || {}) as Holdings).filter((shares) => shares > 0).length;
  const totalTrades = userData.totalTrades || 0;

  if (totalTrades >= 1 && !currentAchievements.includes('FIRST_BLOOD')) newAchievements.push('FIRST_BLOOD');
  if (totalTrades >= 20 && !currentAchievements.includes('TRADER_20')) newAchievements.push('TRADER_20');
  if (totalTrades >= 100 && !currentAchievements.includes('TRADER_100')) newAchievements.push('TRADER_100');
  if (netWorth >= 2500 && !currentAchievements.includes('BROKE_2K')) newAchievements.push('BROKE_2K');
  if (netWorth >= 5000 && !currentAchievements.includes('BROKE_5K')) newAchievements.push('BROKE_5K');
  if (netWorth >= 10000 && !currentAchievements.includes('BROKE_10K')) newAchievements.push('BROKE_10K');
  if (netWorth >= 25000 && !currentAchievements.includes('BROKE_25K')) newAchievements.push('BROKE_25K');
  if (netWorth >= 50000 && !currentAchievements.includes('BROKE_50K')) newAchievements.push('BROKE_50K');
  if (netWorth >= 100000 && !currentAchievements.includes('BROKE_100K')) newAchievements.push('BROKE_100K');
  if (netWorth >= 250000 && !currentAchievements.includes('BROKE_250K')) newAchievements.push('BROKE_250K');
  if (netWorth >= 500000 && !currentAchievements.includes('BROKE_500K')) newAchievements.push('BROKE_500K');
  if (netWorth >= 1000000 && !currentAchievements.includes('BROKE_1M')) newAchievements.push('BROKE_1M');
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
  const launchedTickers = marketDoc.data()!.launchedTickers || [];
  const tradeableCharacters = CHARACTERS.filter(
    (c) => !c.isETF && (!c.ipoRequired || launchedTickers.includes(c.ticker)),
  );
  const totalCharacters = tradeableCharacters.length;
  const characterTickers = new Set(tradeableCharacters.map((c) => c.ticker));
  const ownedCharacterCount = Object.entries((userData.holdings || {}) as Holdings).filter(
    ([ticker, shares]) => shares >= UNIFIER_FULL_SHARE_MIN && characterTickers.has(ticker),
  ).length;
  const qualifiesForUnifier = ownedCharacterCount >= totalCharacters && totalCharacters > 0;
  if (qualifiesForUnifier && !currentAchievements.includes('UNIFIER')) {
    newAchievements.push('UNIFIER');
  } else if (!qualifiesForUnifier && currentAchievements.includes('UNIFIER')) {
    revokedAchievements.push('UNIFIER');
  }

  // NPC Lover: check if accumulated profit reached $1,000
  if ((userData.npcProfit || 0) >= 1000 && !currentAchievements.includes('NPC_LOVER'))
    newAchievements.push('NPC_LOVER');

  // Plugged In: awarded to users who have linked their Discord
  if (userData.discordId && !currentAchievements.includes('DISCORD_LINKED')) newAchievements.push('DISCORD_LINKED');

  // Check leaderboard achievements (server-side, no client trust needed)
  const MIN_PORTFOLIO_FOR_LEADERBOARD = 5000;
  if (netWorth >= MIN_PORTFOLIO_FOR_LEADERBOARD && !currentAchievements.includes('TOP_1')) {
    try {
      const topSnap = await db.collection('users').orderBy('portfolioValue', 'desc').limit(10).get();

      const topUsers: string[] = [];
      topSnap.forEach((doc) => {
        const d = doc.data()!;
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
      logger.error('Leaderboard achievement check failed:', err);
    }
  }

  // Compute and store weekly gain for Profit Champion. Measured like the Top
  // Gainers board: net worth at both ends (margin debt off) and free money
  // received this week taken out. Until 2026-10-14 it was gross, so a margin
  // buy or a week of grants could win it without a single profitable trade.
  const snap7dRef = (userData.portfolioSnapshot7d || updateData.portfolioSnapshot7d) as
    { value?: number; marginUsed?: number } | undefined;
  const valueSevenDaysAgo = snap7dRef ? snapshotNetWorth(snap7dRef, userData.marginUsed || 0) : netWorth;
  const weeklyGain = Math.round((netWorth - grantedSince(userData, ONE_WEEK_MS) - valueSevenDaysAgo) * 100) / 100;
  updateData.weeklyGain = weeklyGain;

  // Check Profit Champion: #1 in weekly gains
  if (weeklyGain > 0 && !currentAchievements.includes('PROFIT_CHAMPION')) {
    try {
      const topGainerSnap = await db.collection('users').orderBy('weeklyGain', 'desc').limit(1).get();
      if (!topGainerSnap.empty) {
        const topDoc = topGainerSnap.docs[0]!;
        const topGain = topDoc.data()!.weeklyGain || 0;
        // Award if user's new gain beats the current top (or they ARE the current top)
        if (topDoc.id === uid || weeklyGain > topGain) {
          newAchievements.push('PROFIT_CHAMPION');
        }
      }
    } catch (err) {
      logger.error('Profit Champion check failed:', err);
    }
  }

  // Check checkin achievements (server-side)
  const totalCheckins = userData.totalCheckins || 0;
  if (totalCheckins >= 7 && !currentAchievements.includes('DEDICATED_7')) newAchievements.push('DEDICATED_7');
  if (totalCheckins >= 14 && !currentAchievements.includes('DEDICATED_14')) newAchievements.push('DEDICATED_14');
  if (totalCheckins >= 30 && !currentAchievements.includes('DEDICATED_30')) newAchievements.push('DEDICATED_30');
  if (totalCheckins >= 100 && !currentAchievements.includes('DEDICATED_100')) newAchievements.push('DEDICATED_100');

  // You're a Worker: gained 25%+ of net worth in a week
  const weeklyGainPercent = valueSevenDaysAgo > 0 ? (weeklyGain / valueSevenDaysAgo) * 100 : 0;
  if (weeklyGainPercent >= 25 && weeklyGain > 0 && !currentAchievements.includes('YOURE_A_WORKER'))
    newAchievements.push('YOURE_A_WORKER');

  // Dividend Demon: held any ETF for 50 consecutive days
  const holdingCohorts: Record<string, Cohort> = userData.holdingCohorts || {};
  const hasHeldETF50Days = Object.entries(holdingCohorts).some(([t, cohort]) => {
    const char = CHARACTERS.find((c) => c.ticker === t);
    return char?.isETF && cohort?.firstHeldAt && now - cohort.firstHeldAt >= DIVIDEND_DEMON_HOLD_MS;
  });
  if (hasHeldETF50Days && !currentAchievements.includes('DIVIDEND_DEMON')) newAchievements.push('DIVIDEND_DEMON');

  // Animal Instinct: check cumulative profit in case it was already tracked
  const pbt = userData.profitByTicker || {};
  const totalAnimalProfit = [...ANIMAL_TICKERS].reduce((s, t) => s + (pbt[t] || 0), 0);
  if (totalAnimalProfit >= 250 && !currentAchievements.includes('ANIMAL_INSTINCT'))
    newAchievements.push('ANIMAL_INSTINCT');

  if (newAchievements.length > 0) {
    updateData.achievements = FieldValue.arrayUnion(...newAchievements);
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
      updateData.bankruptAt = FieldValue.delete();
    }
  }

  await userRef.update(updateData);

  // Revocations go in a separate write — Firestore forbids mixing arrayUnion
  // and arrayRemove on the same field in one update. Also drop any revoked
  // achievement from the displayed pins so it can't keep occupying a profile
  // slot the user can no longer see to free up.
  if (revokedAchievements.length > 0) {
    await userRef.update({
      achievements: FieldValue.arrayRemove(...revokedAchievements),
      displayedAchievementPins: FieldValue.arrayRemove(...revokedAchievements),
    });
  }

  return {
    portfolioValue,
    peakPortfolioValue,
    newAchievements,
    revokedAchievements,
    historyUpdated: historyWritten,
  };
});
