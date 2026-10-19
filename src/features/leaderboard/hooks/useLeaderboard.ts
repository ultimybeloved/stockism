import { useState, useEffect } from 'react';
import type { User } from 'firebase/auth';
import { docKey, fetchCallerRank, freshBoard, loadBoard, recallRank, type CachedBoard } from './boardCache';
import type { RankedLeader } from './boardCache';

export type { RankedLeader } from './boardCache';

// Loads a leaderboard view through the shared board cache (boardCache.ts). The
// list renders as soon as the board doc is in; for players outside the top 50
// their rank fills in from a background call, showing the last rank they saw
// until it lands.
export function useLeaderboard(
  sortBy: string,
  crewFilter: string | null | undefined,
  user: User | null,
  userCrew: string | null | undefined,
) {
  const [leaders, setLeaders] = useState<RankedLeader[]>([]);
  const [userRank, setUserRank] = useState<number | null>(null);
  // Off-board players only: net worth needed to pass the next player up.
  const [nextGap, setNextGap] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const crew = crewFilter && crewFilter !== 'ALL' ? crewFilter : null;
    const key = docKey(sortBy, crew);
    const uid = user?.uid ?? null;

    const show = (board: CachedBoard) => {
      setLeaders(board.leaders);
      setLoading(false);
      const inList = uid ? board.leaders.findIndex((e) => e.id === uid) : -1;
      if (inList !== -1) {
        setUserRank(inList + 1);
        setNextGap(null);
        return;
      }
      if (board.callerRankUid === uid && board.callerRank != null) {
        setUserRank(board.callerRank);
        setNextGap(board.nextGap);
        return;
      }
      // Rank only exists server-side for the net-worth sort, and a rank inside
      // a crew the player isn't in means nothing.
      if (!uid || sortBy !== 'value' || (crew && crew !== userCrew)) {
        setUserRank(null);
        setNextGap(null);
        return;
      }
      const last = recallRank(uid, key);
      setUserRank(last?.rank ?? null);
      setNextGap(last?.gap ?? null);
      fetchCallerRank(sortBy, crew, uid)
        .then(({ rank, gap }) => {
          if (cancelled) return;
          setUserRank(rank);
          setNextGap(gap);
        })
        .catch(() => {
          /* the remembered rank (or none) stays; the list is already on screen */
        });
    };

    const cached = freshBoard(key);
    if (cached) {
      show(cached);
    } else {
      setLoading(true);
      loadBoard(sortBy, crew, uid)
        .then((board) => !cancelled && show(board))
        .catch((err) => {
          console.error('Failed to fetch leaderboard:', err);
          // Don't leave the previous sort's ranking on screen under the new heading.
          if (cancelled) return;
          setLeaders([]);
          setUserRank(null);
          setNextGap(null);
          setLoading(false);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [sortBy, crewFilter, user, userCrew]);

  return { leaders, userRank, nextGap, loading };
}
