import { useState, useEffect, useRef } from 'react';

/** One toast on screen (App's notification queue). */
export interface Toast {
  id: number;
  type: string;
  message: string;
  image?: string | null;
}

interface ToastNotificationProps {
  notification: Toast;
  onDismiss: () => void;
}

const ToastNotification = ({ notification, onDismiss }: ToastNotificationProps) => {
  const [isExiting, setIsExiting] = useState(false);
  // Keep the latest onDismiss without restarting the timer: the container
  // passes a fresh arrow function every render, and with it in the effect
  // deps every app re-render (price ticks, countdowns) reset the 4s timer,
  // so toasts never auto-dismissed on live screens.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    // Auto-dismiss after duration (longer for achievements)
    const duration = notification.type === 'achievement' ? 6000 : 4000;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(() => dismissRef.current(), 300); // Wait for exit animation
    }, duration);

    return () => clearTimeout(timer);
  }, [notification.id, notification.type]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(onDismiss, 300);
  };

  const getStyles = () => {
    switch (notification.type) {
      case 'error':
        return {
          bg: 'light:bg-red-100 light:border-red-400 dark:bg-red-900/90 dark:border-red-700',
          text: 'light:text-red-800 dark:text-red-100',
          icon: '❌',
        };
      case 'info':
        return {
          bg: 'light:bg-blue-100 light:border-blue-400 dark:bg-blue-900/90 dark:border-blue-700',
          text: 'light:text-blue-800 dark:text-blue-100',
          icon: 'ℹ️',
        };
      case 'achievement':
        return {
          bg: 'light:bg-amber-100 light:border-amber-400 dark:bg-amber-900/90 dark:border-amber-500',
          text: 'light:text-amber-800 dark:text-amber-100',
          icon: '🏆',
        };
      default: // success
        return {
          bg: 'light:bg-green-100 light:border-green-400 dark:bg-green-900/90 dark:border-green-700',
          text: 'light:text-green-800 dark:text-green-100',
          icon: '✓',
        };
    }
  };

  const styles = getStyles();

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3 rounded-sm border shadow-lg backdrop-blur-sm cursor-pointer transition-all duration-300 ${styles.bg} ${styles.text} ${
        isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'
      } ${notification.type === 'achievement' ? 'animate-pulse' : ''}`}
      onClick={handleDismiss}
    >
      {notification.image ? (
        <img src={notification.image} alt="" className="w-6 h-6 object-contain" />
      ) : (
        <span className="text-lg">{styles.icon}</span>
      )}
      <span className="flex-1 text-sm font-semibold">{notification.message}</span>
      <button className="opacity-60 hover:opacity-100 text-lg leading-none">&times;</button>
    </div>
  );
};

const ToastContainer = ({ notifications, onDismiss }: { notifications: Toast[]; onDismiss: (id: number) => void }) => {
  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notif) => (
        <ToastNotification key={notif.id} notification={notif} onDismiss={() => onDismiss(notif.id)} />
      ))}
    </div>
  );
};

export { ToastNotification, ToastContainer };
export default ToastContainer;
