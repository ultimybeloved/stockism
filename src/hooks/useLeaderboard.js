import { useState, useEffect } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db, getLeaderboardFunction } from '../firebase';
import { LEADERBOARD_DOC_FRESH_MS } from '../constants';

// Session cache shared by the leaderboard page and the ladder modal, so
// switching between them (or re-visiting) within the freshness window costs
// zero reads. Module-level: survives unmounts, cleared on page reload.
// callerRank is tagged with the uid it was computed for, so switching
// accounts mid-session can never show the previous account's rank.
const sessionCache = {}; // key -> { leaders, callerRank, callerRankUid, fetchedAt }

// Must mirror the backend cacheKey in functions/services/leaderboard.js
const docKey = (sortBy, crew) =>
  crew ? (sortBy === 'weeklyGain' ? `weeklyGain_${crew}` : crew)
       : (sortBy === 'weeklyGain' ? 'weeklyGain' : 'global');

const decorate = (entries) => entries.map((u, i) => ({
  rank: i + 1,
  crewRank: i + 1,
  ...u,
  id: u.userId,
}));

// Loads a leaderboard view. Fast path: the precomputed leaderboard/{key} doc
// (1 Firestore read, no function call, no cold start) — the list renders
// instantly and, for players outside the top 50, their rank fills in from a
// background call. Slow path (doc stale/missing): the getLeaderboard callable
// recomputes and republishes the doc for everyone else.
export function useLeaderboard(sortBy, crewFilter, user, userCrew) {
  const [leaders, setLeaders] = useState([]);
  const [userRank, setUserRank] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const crew = crewFilter && crewFilter !== 'ALL' ? crewFilter : null;
    const key = docKey(sortBy, crew);
    const params = crew ? { sortBy, crew } : { sortBy };

    const rankFromList = (list) => {
      if (!user) return null;
      const idx = list.findIndex(e => e.id === user.uid);
      return idx === -1 ? null : idx + 1;
    };

    const fetchRankInBackground = (list) => {
      // Rank only exists server-side for the net-worth sort; in-list rank is
      // handled locally, so this is only for signed-in users outside the top 50.
      if (!user || sortBy !== 'value' || rankFromList(list) !== null) return;
      // A rank inside a crew the user doesn't belong to is meaningless —
      // the backend would still compute one, so don't ask for it.
      if (crew && crew !== userCrew) return;
      getLeaderboardFunction(params)
        .then(res => {
          if (cancelled) return;
          setUserRank(res.data.callerRank ?? null);
          if (sessionCache[key]) {
            sessionCache[key].callerRank = res.data.callerRank ?? null;
            sessionCache[key].callerRankUid = user.uid;
          }
        })
        .catch(() => { /* rank stays blank; list is already on screen */ });
    };

    const load = async () => {
      // Layer 0: session cache — no reads at all
      const s = sessionCache[key];
      if (s && Date.now() - s.fetchedAt < LEADERBOARD_DOC_FRESH_MS) {
        const cachedRank = user && s.callerRankUid === user.uid ? s.callerRank : null;
        setLeaders(s.leaders);
        setUserRank(rankFromList(s.leaders) ?? cachedRank);
        setLoading(false);
        if (cachedRank == null) fetchRankInBackground(s.leaders);
        return;
      }

      setLoading(true);

      // Layer 1: the shared precomputed doc
      try {
        const snap = await getDoc(doc(db, 'leaderboard', key));
        if (snap.exists() && Date.now() - (snap.data().generatedAt || 0) < LEADERBOARD_DOC_FRESH_MS) {
          if (cancelled) return;
          const leaderData = decorate(snap.data().entries || []);
          setLeaders(leaderData);
          setUserRank(rankFromList(leaderData));
          setLoading(false);
          sessionCache[key] = { leaders: leaderData, callerRank: null, callerRankUid: null, fetchedAt: Date.now() };
          fetchRankInBackground(leaderData);
          return;
        }
      } catch (_) { /* fall through to the callable */ }

      // Layer 2: recompute via the callable (which republishes the doc)
      try {
        const result = await getLeaderboardFunction(params);
        if (cancelled) return;
        const leaderData = decorate(result.data.leaderboard || []);
        setLeaders(leaderData);
        setUserRank(rankFromList(leaderData) ?? result.data.callerRank ?? null);
        sessionCache[key] = {
          leaders: leaderData,
          callerRank: result.data.callerRank ?? null,
          callerRankUid: user ? user.uid : null,
          fetchedAt: Date.now(),
        };
      } catch (err) {
        console.error('Failed to fetch leaderboard:', err);
      }
      if (!cancelled) setLoading(false);
    };

    load();
    return () => { cancelled = true; };
  }, [sortBy, crewFilter, user, userCrew]);

  return { leaders, userRank, loading };
}
