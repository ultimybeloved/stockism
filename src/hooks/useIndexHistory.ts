import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * One read of market/indexHistory supplies both the 30-day reference point and
 * the divisor. Without the divisor the live number would drift away from the
 * recorded series the moment a character joins the roster.
 */
export const useIndexHistory = () => {
  const [index30dAgo, setIndex30dAgo] = useState<number | null>(null);
  const [divisor, setDivisor] = useState<number | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDoc(doc(db, 'market', 'indexHistory'));
        if (cancelled || !snap.exists()) return;
        const data = snap.data();
        if (data.divisor > 0) setDivisor(data.divisor);
        const hist: { t: number; v: number }[] = data.history || [];
        if (hist.length === 0) return;
        const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
        let ref = hist[0]!;
        for (let i = hist.length - 1; i >= 0; i--) {
          if (hist[i]!.t <= cutoff) {
            ref = hist[i]!;
            break;
          }
        }
        if (!cancelled) setIndex30dAgo(ref.v);
      } catch {
        /* leave null — 30d line just hides, index falls back to the average */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { index30dAgo, divisor };
};
