import { useState, useEffect, useMemo } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { IPO_TOTAL_SHARES } from '../constants';

/**
 * IPOs currently in their hype or buying phase.
 *
 * Split out of useMarketData, which was over the 200-line hook limit. This is
 * one concern and it needs three pieces that belong together: the subscription,
 * a clock, and the filter that depends on both.
 *
 * The clock is the point. IPO phases turn over on TIME, not on a write to the
 * doc, so filtering inside the snapshot handler froze `now` at whenever the doc
 * last changed — an IPO that ended stayed on the page until something else
 * wrote to the doc or the player reloaded. The raw list is kept as state and
 * the phase windows are re-evaluated on a slow tick instead.
 */
export function useActiveIPOs() {
  const [allIPOs, setAllIPOs] = useState([]);
  const [clock, setClock] = useState(Date.now());

  useEffect(() => {
    const unsubscribe = onSnapshot(
      doc(db, 'market', 'ipos'),
      (snap) => setAllIPOs(snap.exists() ? (snap.data().list || []) : []),
      (err) => console.warn('market/ipos subscription:', err?.message),
    );
    return () => unsubscribe();
  }, []);

  // IPO phases run 24h, so a minute of lag either side is invisible and this
  // costs nothing.
  useEffect(() => {
    const id = setInterval(() => setClock(Date.now()), 60000);
    return () => clearInterval(id);
  }, []);

  return useMemo(() => allIPOs.filter((ipo) => {
    const inHypePhase = clock < ipo.ipoStartsAt;
    const inBuyingPhase = clock >= ipo.ipoStartsAt && clock < ipo.ipoEndsAt
      && (ipo.sharesRemaining ?? (ipo.totalShares || IPO_TOTAL_SHARES)) > 0;
    return inHypePhase || inBuyingPhase;
  }), [allIPOs, clock]);
}
