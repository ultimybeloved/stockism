import { useState, useEffect } from 'react';
import { collection, query, where, limit, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { ADMIN_UIDS } from '../constants';

// Unreviewed watchlist alerts, so the admin button can carry a badge instead of
// the admin having to remember to go look at the Watchlist tab. Alerts written
// by the alt scanner set `reviewed: false`; older alert types have no such field
// and are deliberately not counted, so this only ever surfaces new findings.
//
// Equality filter only — no orderBy — so it needs no composite index. Firestore
// rules already restrict watchlist_alerts to the admin, and the subscription is
// skipped entirely for everyone else, so this costs nothing for normal players.
const ALERT_QUERY_LIMIT = 50;

export function useAdminAlerts(user) {
  const [unreviewedCount, setUnreviewedCount] = useState(0);
  const [highSeverityCount, setHighSeverityCount] = useState(0);

  const isAdmin = !!user && ADMIN_UIDS.includes(user.uid);

  useEffect(() => {
    if (!isAdmin) {
      setUnreviewedCount(0);
      setHighSeverityCount(0);
      return undefined;
    }

    const q = query(
      collection(db, 'watchlist_alerts'),
      where('reviewed', '==', false),
      limit(ALERT_QUERY_LIMIT)
    );

    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        setUnreviewedCount(snap.size);
        setHighSeverityCount(snap.docs.filter((d) => d.data().severity === 'high').length);
      },
      () => {
        // A permissions hiccup or a dropped connection must never break the
        // header for the admin — just show no badge.
        setUnreviewedCount(0);
        setHighSeverityCount(0);
      }
    );

    return unsubscribe;
  }, [isAdmin]);

  return { unreviewedCount, highSeverityCount };
}
