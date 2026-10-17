import { useCallback, useState } from 'react';
import { playSound } from '../../utils/sounds';
import type { AppContextValue } from '../../context/AppContext';
import type { Toast } from '../components/ToastNotification';

/** The toast queue. Keeps the newest five. */
export const useToasts = () => {
  const [notifications, setNotifications] = useState<Toast[]>([]);

  const showNotification: AppContextValue['showNotification'] = useCallback((type, message, image = null) => {
    // Achievement toasts bring their own fanfare, wherever they come from.
    if (type === 'achievement') playSound('achievement');
    const id = Date.now() + Math.random();
    setNotifications((prev) => [...prev, { id, type, message, image }].slice(-5));
  }, []);

  const dismissNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  return { notifications, showNotification, dismissNotification };
};
