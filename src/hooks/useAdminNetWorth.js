import { useState, useEffect, useMemo } from 'react';
import { getLeaderboardMarginsFunction } from '../firebase';
import { ADMIN_UIDS } from '../constants';

// Admin-only leaderboard view: subtract margin debt so the board ranks what
// players actually own rather than what they are holding with borrowed money.
//
// The margin figures come from their own callable rather than from
// getLeaderboard, because that result is cached in a world-readable Firestore
// doc — anything added to it would be public to every player. This fetches only
// when the admin actually turns the view on, and only for the rows on screen.
export function useAdminNetWorth(leaders, user) {
  const [netMode, setNetMode] = useState(false);
  const [margins, setMargins] = useState(null);
  const [loading, setLoading] = useState(false);

  const isAdmin = !!user && ADMIN_UIDS.includes(user.uid);
  const ids = useMemo(
    () => (leaders || []).map((l) => l.userId).filter(Boolean),
    [leaders]
  );
  const idKey = ids.join(',');

  useEffect(() => {
    if (!isAdmin || !netMode || !ids.length) return undefined;
    let cancelled = false;
    setLoading(true);
    getLeaderboardMarginsFunction({ userIds: ids })
      .then((res) => { if (!cancelled) setMargins(res.data?.margins || {}); })
      .catch(() => { if (!cancelled) setMargins({}); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAdmin, netMode, idKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-rank on net worth. Falls back to the untouched list until the margins
  // land, so the board never flashes a half-applied ordering.
  const adjusted = useMemo(() => {
    if (!isAdmin || !netMode || !margins) return leaders;
    return [...(leaders || [])]
      .map((l) => ({
        ...l,
        marginUsed: margins[l.userId] || 0,
        portfolioValue: (l.portfolioValue || 0) - (margins[l.userId] || 0),
      }))
      .sort((a, b) => b.portfolioValue - a.portfolioValue);
  }, [leaders, margins, netMode, isAdmin]);

  return { isAdmin, netMode, setNetMode, adjustedLeaders: adjusted, loadingMargins: loading };
}
