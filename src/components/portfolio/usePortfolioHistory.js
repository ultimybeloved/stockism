import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, orderBy, getDocs, limit } from 'firebase/firestore';
import { TIME_RANGES } from './shared';

const getRangeCutoff = (range) => {
  if (!range || (!range.days && !range.months && !range.years)) return 0;
  const d = new Date();
  if (range.years)  d.setFullYear(d.getFullYear() - range.years);
  if (range.months) d.setMonth(d.getMonth() - range.months);
  if (range.days)   d.setDate(d.getDate() - range.days);
  return d.getTime();
};

// Fetches the user's portfolioHistory subcollection bounded to the selected
// time range (a key from shared TIME_RANGES), plus one anchor point just
// before the window so charts start exactly at the window edge. Bounded
// queries keep Firestore reads proportional to what the chart shows — only
// the user-selected "All" range reads the full history.
export function usePortfolioHistory(user, rangeKey) {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchHistory = async () => {
      setLoading(true);
      try {
        const range = TIME_RANGES.find(r => r.key === rangeKey);
        const cutoff = getRangeCutoff(range);

        const mainQ = query(
          collection(db, 'users', user.uid, 'portfolioHistory'),
          where('timestamp', '>=', cutoff),
          orderBy('timestamp')
        );

        // Last known point before the window, so the chart starts at the
        // cutoff date rather than at the first trade inside the window.
        // Skip for "All" (cutoff = 0) since there's no "before" to anchor from.
        const anchorQ = cutoff > 0
          ? query(
              collection(db, 'users', user.uid, 'portfolioHistory'),
              where('timestamp', '<', cutoff),
              orderBy('timestamp', 'desc'),
              limit(1)
            )
          : null;

        const mainSnap = await getDocs(mainQ);
        let points = mainSnap.docs.map(d => d.data());

        if (anchorQ && points.length > 0) {
          let anchorValue = points[0].value; // fallback: first in-window value
          try {
            const anchorSnap = await getDocs(anchorQ);
            if (!anchorSnap.empty) {
              anchorValue = anchorSnap.docs[0].data().value;
            }
          } catch (_) { /* use fallback */ }
          points = [{ timestamp: cutoff, value: anchorValue }, ...points];
        }

        if (!cancelled) setHistory(points);
      } catch (err) {
        console.error('Failed to load portfolio history:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchHistory();
    return () => { cancelled = true; };
  }, [user, rangeKey]);

  return { history, loading };
}
