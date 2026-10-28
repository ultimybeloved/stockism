import * as functions from 'firebase-functions/v1';
import { cf, requireAppCheck } from '../shared/fnConfig';
import { ownEntry } from '../shared/lookup';
import * as admin from 'firebase-admin';
const db = admin.firestore();
import { touchLastActive } from '../shared/activity';
import { reportError } from '../shared/sentry';
import type { UserData } from '../shared/types';
import { LADDER_LEADERBOARD_SIZE, LADDER_LEADERBOARD_OVERFETCH } from '../shared/constants';
import { runLadderGame } from './ladderCore';

// The game itself is in ./ladderCore.ts (shared with the Discord bot).
// Deposits, withdrawals (incl. the withdrawal tax), and admin transfers live in
// ./ladderTransfers.ts.

export const playLadderGame = cf().https.onCall(
  async (data: { startSide?: unknown; bet?: unknown; amount?: unknown }, context) => {
    requireAppCheck(context);
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Must be logged in.');
    }
    touchLastActive(context.auth.uid, 'ladder');
    return runLadderGame(context.auth.uid, data);
  },
);

// Board key -> the stored field it ranks on. Net winnings is the default: a
// balance board put whoever just deposited the $10k max near the top.
// netWinnings is written by every game (ladderCore); a doc that has never
// played since it was added is left off, which only drops zero-game players.
const LADDER_BOARDS = { net: 'netWinnings', streak: 'bestStreak', games: 'gamesPlayed' } as const;
type LadderBoard = keyof typeof LADDER_BOARDS;

export const getLadderLeaderboard = cf().https.onCall(async (data: { board?: unknown } | null, context) => {
  requireAppCheck(context);
  // `in` also matched "constructor", which then failed the query and filed
  // an error report on every call.
  const board: LadderBoard = ownEntry(LADDER_BOARDS, data?.board) ? (data!.board as LadderBoard) : 'net';
  try {
    // Over-fetch, then drop the entries that should not hold a slot and trim.
    // A ladder doc is keyed by uid and outlives the account: deletions only
    // recently started removing it, and a ban leaves it entirely. Both used to
    // sit on this board — a deleted account as "Anonymous" with a real balance,
    // a banned one under its own name — while the main leaderboard has always
    // excluded bots and bans. Same rule here.
    const ladderUsersSnap = await db
      .collection('ladderGameUsers')
      .orderBy(LADDER_BOARDS[board], 'desc')
      .limit(LADDER_LEADERBOARD_SIZE * LADDER_LEADERBOARD_OVERFETCH)
      .get();

    const userIds = ladderUsersSnap.docs.map((doc) => doc.id);
    const leaderboard: Record<string, unknown>[] = [];

    const userRefs = userIds.map((id) => db.collection('users').doc(id));
    const userDocs = userRefs.length > 0 ? await db.getAll(...userRefs) : [];
    const userMap: Record<string, UserData> = {};
    userDocs.forEach((doc) => {
      if (doc.exists) userMap[doc.id] = doc.data() as UserData;
    });

    for (const doc of ladderUsersSnap.docs) {
      if (leaderboard.length >= LADDER_LEADERBOARD_SIZE) break;
      const ladderData = doc.data();
      const userData = userMap[doc.id];
      // No user doc = the account is gone; the balance is a leftover.
      if (!userData || userData.isBanned || userData.isBot) continue;
      leaderboard.push({
        userId: doc.id,
        username: userData.displayName || 'Anonymous',
        balance: ladderData.balance || 0,
        netWinnings: (ladderData.totalWon || 0) - (ladderData.totalLost || 0),
        bestStreak: ladderData.bestStreak || 0,
        gamesPlayed: ladderData.gamesPlayed || 0,
        wins: ladderData.wins || 0,
        winRate: ladderData.gamesPlayed > 0 ? Math.round((ladderData.wins / ladderData.gamesPlayed) * 100) : 0,
      });
    }

    return { board, leaderboard };
  } catch (error) {
    reportError(error, { where: 'getLadderLeaderboard' });
    throw new functions.https.HttpsError('internal', 'Failed to get leaderboard: ' + (error as Error).message);
  }
});
