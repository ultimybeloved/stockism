import { useState, useEffect } from 'react';
import { db } from '../../firebase';
import { collection, query, where, orderBy, getDocs, updateDoc, doc, serverTimestamp } from 'firebase/firestore';
import { usePortfolioHistory } from './usePortfolioHistory';

// Owns the portfolio modal's Firestore loads: pending limit orders and the
// portfolio-history series for the selected time range. Extracted from
// PortfolioModal to keep the component focused on rendering.
export function usePortfolioModalData(user, timeRange, showNotification) {
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const { history: portfolioHistory, loading: loadingHistory } = usePortfolioHistory(user, timeRange);

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

  // Confirmation is handled in PendingOrdersList with a two-step button,
  // matching the pattern used elsewhere (no native confirm dialogs).
  const handleCancelOrder = async (orderId) => {
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

  return { pendingOrders, loadingOrders, handleCancelOrder, portfolioHistory, loadingHistory };
}
