import { useState, useEffect, useMemo } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import * as Sentry from '@sentry/react';

export const usePriceHistory = (ticker) => {
  const { priceHistory } = useAppContext();
  const mainHistory = priceHistory[ticker] || [];
  const [archivedHistory, setArchivedHistory] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    getDoc(doc(db, 'market', 'current', 'price_history', ticker))
      .then(snap => { if (snap.exists()) setArchivedHistory(snap.data().history || []); })
      .catch((e) => Sentry.captureException(e))
      .finally(() => setLoading(false));
  }, [ticker]);

  const fullHistory = useMemo(() => {
    if (archivedHistory.length === 0) {
      return [...mainHistory].sort((a, b) => a.timestamp - b.timestamp);
    }
    const seen = new Set();
    return [...archivedHistory, ...mainHistory]
      .filter(p => { if (seen.has(p.timestamp)) return false; seen.add(p.timestamp); return true; })
      .sort((a, b) => a.timestamp - b.timestamp);
  }, [mainHistory, archivedHistory]);

  return { fullHistory, loading };
};
