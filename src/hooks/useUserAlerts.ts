import { useState, useEffect, useCallback } from 'react';
import { doc, collection, query, where, orderBy, limit, onSnapshot, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, createPriceAlertFunction, deletePriceAlertFunction } from '../firebase';
import { errorMessage } from '../utils/errors';
import type { User } from 'firebase/auth';
import type { AppContextValue } from '../context/AppContext';
import type { StoredNotification } from '../utils/notifications';
import type { PriceAlert } from '../types';

// The user's bell notifications and price alerts: live subscriptions plus
// the read/clear/delete and create/delete handlers.
export function useUserAlerts({
  user,
  showNotification,
}: {
  user: User | null;
  showNotification: AppContextValue['showNotification'];
}) {
  const [userNotifications, setUserNotifications] = useState<StoredNotification[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<PriceAlert[]>([]); // user's active price alerts

  // Subscribe to user notifications
  useEffect(() => {
    if (!user) {
      setUserNotifications([]);
      return;
    }
    const notifQuery = query(
      collection(db, 'users', user.uid, 'notifications'),
      orderBy('createdAt', 'desc'),
      limit(50),
    );
    const unsub = onSnapshot(
      notifQuery,
      (snap) => {
        const notifs = snap.docs.map((d) => ({ id: d.id, ...d.data() }) as StoredNotification);
        setUserNotifications(notifs);
      },
      (err) => {
        console.error('Notification subscription error:', err);
      },
    );
    return () => unsub();
  }, [user]);

  // Subscribe to user price alerts
  useEffect(() => {
    if (!user) {
      setPriceAlerts([]);
      return;
    }
    const alertsQuery = query(collection(db, 'users', user.uid, 'priceAlerts'), where('triggered', '==', false));
    const unsub = onSnapshot(
      alertsQuery,
      (snap) => {
        setPriceAlerts(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
      },
      (err) => {
        console.error('Price alerts subscription error:', err);
      },
    );
    return () => unsub();
  }, [user]);

  const handleMarkNotificationRead = useCallback(
    async (notificationId: string) => {
      if (!user) return;
      try {
        await updateDoc(doc(db, 'users', user.uid, 'notifications', notificationId), { read: true });
      } catch (err) {
        console.error('Failed to mark notification read:', err);
      }
    },
    [user],
  );

  // Both act on the exact ids the panel passes (scoped to the active filter tab),
  // so "Clear" / "Mark Read" only touch what the user is actually looking at.
  const handleMarkAllNotificationsRead = useCallback(
    async (ids: string[] | null | undefined) => {
      if (!user || !ids?.length) return;
      try {
        await Promise.all(ids.map((id) => updateDoc(doc(db, 'users', user.uid, 'notifications', id), { read: true })));
      } catch (err) {
        console.error('Failed to mark notifications read:', err);
      }
    },
    [user],
  );

  const handleClearAllNotifications = useCallback(
    async (ids: string[] | null | undefined) => {
      if (!user || !ids?.length) return;
      try {
        await Promise.all(ids.map((id) => deleteDoc(doc(db, 'users', user.uid, 'notifications', id))));
      } catch (err) {
        console.error('Failed to clear notifications:', err);
      }
    },
    [user],
  );

  const handleDeleteNotification = useCallback(
    async (notificationId: string) => {
      if (!user) return;
      try {
        await deleteDoc(doc(db, 'users', user.uid, 'notifications', notificationId));
      } catch (err) {
        console.error('Failed to delete notification:', err);
      }
    },
    [user],
  );

  const handleCreatePriceAlert = useCallback(
    async ({ ticker, targetPrice, direction }: { ticker: string; targetPrice: number; direction: string }) => {
      try {
        await createPriceAlertFunction({ ticker, targetPrice, direction });
        showNotification('success', `Price alert set for $${ticker}`);
        return true;
      } catch (err) {
        showNotification('error', errorMessage(err) || 'Failed to create alert');
        return false;
      }
    },
    [showNotification],
  );

  const handleDeletePriceAlert = useCallback(
    async (alertId: string) => {
      try {
        await deletePriceAlertFunction({ alertId });
      } catch (err) {
        showNotification('error', errorMessage(err) || 'Failed to delete alert');
      }
    },
    [showNotification],
  );

  return {
    userNotifications,
    priceAlerts,
    handleMarkNotificationRead,
    handleMarkAllNotificationsRead,
    handleClearAllNotifications,
    handleDeleteNotification,
    handleCreatePriceAlert,
    handleDeletePriceAlert,
  };
}
