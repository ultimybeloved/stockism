import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import * as admin from 'firebase-admin';
import { netWorthOf } from '../shared/equity';

const db = admin.firestore();

const MIN_QUERY = 2;
const MAX_QUERY = 20;
// Over-fetch a little: bots and banned accounts are dropped after the read.
const FETCH = 12;
const RESULTS = 8;
// Sorts after every real character, so [q, q + PREFIX_END) is "starts with q".
const PREFIX_END = String.fromCharCode(0xf8ff);

/**
 * Leaderboard player search: names starting with what was typed, shown with
 * their crew and net worth. Bots and banned accounts never appear, the same as
 * on the boards. Only the fields the result row shows are read.
 */
export const searchPlayers = cf().https.onCall(async (data, context) => {
  requireAppCheck(context);
  const raw = (data as { query?: unknown } | null)?.query;
  if (typeof raw !== 'string') throw new functions.https.HttpsError('invalid-argument', 'Search text required');
  const q = raw.trim().toLowerCase();
  if (q.length < MIN_QUERY || q.length > MAX_QUERY) return { players: [] };

  const snap = await db
    .collection('users')
    .where('displayNameLower', '>=', q)
    .where('displayNameLower', '<', q + PREFIX_END)
    .orderBy('displayNameLower')
    .limit(FETCH)
    .select(
      'displayName',
      'crew',
      'isPublic',
      'isBot',
      'isBanned',
      'portfolioValue',
      'marginUsed',
      'eventPositionsValue',
    )
    .get();

  const players = snap.docs
    .map((d) => d.data())
    .filter((u) => !u.isBot && !u.isBanned && u.displayName)
    .slice(0, RESULTS)
    .map((u) => ({
      displayName: u.displayName as string,
      crew: (u.crew as string | undefined) || null,
      isPublic: !!u.isPublic,
      // Shown even for private profiles: the boards already show it.
      netWorth: netWorthOf(u),
    }));
  return { players };
});
