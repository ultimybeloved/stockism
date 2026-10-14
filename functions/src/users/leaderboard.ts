import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();
import type { DocumentData, Query } from 'firebase-admin/firestore';
// Rank counting lives in shared/equity — shared with the Discord bot's /profile.
import { countRankAbove, grantedSince, netReturnPercent, netWorthOf, snapshotNetWorth } from '../shared/equity';
import { BULLBEAR_FRAME_ID, frameTrend } from '../shared/rules/cosmetics';

import {
  LEADERBOARD_CACHE_TTL,
  ADMIN_UID,
  FOURTEEN_DAYS_MS,
  THIRTY_DAYS_MS,
  ONE_WEEK_MS,
  PUBLIC_PROFILE_SPARKLINE_MAX_POINTS,
  LEADERBOARD_PERCENT_MIN_BASELINE,
  LEADERBOARD_SIZE,
  LEADERBOARD_POOL_START,
  LEADERBOARD_POOL_MAX,
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
  // Bull / Bear frame direction (see frameTrend).
  'portfolioSnapshot24h',
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
  // Banned accounts are skipped. Missing from this list until 2026-10-14, so
  // that check read undefined and banned players kept their board slot.
  'isBanned',
  // Net worth = portfolioValue - marginUsed. Used for ranking only, never
  // published on its own (margin debt is private).
  'marginUsed',
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
    // Only wearers of the Bull / Bear frame get a direction, so the board
    // doesn't publish everyone's day.
    frameTrend:
      activeCosmetics?.rowFrame === BULLBEAR_FRAME_ID
        ? frameTrend(userData.portfolioValue, userData.portfolioSnapshot24h)
        : null,
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

          // Net of margin debt at both ends, so a margin buy isn't a "gain".
          const currentValue = netWorthOf(userData);
          const valueSevenDaysAgo = snapshotNetWorth(userData.portfolioSnapshot7d, userData.marginUsed || 0);

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

        // Ranked on net worth, but the stored (and indexed) value is gross. Net
        // can only be lower than gross, so if the 50th best net worth in the
        // pool is at least the lowest gross value fetched, nobody outside the
        // pool can beat it. Otherwise heavy borrowers pushed the cut-off down;
        // widen the pool and try again.
        let docs: DocumentData[] = [];
        for (let poolSize = LEADERBOARD_POOL_START; ; poolSize *= 2) {
          const snapshot = await query
            .orderBy('portfolioValue', 'desc')
            .limit(poolSize)
            .select(...LEADERBOARD_FIELDS)
            .get();
          docs = snapshot.docs
            .map((d): DocumentData => ({ ...d.data(), userId: d.id }))
            .filter((u) => !u.isBot && !u.isBanned)
            .sort((a, b) => netWorthOf(b) - netWorthOf(a));
          const lowestGross = snapshot.docs[snapshot.docs.length - 1]?.data().portfolioValue || 0;
          const cutoff = docs[LEADERBOARD_SIZE - 1];
          const exhausted = snapshot.size < poolSize;
          if (exhausted || poolSize >= LEADERBOARD_POOL_MAX || (cutoff && netWorthOf(cutoff) >= lowestGross)) break;
        }

        leaderboard = docs.slice(0, LEADERBOARD_SIZE).map((userData) => {
          // Count holdings (only non-zero positions)
          const holdingsCount = userData.holdings
            ? Object.keys(userData.holdings).filter((k) => userData.holdings[k] > 0).length
            : 0;

          return {
            userId: userData.userId,
            displayName: userData.displayName || 'Anonymous',
            portfolioValue: netWorthOf(userData),
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
          };
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
        // Only for the net-worth sort: the aggregation ranks by net worth,
        // which would be a wrong answer for either weekly-gain board.
        try {
          // Three fields only. This used to call select() on a DocumentReference,
          // which has none, so it threw and nobody outside the top 50 got a rank.
          const [callerDoc] = (await db.getAll(db.collection('users').doc(context.auth.uid), {
            fieldMask: ['isBot', 'portfolioValue', 'marginUsed'],
          })) as [admin.firestore.DocumentSnapshot];
          if (callerDoc.exists && !callerDoc.data()!.isBot) {
            callerRank = await countRankAbove(netWorthOf(callerDoc.data()), crew);
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
  // A banned account is gone from every board, so its profile is too. Admins
  // still see it.
  if (userData.isBanned && !isCallerAdmin) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }
  if (!userData.isPublic && !isOwner && !isCallerAdmin) {
    throw new functions.https.HttpsError('permission-denied', 'This profile is private');
  }
  // What the profile shows and ranks: net worth, same as the leaderboard.
  const netWorth = netWorthOf(userData);

  // Compute global rank (count aggregation — cheap regardless of rank)
  let rank = null;
  try {
    rank = await countRankAbove(netWorth, null);
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
      crewRank = await countRankAbove(netWorth, userData.crew);
    } catch (e) {
      /* leave null */
    }
  }

  // Short positions: tickers only. No share counts or dollar size, same as
  // holdings (the total short value was public until 2026-10-14).
  const shortsRaw = userData.shorts || {};
  const shortTickers = Object.keys(shortsRaw).filter((t) => {
    const pos = shortsRaw[t];
    return pos && pos.shares > 0;
  });

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
  // Net of margin debt, so the line ends where the headline figure is. Points
  // from before history recorded the debt use today's.
  const portfolioHistory = histSnap.docs
    .map((d) => {
      const p = d.data();
      return { timestamp: p.timestamp, value: snapshotNetWorth(p, userData.marginUsed || 0) };
    })
    .reverse();

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
    portfolioValue: netWorth,
    holdingsCount: holdingTickers.length,
    rank,
    crewRank,
    holdingTickers,
    topHoldings,
    shortTickers,
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
