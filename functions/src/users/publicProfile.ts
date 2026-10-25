// Player profiles: reading one (getPublicProfile) and choosing what goes in
// your own trophy case (setTrophyCase).
import * as functions from 'firebase-functions/v1';
import * as admin from 'firebase-admin';
import type { DocumentData } from 'firebase-admin/firestore';
import { cf, requireAppCheck } from '../shared/fnConfig';
import { countRankAbove, netWorthOf, snapshotNetWorth } from '../shared/equity';
import { round2 } from '../shared/money';
import { cleanTrophyCase, headReign, parseTrophy } from '../shared/rules/trophies';
import { touchLastActive } from '../shared/activity';
import { ADMIN_UID, THIRTY_DAYS_MS, PUBLIC_PROFILE_SPARKLINE_MAX_POINTS } from '../shared/constants';
import { asArray, sanitizeDisplayFields } from './displayFields';
import { chartShape } from '../shared/rules/cosmetics';

const db = admin.firestore();

/**
 * The trophy case as shown: still-owned items only (a revoked achievement
 * drops out), the labels of any titles in it, and the crew-head record.
 */
function trophyFields(userData: DocumentData) {
  const trophyCase = cleanTrophyCase(userData, userData.trophyCase);
  const titleMeta = userData.titleMeta && typeof userData.titleMeta === 'object' ? userData.titleMeta : {};
  const trophyTitles: Record<string, string> = {};
  for (const id of trophyCase) {
    const t = parseTrophy(id);
    if (t?.kind === 'title') trophyTitles[t.ref] = String(titleMeta[t.ref] || t.ref);
  }
  return { trophyCase, trophyTitles, headReign: headReign(userData) };
}

/**
 * A player's profile by username. Every profile opens (since 2026-10-21): the
 * header, rank, trophy case and achievements are for anyone. Holdings, shorts,
 * the chart and trading stats only when the profile is public (or it's the
 * owner, or an admin).
 */
export const getPublicProfile = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  const { username } = data || {};
  if (!username || typeof username !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Username required');
  }

  // Resolve username -> uid via usernames collection, fallback to querying by displayNameLower
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
  const showMarket = !!userData.isPublic || isOwner || isCallerAdmin;
  // What the profile shows and ranks: net worth, same as the leaderboard.
  const netWorth = netWorthOf(userData);

  // Compute global rank (count aggregation - cheap regardless of rank)
  let rank = null;
  try {
    rank = await countRankAbove(netWorth, null);
  } catch (e) {
    /* leave null */
  }

  // Holdings tickers only (no share counts exposed), sorted by share count for top holdings
  const holdingsRaw = showMarket ? userData.holdings || {} : {};
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
  const shortsRaw = showMarket ? userData.shorts || {} : {};
  const shortTickers = Object.keys(shortsRaw).filter((t) => {
    const pos = shortsRaw[t];
    return pos && pos.shares > 0;
  });

  // Portfolio history for sparkline - last 30 days, capped so a very active
  // account can't turn one profile view into thousands of doc reads.
  // Skipped (no reads) for a private profile.
  const histDocs = showMarket
    ? (
        await db
          .collection('users')
          .doc(uid)
          .collection('portfolioHistory')
          .where('timestamp', '>=', Date.now() - THIRTY_DAYS_MS)
          .orderBy('timestamp', 'desc')
          .limit(PUBLIC_PROFILE_SPARKLINE_MAX_POINTS)
          .get()
      ).docs
    : [];
  // Net of margin debt, so the line ends where the headline figure is. Points
  // from before history recorded the debt use today's.
  const portfolioHistory = histDocs
    .map((d) => {
      const p = d.data();
      return {
        timestamp: p.timestamp,
        value: round2(
          snapshotNetWorth(p, userData.marginUsed || 0) + (p.eventPositionsValue ?? userData.eventPositionsValue ?? 0),
        ),
      };
    })
    .reverse();

  // What the equipped profile background draws. Your Chart gets the line's
  // shape only (scaled 0 to 1, no dollar values) and Ticker Wall the three
  // biggest holdings; both show even on a private profile, as the shop says.
  const display = sanitizeDisplayFields(userData);
  const bg = display.activeCosmetics?.profileBg;
  let profileBgData: { chart?: number[]; tickers?: string[] } | null = null;
  if (bg === 'bg_chart') {
    const values = showMarket
      ? portfolioHistory.map((p) => p.value)
      : (
          await db
            .collection('users')
            .doc(uid)
            .collection('portfolioHistory')
            .where('timestamp', '>=', Date.now() - THIRTY_DAYS_MS)
            .orderBy('timestamp', 'desc')
            .limit(PUBLIC_PROFILE_SPARKLINE_MAX_POINTS)
            .get()
        ).docs
          .map((d) => snapshotNetWorth(d.data(), userData.marginUsed || 0))
          .reverse();
    profileBgData = { chart: chartShape(values) };
  } else if (bg === 'bg_tickers') {
    const all = userData.holdings || {};
    const tickers = Object.keys(all)
      .filter((t) => (all[t] || 0) > 0)
      .sort((a, b) => (all[b] || 0) - (all[a] || 0))
      .slice(0, 3);
    profileBgData = { tickers };
  }

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
    ...display,
    profileBgData,
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
    isPublic: showMarket,
    ...trophyFields(userData),
    stats: {
      totalTrades: showMarket ? userData.totalTrades || 0 : 0,
      predictionWins: showMarket ? userData.predictionWins || 0 : 0,
      totalCheckins: showMarket ? userData.totalCheckins || 0 : 0,
      checkinStreak: showMarket ? userData.checkinStreak || 0 : 0,
      peakPortfolioValue: showMarket ? userData.peakPortfolioValue || 0 : 0,
      createdAt: userData.createdAt || null,
    },
  };
});

/** Choose what goes in your trophy case: up to six things you own, in order. */
export const setTrophyCase = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  if (!context.auth) throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
  const uid = context.auth.uid;
  const ids = (data as { trophies?: unknown } | null)?.trophies;
  if (!Array.isArray(ids)) throw new functions.https.HttpsError('invalid-argument', 'trophies must be a list');
  const ref = db.collection('users').doc(uid);
  const snap = await ref.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'No account');
  const trophyCase = cleanTrophyCase(snap.data()!, ids);
  if (trophyCase.length !== ids.length) {
    throw new functions.https.HttpsError('invalid-argument', "Some of those aren't yours to show.");
  }
  await ref.update({ trophyCase });
  touchLastActive(uid);
  return { trophyCase };
});
