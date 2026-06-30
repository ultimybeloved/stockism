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

  return {
    notification,
    showNotification,
    success,
    error,
    warning,
    info,
    clearNotification,
    hasNotification: !!notification
  };
};

export default useNotifications;
