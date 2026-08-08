import { useCallback, useEffect, useState } from 'react';
import { useAppContext } from '../context/AppContext';

const SEEN_KEY = 'stockism.predictionsSeenAt';

// Predictions that went up since this device last opened the tab. Deliberately
// localStorage rather than a field on the user doc: the badge is a nudge, not
// state worth a Firestore write on every visit, and predictions are already in
// context so this costs no extra reads.
const readSeenAt = () => {
  try {
    return Number(window.localStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
};

export function useNewPredictions() {
  const { predictions } = useAppContext();
  const [seenAt, setSeenAt] = useState(readSeenAt);

  // Another tab opening Predictions should clear the badge here too.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === SEEN_KEY) setSeenAt(readSeenAt());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const markSeen = useCallback(() => {
    const now = Date.now();
    try {
      window.localStorage.setItem(SEEN_KEY, String(now));
    } catch {
      // Private mode / storage disabled — the badge just won't persist.
    }
    setSeenAt(now);
  }, []);

  // Only live ones count. A first-time visitor has seenAt 0 and sees every open
  // prediction as new, which is the point.
  const now = Date.now();
  const newCount = (predictions || []).filter(p =>
    !p.resolved &&
    (!p.endsAt || p.endsAt > now) &&
    (p.createdAt || 0) > seenAt
  ).length;

  return { newCount, markSeen };
}
