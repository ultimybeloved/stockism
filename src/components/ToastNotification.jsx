import React, { useState, useEffect } from 'react';

const ToastNotification = ({ notification, onDismiss, darkMode }) => {
  const [isExiting, setIsExiting] = useState(false);

  useEffect(() => {
    // Auto-dismiss after duration (longer for achievements)
    const duration = notification.type === 'achievement' ? 6000 : 4000;
    const timer = setTimeout(() => {
      setIsExiting(true);
      setTimeout(onDismiss, 300); // Wait for exit animation
    }, duration);

    return () => clearTimeout(timer);
  }, [notification, onDismiss]);

  const handleDismiss = () => {
    setIsExiting(true);
    setTimeout(onDismiss, 300);
  };

  const getStyles = () => {
    switch (notification.type) {
      case 'error':
        return {
          bg: darkMode ? 'bg-red-900/90 border-red-700' : 'bg-red-100 border-red-400',
          text: darkMode ? 'text-red-100' : 'text-red-800',
          icon: '❌'
        };
      case 'info':
        return {
          bg: darkMode ? 'bg-blue-900/90 border-blue-700' : 'bg-blue-100 border-blue-400',
          text: darkMode ? 'text-blue-100' : 'text-blue-800',
          icon: 'ℹ️'
        };
      case 'achievement':
        return {
          bg: darkMode ? 'bg-amber-900/90 border-amber-500' : 'bg-amber-100 border-amber-400',
          text: darkMode ? 'text-amber-100' : 'text-amber-800',
          icon: '🏆'
        };
      default: // success
        return {
          bg: darkMode ? 'bg-green-900/90 border-green-700' : 'bg-green-100 border-green-400',
          text: darkMode ? 'text-green-100' : 'text-green-800',
          icon: '✓'
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

const ToastContainer = ({ notifications, onDismiss, darkMode }) => {
  return (
    <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2 max-w-sm">
      {notifications.map((notif) => (
        <ToastNotification
          key={notif.id}
          notification={notif}
          onDismiss={() => onDismiss(notif.id)}
          darkMode={darkMode}
        />
      ))}
    </div>
  );
};

export { ToastNotification, ToastContainer };
export default ToastContainer;
