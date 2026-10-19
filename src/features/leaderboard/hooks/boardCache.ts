import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { getLeaderboardFunction } from '../../../api/callables';
import { LEADERBOARD_DOC_FRESH_MS } from '../../../constants';
import type { LeaderRow } from '../../../types';

export interface RankedLeader extends LeaderRow {
  rank: number;
  crewRank: number;
  id: string;
}

export interface CachedBoard {
  leaders: RankedLeader[];
  /** The caller's rank and gap to the next player up, tagged with the uid they
   * were computed for so switching accounts never shows someone else's. */
  callerRank: number | null;
  nextGap: number | null;
  callerRankUid: string | null;
  fetchedAt: number;
}

// Session cache shared by the leaderboard page, its side panels and the ladder
// modal, so switching between them (or re-visiting) within the freshness
// window costs zero reads. Module-level: survives unmounts, cleared on reload.
const sessionCache: Record<string, CachedBoard> = {};
const inflight: Record<string, Promise<CachedBoard>> = {};

// Must mirror the backend cacheKey in functions/src/users/leaderboard.ts
export const isGainSort = (sortBy: string) => sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent';
export const docKey = (sortBy: string, crew: string | null) =>
  crew ? (isGainSort(sortBy) ? `${sortBy}_${crew}` : crew) : isGainSort(sortBy) ? sortBy : 'global';
const paramsFor = (sortBy: string, crew: string | null) => (crew ? { sortBy, crew } : { sortBy });

const decorate = (entries: LeaderRow[]): RankedLeader[] =>
  entries.map((u, i) => ({
    rank: i + 1,
    crewRank: i + 1,
    ...u,
    id: u.userId,
  }));

/** The cached board if it's still fresh. */
export const freshBoard = (key: string): CachedBoard | null => {
  const s = sessionCache[key];
  return s && Date.now() - s.fetchedAt < LEADERBOARD_DOC_FRESH_MS ? s : null;
};

// Fast path: the precomputed leaderboard/{key} doc (1 read, no function call,
// no cold start). Slow path (doc stale or missing): the getLeaderboard
// callable recomputes and republishes the doc for everyone else.
const fetchBoard = async (sortBy: string, crew: string | null, uid: string | null): Promise<CachedBoard> => {
  const key = docKey(sortBy, crew);
  try {
    const snap = await getDoc(doc(db, 'leaderboard', key));
    if (snap.exists() && Date.now() - (snap.data().generatedAt || 0) < LEADERBOARD_DOC_FRESH_MS) {
      const leaders = decorate((snap.data().entries as LeaderRow[] | undefined) || []);
      return (sessionCache[key] = {
        leaders,
        callerRank: null,
        nextGap: null,
        callerRankUid: null,
        fetchedAt: Date.now(),
      });
    }
  } catch (_) {
    /* fall through to the callable */
  }
  const res = await getLeaderboardFunction(paramsFor(sortBy, crew));
  if (uid && res.data.callerRank != null) rememberRank(uid, key, res.data.callerRank, res.data.nextGap ?? null);
  return (sessionCache[key] = {
    leaders: decorate(res.data.leaderboard || []),
    callerRank: res.data.callerRank ?? null,
    nextGap: res.data.nextGap ?? null,
    callerRankUid: uid,
    fetchedAt: Date.now(),
  });
};

/** Loads a board into the session cache. Concurrent asks share one request. */
export const loadBoard = (sortBy: string, crew: string | null, uid: string | null): Promise<CachedBoard> => {
  const key = docKey(sortBy, crew);
  const fresh = freshBoard(key);
  if (fresh) return Promise.resolve(fresh);
  inflight[key] ??= fetchBoard(sortBy, crew, uid).finally(() => delete inflight[key]);
  return inflight[key]!;
};

/** Warms a board the player is about to open (hovering its tab). */
export const prefetchBoard = (sortBy: string, crew: string | null, uid: string | null) => {
  loadBoard(sortBy, crew, uid).catch(() => {});
};

/** The caller's rank off the top 50, from the callable (net-worth boards only). */
export const fetchCallerRank = async (sortBy: string, crew: string | null, uid: string) => {
  const res = await getLeaderboardFunction(paramsFor(sortBy, crew));
  const rank = res.data.callerRank ?? null;
  const gap = res.data.nextGap ?? null;
  const s = sessionCache[docKey(sortBy, crew)];
  if (s) Object.assign(s, { callerRank: rank, nextGap: gap, callerRankUid: uid });
  if (rank != null) rememberRank(uid, docKey(sortBy, crew), rank, gap);
  return { rank, gap };
};

// The last rank the player saw on each board, kept in the browser so it shows
// the moment the board opens while the exact one loads (the call behind it can
// take a few seconds when the server has been idle).
const rankKey = (uid: string, key: string) => `lbRank:${uid}:${key}`;
const rememberRank = (uid: string, key: string, rank: number, gap: number | null) => {
  try {
    localStorage.setItem(rankKey(uid, key), JSON.stringify({ rank, gap }));
  } catch {
    /* storage blocked: the rank just loads a moment later */
  }
};
export const recallRank = (uid: string, key: string): { rank: number; gap: number | null } | null => {
  try {
    const v = JSON.parse(localStorage.getItem(rankKey(uid, key)) || 'null');
    return v && typeof v.rank === 'number' ? { rank: v.rank, gap: typeof v.gap === 'number' ? v.gap : null } : null;
  } catch {
    return null;
  }
};
