import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();
import type { DocumentData, Query } from 'firebase-admin/firestore';
// Rank counting lives in shared/equity — shared with the Discord bot's /profile.
import { countRankAbove, grantedSince, netReturnPercent } from '../shared/equity';

import {
  LEADERBOARD_CACHE_TTL,
  ADMIN_UID,
  FOURTEEN_DAYS_MS,
  THIRTY_DAYS_MS,
  ONE_WEEK_MS,
  PUBLIC_PROFILE_SPARKLINE_MAX_POINTS,
  LEADERBOARD_PERCENT_MIN_BASELINE,
} from '../shared/constants';

// In-memory cache — persists across invocations on same instance
type BoardEntry = DocumentData & { userId: string };
const leaderboardCache: Record<string, { data: BoardEntry[]; timestamp: number }> = {};

// Fields the leaderboard actually displays — projected with .select() so we
// never pull heavy unused maps (holdings is needed for holdingsCount).
const LEADERBOARD_FIELDS = [
  'displayName',
  'portfolioValue',
  'crew',
  'isCrewHead',
  'crewHeadColor',
  'holdings',
  'displayCrewPin',
  'displayedAchievementPins',
  'achievements',
  'displayedShopPins',
  'previousDisplayName',
  'nameChangedAt',
  'activeCosmetics',
  'isPublic',
  'isBot',
  'portfolioSnapshot7d',
  // Season title: the equipped id plus the label it resolves to.
  'activeTitle',
  // Needed to net free money out of the percent board — see grantedSince.
  'grantedValue',
  'grantedSamples',
  // Ownership lists — fetched only to validate the display fields below;
  // never included in the payload sent to clients.
  'ownedShopPins',
  'ownedCosmetics',
  'ownedTitles',
  'titleMeta',
];

// Players write displayedShopPins / displayedAchievementPins / activeCosmetics
// directly from the client (they're on the user-doc rules allowlist), so
// nothing stops a raw Firestore write from flaunting pins or paid cosmetics
// the player never earned/bought — or from stuffing junk types that would
// crash rendering clients. Every public payload runs through this filter:
// only owned/earned items survive, and malformed values collapse to empties.
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sanitizeDisplayFields = (userData: DocumentData) => {
  const achievements = asArray(userData.achievements);
  const ownedPins = asArray(userData.ownedShopPins);
  const ownedCosmetics = asArray(userData.ownedCosmetics);
  const active = userData.activeCosmetics;
  let activeCosmetics: Record<string, unknown> | null = null;
  if (active && typeof active === 'object' && !Array.isArray(active)) {
    activeCosmetics = {};
    for (const [slot, id] of Object.entries(active)) {
      // null = explicitly unequipped (kept); anything else must be owned.
      if (id == null || (typeof id === 'string' && ownedCosmetics.includes(id))) {
        activeCosmetics[slot] = id;
      }
    }
  }
  // Season title. Same deal as the pins: activeTitle is client-writable, so it
  // only survives if the server actually granted it (adminEndSeason writes both
  // ownedTitles and the titleMeta label at the same moment).
  const ownedTitles = asArray(userData.ownedTitles);
  const activeTitle = userData.activeTitle;
  const titleMeta = userData.titleMeta && typeof userData.titleMeta === 'object' ? userData.titleMeta : {};
  const title =
    typeof activeTitle === 'string' && ownedTitles.includes(activeTitle)
      ? { id: activeTitle, text: titleMeta[activeTitle] || activeTitle }
      : null;

  return {
    displayedAchievementPins: asArray(userData.displayedAchievementPins).filter((id) => achievements.includes(id)),
    displayedShopPins: asArray(userData.displayedShopPins).filter((id) => ownedPins.includes(id)),
    activeCosmetics,
    title,
  };
};

