import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, orderBy, getDocs, updateDoc, doc, serverTimestamp, limit } from 'firebase/firestore';
import { TIME_RANGES } from './shared';

const getRangeCutoff = (range) => {
  if (!range || (!range.days && !range.months && !range.years)) return 0;
  const d = new Date();
  if (range.years)  d.setFullYear(d.getFullYear() - range.years);
  if (range.months) d.setMonth(d.getMonth() - range.months);
  if (range.days)   d.setDate(d.getDate() - range.days);
  return d.getTime();
};

// Owns the portfolio modal's Firestore loads: pending limit orders and the
// portfolio-history series for the selected time range. Extracted from
// PortfolioModal to keep the component focused on rendering.
export function usePortfolioModalData(user, timeRange, showNotification) {
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [portfolioHistory, setPortfolioHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  // Load pending limit orders
  useEffect(() => {
    if (!user) return;

    const loadPendingOrders = async () => {
      try {
        const ordersRef = collection(db, 'limitOrders');
        const q = query(
          ordersRef,
          where('userId', '==', user.uid),
          where('status', 'in', ['PENDING', 'PARTIALLY_FILLED']),
          orderBy('createdAt', 'desc')
        );

        const snapshot = await getDocs(q);
        const orders = snapshot.docs.map(d => ({
          id: d.id,
          ...d.data()
        }));

        setPendingOrders(orders);
      } catch (error) {
        console.error('Error loading orders:', error);
      }
    };

    loadPendingOrders();
  }, [user]);

  const handleCancelOrder = async (orderId) => {
    if (!confirm('Cancel this order?')) return;

    setLoadingOrders(true);
    try {
      await updateDoc(doc(db, 'limitOrders', orderId), {
        status: 'CANCELED',
        updatedAt: serverTimestamp()
      });

      // Remove from list immediately
      setPendingOrders(prev => prev.filter(o => o.id !== orderId));
    } catch (error) {
      console.error('Error canceling order:', error);
      showNotification('error', `Failed to cancel order: ${error.message}`);
    }
    setLoadingOrders(false);
  };

  // Load portfolio history from subcollection for current time range
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const fetchHistory = async () => {
      setLoadingHistory(true);
      try {
        const range = TIME_RANGES.find(r => r.key === timeRange);
        const cutoff = getRangeCutoff(range);

        const mainQ = query(
          collection(db, 'users', user.uid, 'portfolioHistory'),
          where('timestamp', '>=', cutoff),
          orderBy('timestamp')
        );

        // Fetch the last known point before the window so the chart starts exactly
        // at the cutoff date rather than at the first trade inside the window.
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
        let history = mainSnap.docs.map(d => d.data());

        // Prepend a synthetic starting point pinned to the cutoff timestamp so the
        // chart always begins exactly at the window edge (e.g. Feb 27 for 3M), not
        // at the first trade inside the window (e.g. March 8).
        if (anchorQ && history.length > 0) {
          let anchorValue = history[0].value; // fallback: first in-window value
          try {
            const anchorSnap = await getDocs(anchorQ);
            if (!anchorSnap.empty) {
              anchorValue = anchorSnap.docs[0].data().value;
            }
          } catch (_) { /* use fallback */ }
          history = [{ timestamp: cutoff, value: anchorValue }, ...history];
        }

        if (!cancelled) setPortfolioHistory(history);
      } catch (err) {
        console.error('Failed to load portfolio history:', err);
      } finally {
        if (!cancelled) setLoadingHistory(false);
      }
    };
    fetchHistory();
    return () => { cancelled = true; };
  }, [user, timeRange]); // eslint-disable-line react-hooks/exhaustive-deps

  return { pendingOrders, loadingOrders, handleCancelOrder, portfolioHistory, loadingHistory };
}
