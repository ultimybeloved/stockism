import React from 'react';

const TYPE_ICONS = {
  trade: '📈',
  alert: '🔔',
  achievement: '🏆',
  margin: '⚠️',
  system: '📢',
};

function formatTimeAgo(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - new Date(timestamp).getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}

export default function NotificationPanel({
  darkMode,
  notifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onNavigate,
}) {
  const handleNotificationClick = (notification) => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
    if (notification.data && onNavigate) {
      onNavigate(notification.data);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Panel */}
      <div
        className={`absolute right-0 top-full mt-2 w-80 rounded-sm shadow-lg border z-50 flex flex-col ${
          darkMode
            ? 'bg-zinc-900 border-zinc-800'
            : 'bg-white border-amber-200'
        }`}
      >
        {/* Header */}
        <div
          className={`flex items-center justify-between px-4 py-3 border-b ${
            darkMode ? 'border-zinc-800' : 'border-amber-200'
          }`}
        >
          <h3
            className={`font-semibold text-sm ${
              darkMode ? 'text-zinc-100' : 'text-slate-900'
            }`}
          >
            Notifications
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={onMarkAllRead}
              className="text-xs text-orange-600 hover:text-orange-500 font-semibold transition-colors"
            >
              Mark All Read
            </button>
            <button
              onClick={onClearAll}
              className={`text-xs font-semibold transition-colors ${
                darkMode
                  ? 'text-zinc-400 hover:text-zinc-300'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Notification list */}
        <div className="max-h-96 overflow-y-auto">
          {(!notifications || notifications.length === 0) ? (
            <div
              className={`px-4 py-8 text-center text-sm ${
                darkMode ? 'text-zinc-400' : 'text-zinc-500'
              }`}
            >
              No notifications yet
            </div>
          ) : (
            notifications.map((notification) => (
              <button
                key={notification.id}
                onClick={() => handleNotificationClick(notification)}
                className={`w-full text-left px-4 py-3 transition-colors border-l-2 ${
                  !notification.read
                    ? darkMode
                      ? 'border-l-orange-600 bg-zinc-800/50 hover:bg-zinc-800'
                      : 'border-l-orange-600 bg-orange-50/50 hover:bg-orange-50'
                    : darkMode
                      ? 'border-l-transparent hover:bg-zinc-800/50'
                      : 'border-l-transparent hover:bg-zinc-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-base mt-0.5 shrink-0">
                    {TYPE_ICONS[notification.type] || '📢'}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`text-sm truncate ${
                          !notification.read ? 'font-semibold' : 'font-medium'
                        } ${darkMode ? 'text-zinc-100' : 'text-slate-900'}`}
                      >
                        {notification.title}
                      </span>
                      <span
                        className={`text-[10px] shrink-0 ${
                          darkMode ? 'text-zinc-400' : 'text-zinc-500'
                        }`}
                      >
                        {formatTimeAgo(notification.timestamp)}
                      </span>
                    </div>
                    <p
                      className={`text-xs mt-0.5 line-clamp-2 ${
                        darkMode ? 'text-zinc-400' : 'text-zinc-500'
                      }`}
                    >
                      {notification.message}
                    </p>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </>
  );
}
