// ============================================
// useNotifications Hook
// Toast notification system
// ============================================

import { useState, useCallback } from 'react';

/**
 * Custom hook for toast notifications
 * @returns {Object} Notification state and methods
 */
export const useNotifications = () => {
  const [notification, setNotification] = useState(null);
  const [notificationQueue, setNotificationQueue] = useState([]);

  // Show a notification
  const showNotification = useCallback((type, message, duration = 3000) => {
    const newNotification = {
      id: Date.now(),
      type, // 'success' | 'error' | 'warning' | 'info'
      message,
      duration
    };

    setNotification(newNotification);

    // Auto-hide after duration
    if (duration > 0) {
      setTimeout(() => {
        setNotification(current =>
          current?.id === newNotification.id ? null : current
        );
      }, duration);
    }
  }, []);

  // Convenience methods
  const success = useCallback((message, duration) => {
    showNotification('success', message, duration);
  }, [showNotification]);

  const error = useCallback((message, duration) => {
    showNotification('error', message, duration);
  }, [showNotification]);

  const warning = useCallback((message, duration) => {
    showNotification('warning', message, duration);
  }, [showNotification]);

  const info = useCallback((message, duration) => {
    showNotification('info', message, duration);
  }, [showNotification]);

  // Clear current notification
  const clearNotification = useCallback(() => {
    setNotification(null);
  }, []);

  // Queue-based notification system for multiple notifications
  const queueNotification = useCallback((type, message, duration = 3000) => {
    setNotificationQueue(prev => [...prev, { type, message, duration, id: Date.now() }]);
  }, []);

  // Process notification queue
  const processQueue = useCallback(() => {
    setNotificationQueue(prev => {
      if (prev.length === 0) return prev;

      const [first, ...rest] = prev;
      showNotification(first.type, first.message, first.duration);
      return rest;
    });
  }, [showNotification]);

  return {
    notification,
    showNotification,
    success,
    error,
    warning,
    info,
    clearNotification,
    queueNotification,
    processQueue,
    hasNotification: !!notification
  };
};

export default useNotifications;
