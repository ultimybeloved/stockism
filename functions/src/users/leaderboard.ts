import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import * as logger from 'firebase-functions/logger';
const db = admin.firestore();
import type { DocumentData, Query } from 'firebase-admin/firestore';
// Rank counting lives in shared/equity — shared with the Discord bot's /profile.
import {
  countRankAbove,
  gapToNextRank,
  grantedSince,
  netReturnPercent,
  netWorthOf,
  tradingNetWorthOf,
  snapshotNetWorth,
  maxEventPositionsValue,
} from '../shared/equity';
import { withRankMoves } from './leaderboardMoves';
import { CREW_MAP } from '../shared/crews';
import { asArray, sanitizeDisplayFields } from './displayFields';

import {
  LEADERBOARD_CACHE_TTL,
  FOURTEEN_DAYS_MS,
  ONE_WEEK_MS,
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
  // Split Flap / Bull / Bear / backdrop tint choices, checked below.
  'cosmeticStyle',
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
  // Long-term market positions at sell-back value, part of net worth.
  'eventPositionsValue',
];

export const getLeaderboard = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  const { crew, sortBy = 'value' } = data || {};
  // Every board key becomes a document id, so only real crews and sorts.
  if (crew != null && !(typeof crew === 'string' && CREW_MAP[crew])) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown crew');
  }
  if (!['value', 'weeklyGain', 'weeklyGainPercent'].includes(sortBy)) {
    throw new functions.https.HttpsError('invalid-argument', 'Unknown board');
  }
  try {
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
          // Long-term positions stay out: prediction money is a flow, not a gain.
          const currentValue = tradingNetWorthOf(userData);
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
        // Net worth can also sit ABOVE gross by a player's long-term positions,
        // so the bound is the lowest gross fetched plus the largest position.
        const eventHeadroom = await maxEventPositionsValue();
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
          if (
            exhausted ||
            poolSize >= LEADERBOARD_POOL_MAX ||
            (cutoff && netWorthOf(cutoff) >= lowestGross + eventHeadroom)
          )
            break;
        }

        const board = docs.slice(0, LEADERBOARD_SIZE).map((userData) => {
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
        leaderboard = await withRankMoves(cacheKey, board, Date.now());
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
    // What the caller needs to pass the next player up (net-worth boards only).
    let nextGap: number | null = null;
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
            fieldMask: ['isBot', 'portfolioValue', 'marginUsed', 'eventPositionsValue'],
          })) as [admin.firestore.DocumentSnapshot];
          if (callerDoc.exists && !callerDoc.data()!.isBot) {
            const net = netWorthOf(callerDoc.data());
            [callerRank, nextGap] = await Promise.all([countRankAbove(net, crew), gapToNextRank(net, crew)]);
          }
        } catch (e) {
          // Leave callerRank null if lookup fails
        }
      }
    }

    return {
      leaderboard,
      callerRank,
      nextGap,
      timestamp: Date.now(),
    };
  } catch (error) {
    logger.error('Error fetching leaderboard:', error);
    throw new functions.https.HttpsError('internal', 'Failed to fetch leaderboard');
  }
});