export const getLeaderboard = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  try {
    const { crew, sortBy = 'value' } = data || {};
    // Two weekly-gain sorts: 'weeklyGain' (dollars) and 'weeklyGainPercent'.
    const gainSort = sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent';
    const cacheKey = crew ? (gainSort ? `${sortBy}_${crew}` : crew) : gainSort ? sortBy : 'global';
    const docRef = db.collection('leaderboard').doc(cacheKey);

    // Layer 1: in-memory cache (this warm instance). Layer 2: the shared
    // Firestore doc — written on every recompute so clients (and other
    // instances) can read the same result directly without recomputing.
    let leaderboard: BoardEntry[] | undefined;
    const cached = leaderboardCache[cacheKey];
    if (cached && Date.now() - cached.timestamp < LEADERBOARD_CACHE_TTL) {
      leaderboard = cached.data;
    }
    if (!leaderboard) {
      const docSnap = await docRef.get();
      if (docSnap.exists && Date.now() - (docSnap.data()!.generatedAt || 0) < LEADERBOARD_CACHE_TTL) {
        leaderboard = docSnap.data()!.entries || [];
        leaderboardCache[cacheKey] = { data: leaderboard!, timestamp: docSnap.data()!.generatedAt };
      }
    }
    if (!leaderboard) {
      if (gainSort) {
        let query: Query = db.collection('users');
        if (crew) {
          query = query.where('crew', '==', crew);
        }
        // Dollar-gain board: top 200 by value is a fine pool (big dollar gains
        // need big portfolios). Percent board: full scan — its whole point is
        // surfacing small accounts that a value-ordered pool would exclude.
        if (sortBy === 'weeklyGain') {
          query = query.orderBy('portfolioValue', 'desc').limit(200);
        }
        query = query.select(...LEADERBOARD_FIELDS);

        const snapshot = await query.get();
        const twoWeeksAgo = Date.now() - FOURTEEN_DAYS_MS;

        const allUsers: BoardEntry[] = [];
        snapshot.forEach((doc) => {
          const userData = doc.data()!;
          // Banned accounts stay in Firestore (the ban record is evidence) but
          // must not keep a board slot — a wiped account otherwise shows up as a
          // huge percentage loss on the movers board.
          if (userData.isBot || userData.isBanned) return;

          if (!userData.portfolioSnapshot7d || userData.portfolioSnapshot7d.timestamp < twoWeeksAgo) return;

          const currentValue = userData.portfolioValue || 0;
          const valueSevenDaysAgo = userData.portfolioSnapshot7d.value;

          // Percent board only: baseline floor keeps near-zero accounts from
          // topping the board with meaningless huge percentages.
          if (sortBy === 'weeklyGainPercent' && valueSevenDaysAgo < LEADERBOARD_PERCENT_MIN_BASELINE) return;

          // Net of free money. Without this the percent board ranks faucet
          // collection, not trading: measured 2026-08-13, the median player was
          // +67% over 30 days while the median stock moved +0.8%, and the top of
          // this board was accounts sitting on a $1,000 baseline plus grants.
          // Reads 0 until grantedSamples cover the window — never over-subtracts.
          const granted = grantedSince(userData, ONE_WEEK_MS);
          const weeklyGain = currentValue - granted - valueSevenDaysAgo;
          const weeklyGainPercent = netReturnPercent(currentValue, valueSevenDaysAgo, granted);

          const holdingsCount = userData.holdings
            ? Object.keys(userData.holdings).filter((k) => userData.holdings[k] > 0).length
            : 0;

          allUsers.push({
            userId: doc.id,
            displayName: userData.displayName || 'Anonymous',
            portfolioValue: currentValue,
            crew: userData.crew || null,
            isCrewHead: userData.isCrewHead || false,
            crewHeadColor: userData.crewHeadColor || null,
            holdingsCount,
            displayCrewPin: userData.displayCrewPin ?? null,
            ...sanitizeDisplayFields(userData),
            achievements: asArray(userData.achievements),
            weeklyGain,
            weeklyGainPercent: Math.round(weeklyGainPercent * 100) / 100,
            previousDisplayName: userData.previousDisplayName || null,
            nameChangedAt: userData.nameChangedAt || null,
            isPublic: userData.isPublic || false,
          });
        });

        // Sort by weekly gain descending (dollars or percent)
        allUsers.sort((a, b) =>
          sortBy === 'weeklyGainPercent' ? b.weeklyGainPercent - a.weeklyGainPercent : b.weeklyGain - a.weeklyGain,
        );
        leaderboard = allUsers.slice(0, 50);
      } else {
        // Build query - use composite index for crew filtering
        let query: Query = db.collection('users');

        if (crew) {
          query = query.where('crew', '==', crew);
        }

        query = query
          .orderBy('portfolioValue', 'desc')
          .limit(100)
          .select(...LEADERBOARD_FIELDS);

        const snapshot = await query.get();

        // Filter out bots and return only safe fields
        leaderboard = [];
        snapshot.forEach((doc) => {
          const userData = doc.data()!;

          // Skip bots and banned accounts
          if (userData.isBot || userData.isBanned) return;

          // Limit to top 50
          if (leaderboard!.length >= 50) return;

          // Count holdings (only non-zero positions)
          const holdingsCount = userData.holdings
            ? Object.keys(userData.holdings).filter((k) => userData.holdings[k] > 0).length
            : 0;

          leaderboard!.push({
            userId: doc.id,
            displayName: userData.displayName || 'Anonymous',
            portfolioValue: userData.portfolioValue || 0,
            crew: userData.crew || null,
            isCrewHead: userData.isCrewHead || false,
            crewHeadColor: userData.crewHeadColor || null,
            holdingsCount: holdingsCount,
            displayCrewPin: userData.displayCrewPin ?? null,
            ...sanitizeDisplayFields(userData),
            achievements: asArray(userData.achievements),
            previousDisplayName: userData.previousDisplayName || null,
            nameChangedAt: userData.nameChangedAt || null,
            isPublic: userData.isPublic || false,
          });
        });
      }

      // Cache in memory and publish to the shared Firestore doc so every
      // other instance — and every client — can serve this without recomputing
      const now = Date.now();
      leaderboardCache[cacheKey] = { data: leaderboard, timestamp: now };
      try {
        await docRef.set({ entries: leaderboard, generatedAt: now, key: cacheKey });
      } catch (e) {
        logger.error('leaderboard doc publish failed:', (e as Error).message);
      }
    }

    // Find caller's rank if authenticated (always per-request)
    let callerRank = null;
    if (context.auth) {
      const callerIndex = leaderboard!.findIndex((entry) => entry.userId === context.auth!.uid);
      if (callerIndex !== -1) {
        callerRank = callerIndex + 1;
      } else if (!gainSort) {
        // Caller is outside top 50 — count aggregation instead of reading one
        // doc per higher-ranked user (that scaled with the caller's rank).
        // Only for the net-worth sort: the aggregation ranks by portfolioValue,
        // which would be a wrong answer for either weekly-gain board.
        try {
          // Two fields only. This used to call select() on a DocumentReference,
          // which has none, so it threw and nobody outside the top 50 got a rank.
          const [callerDoc] = (await db.getAll(db.collection('users').doc(context.auth.uid), {
            fieldMask: ['isBot', 'portfolioValue'],
          })) as [admin.firestore.DocumentSnapshot];
          if (callerDoc.exists && !callerDoc.data()!.isBot) {
            callerRank = await countRankAbove(callerDoc.data()!.portfolioValue || 0, crew);
          }
        } catch (e) {
          // Leave callerRank null if lookup fails
        }
      }
    }

    return {
      leaderboard,
      callerRank,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error('Error fetching leaderboard:', error);
    throw new functions.https.HttpsError('internal', 'Failed to fetch leaderboard');
  }
});

