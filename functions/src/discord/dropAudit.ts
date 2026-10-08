// Daily-drop auditing. Split out of discordAdmin.js when that file approached
// its 600-line limit; auditing a player's drop claims has nothing to do with
// the ticker-rollback recovery tooling it used to sit beside.

import * as functions from 'firebase-functions';
import { cf, requireAdmin } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
const db = admin.firestore();

import { DISCORD_EPOCH_MS, TWENTY_FOUR_HOURS_MS } from '../shared/constants';
import type { UserData } from '../shared/types';

export const auditUserDrops = cf().https.onCall(async (data: { uid?: string; username?: string }, context) => {
  requireAdmin(context);

  const { uid, username } = data;
  if (!uid && !username) {
    throw new functions.https.HttpsError('invalid-argument', 'uid or username required');
  }

  // Find user
  let userSnap: admin.firestore.DocumentSnapshot;
  if (uid) {
    userSnap = await db.collection('users').doc(uid).get();
    if (!userSnap.exists) throw new functions.https.HttpsError('not-found', 'User not found');
  } else {
    const q = await db.collection('users').where('displayName', '==', username).limit(1).get();
    if (q.empty) throw new functions.https.HttpsError('not-found', 'User not found');
    userSnap = q.docs[0]!;
  }

  const userData = userSnap.data() as UserData & { claimedDailyStockMessages?: string[]; displayName?: string };
  const userId = userSnap.id;
  const claimedMessages = userData.claimedDailyStockMessages || [];

  // Extract timestamps from Discord snowflake IDs
  const DISCORD_EPOCH = BigInt(DISCORD_EPOCH_MS);
  const claimTimestamps = claimedMessages
    .map((id) => {
      try {
        const snowflake = BigInt(id);
        const ms = Number((snowflake >> 22n) + DISCORD_EPOCH);
        return ms;
      } catch {
        return null;
      }
    })
    .filter((ms): ms is number => Boolean(ms))
    .sort((a, b) => a - b);

  // Calculate expected claims (1 per day since first claim)
  const firstClaim = claimTimestamps[0] ?? null;
  const now = Date.now();
  const daysSinceFirst = firstClaim ? Math.floor((now - firstClaim) / TWENTY_FOUR_HOURS_MS) + 1 : 0;

  // Get market prices
  const marketSnap = await db.collection('market').doc('current').get();
  const marketData = marketSnap.data() || {};
  const prices: Record<string, number> = marketData.prices || {};

  // Get ALL trades for this user
  const tradesSnap = await db.collection('trades').where('uid', '==', userId).get();
  const trades = tradesSnap.docs.map((d) => d.data());

  // Calculate gifted shares per ticker
  const holdings = userData.holdings || {};
  const giftedSharesByTicker: Record<string, { shares: number; price: number; value: number }> = {};
  let totalGiftedValue = 0;

  for (const [ticker, held] of Object.entries(holdings)) {
    if (held <= 0) continue;
    const tickerTrades = trades.filter((t) => t.ticker === ticker);
    const bought = tickerTrades.filter((t) => t.action === 'buy').reduce((s, t) => s + (t.amount || 0), 0);
    const sold = tickerTrades.filter((t) => t.action === 'sell').reduce((s, t) => s + (t.amount || 0), 0);
    const netTraded = bought - sold;
    const gifted = Math.max(0, held - netTraded);
    if (gifted > 0) {
      const price = prices[ticker] || 0;
      giftedSharesByTicker[ticker] = { shares: gifted, price, value: Math.round(gifted * price * 100) / 100 };
      totalGiftedValue += gifted * price;
    }
  }

  totalGiftedValue = Math.round(totalGiftedValue * 100) / 100;

  // Claim frequency analysis — group claims by day
  const claimsByDay: Record<string, number> = {};
  for (const ts of claimTimestamps) {
    const day = new Date(ts).toISOString().split('T')[0]!;
    claimsByDay[day] = (claimsByDay[day] || 0) + 1;
  }

  // Find days with suspicious multi-claims
  const suspiciousDays = Object.entries(claimsByDay)
    .filter(([, count]) => count > 3)
    .sort((a, b) => b[1] - a[1])
    .map(([day, count]) => ({ day, count }));

  return {
    uid: userId,
    displayName: userData.displayName || 'Unknown',
    totalClaims: claimedMessages.length,
    expectedClaims: daysSinceFirst,
    excessClaims: Math.max(0, claimedMessages.length - daysSinceFirst),
    firstClaimDate: firstClaim ? new Date(firstClaim).toISOString() : null,
    claimTimestamps,
    claimsByDay,
    suspiciousDays,
    giftedSharesByTicker,
    totalGiftedValue,
    cash: Math.round((userData.cash || 0) * 100) / 100,
  };
});