/**
 * Get public profile by username
 */
export const getPublicProfile = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  const { username } = data || {};
  if (!username || typeof username !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Username required');
  }

  // Resolve username → uid via usernames collection, fallback to querying by displayNameLower
  let uid;
  const usernameDoc = await db.collection('usernames').doc(username.toLowerCase()).get();
  if (usernameDoc.exists) {
    uid = usernameDoc.data()!.uid;
  } else {
    const fallbackSnap = await db
      .collection('users')
      .where('displayNameLower', '==', username.toLowerCase())
      .limit(1)
      .get();
    if (fallbackSnap.empty) {
      throw new functions.https.HttpsError('not-found', 'User not found');
    }
    uid = fallbackSnap.docs[0]!.id;
  }

  const userDoc = await db.collection('users').doc(uid).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  const userData = userDoc.data()!;

  const isOwner = context.auth?.uid === uid;
  const isCallerAdmin = context.auth?.uid === ADMIN_UID;
  if (!userData.isPublic && !isOwner && !isCallerAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'This profile is private');
  }

  const marketSnap = await db.collection('market').doc('current').get();
  const prices = marketSnap.exists ? marketSnap.data()!.prices || {} : {};

  // Compute global rank (count aggregation — cheap regardless of rank)
  let rank = null;
  try {
    rank = await countRankAbove(userData.portfolioValue || 0, null);
  } catch (e) {
    /* leave null */
  }

  // Holdings tickers only (no share counts exposed), sorted by share count for top holdings
  const holdingsRaw = userData.holdings || {};
  const holdingTickers = Object.keys(holdingsRaw).filter((k) => (holdingsRaw[k] || 0) > 0);
  const topHoldings = [...holdingTickers].sort((a, b) => (holdingsRaw[b] || 0) - (holdingsRaw[a] || 0)).slice(0, 5);

  // Crew rank (count aggregation)
  let crewRank = null;
  if (userData.crew) {
    try {
      crewRank = await countRankAbove(userData.portfolioValue || 0, userData.crew);
    } catch (e) {
      /* leave null */
    }
  }

  // Short positions (tickers only, no share counts)
  const shortsRaw = userData.shorts || {};
  const shortTickers = Object.keys(shortsRaw).filter((t) => {
    const pos = shortsRaw[t];
    return pos && pos.shares > 0;
  });
  const totalShortValue = shortTickers.reduce((sum, t) => {
    return sum + shortsRaw[t].shares * (prices[t] || 0);
  }, 0);

  // Portfolio history for sparkline — last 30 days, capped so a very active
  // account can't turn one profile view into thousands of doc reads.
  const histSnap = await db
    .collection('users')
    .doc(uid)
    .collection('portfolioHistory')
    .where('timestamp', '>=', Date.now() - THIRTY_DAYS_MS)
    .orderBy('timestamp', 'desc')
    .limit(PUBLIC_PROFILE_SPARKLINE_MAX_POINTS)
    .get();
  const portfolioHistory = histSnap.docs.map((d) => d.data()).reverse();

  // Admin-only: weekly gain + full financial data
  let adminData = null;
  if (isCallerAdmin) {
    const currentValue = userData.portfolioValue || 0;
    const valueSevenDaysAgo = userData.portfolioSnapshot7d?.value ?? currentValue;
    const weeklyGain = currentValue - valueSevenDaysAgo;
    const weeklyGainPercent = valueSevenDaysAgo > 0 ? Math.round((weeklyGain / valueSevenDaysAgo) * 10000) / 100 : 0;

    adminData = {
      uid,
      cash: userData.cash || 0,
      marginUsed: userData.marginUsed || 0,
      marginEnabled: userData.marginEnabled || false,
      netEquity: (userData.portfolioValue || 0) - (userData.marginUsed || 0),
      weeklyGain,
      weeklyGainPercent,
      holdings: userData.holdings || {},
      shorts: userData.shorts || {},
      isBanned: userData.isBanned || false,
      isBot: userData.isBot || false,
    };
  }

  return {
    displayName: userData.displayName || 'Anonymous',
    crew: userData.crew || null,
    isCrewHead: userData.isCrewHead || false,
    crewHeadColor: userData.crewHeadColor || null,
    ...sanitizeDisplayFields(userData),
    displayCrewPin: userData.displayCrewPin ?? null,
    portfolioValue: userData.portfolioValue || 0,
    holdingsCount: holdingTickers.length,
    rank,
    crewRank,
    holdingTickers,
    topHoldings,
    shortTickers,
    totalShortValue,
    portfolioHistory,
    adminData,
    achievements: asArray(userData.achievements),
    stats: {
      totalTrades: userData.totalTrades || 0,
      predictionWins: userData.predictionWins || 0,
      totalCheckins: userData.totalCheckins || 0,
      checkinStreak: userData.checkinStreak || 0,
      peakPortfolioValue: userData.peakPortfolioValue || 0,
      createdAt: userData.createdAt || null,
    },
  };
});

/**
 * Daily Market Summary - Runs daily at 21:00 UTC
 */

/**
 * Margin debt for the accounts currently on the board (admin only).
 *
 * Deliberately NOT folded into getLeaderboard. That result is cached in
 * leaderboard/{key}, which firestore.rules makes world-readable, so anything
 * added to it is public no matter who asked for it. Margin debt is not public.
 *
 * The admin leaderboard toggle calls this with the uids it is already showing
 * and subtracts locally, so the public payload stays exactly as it was.
 */
export const getLeaderboardMargins = cf().https.onCall(async (data, context) => {
  requireAdmin(context, 'Admin only.');
  const { userIds } = data || {};
  if (!Array.isArray(userIds) || !userIds.length) {
    throw new functions.https.HttpsError('invalid-argument', 'userIds array required');
  }
  // The board shows 50 at a time; the cap stops a caller asking for everyone.
  const ids = userIds.filter((id) => typeof id === 'string').slice(0, 100);
  const docs = await db.getAll(...ids.map((id) => db.collection('users').doc(id)), { fieldMask: ['marginUsed'] });
  const margins: Record<string, number> = {};
  docs.forEach((d) => {
    if (d.exists) margins[d.id] = d.data()!.marginUsed || 0;
  });
  return { margins };
});
