import React from 'react';

const TYPE_ICONS = {
  trade: '📈',
  alert: '🔔',
  achievement: '🏆',
  margin: '⚠️',
  system: '📢',
};

function formatTimeAgo(ts) {
  if (!ts) return '';
  // Handle Firestore Timestamp objects
  const date = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
  const now = Date.now();
  const diff = now - date.getTime();
  if (diff < 0) return 'just now';
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 60) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString();
}

export default function NotificationPanel({
  darkMode,
  notifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
}) {
  const handleNotificationClick = (notification) => {
    if (!notification.read) {
      onMarkRead(notification.id);
    }
  };

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-600';

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Panel — fixed to top-right below header */}
      <div className={`fixed top-16 right-4 w-80 rounded-sm shadow-xl border z-50 flex flex-col max-h-[70vh] ${cardClass}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <h3 className={`font-semibold text-sm ${textClass}`}>Notifications</h3>
          <div className="flex items-center gap-2">
            <button
              onClick={onMarkAllRead}
              className="text-xs text-orange-600 hover:text-orange-500 font-semibold transition-colors"
            >
              Mark All Read
            </button>
            <button
              onClick={onClearAll}
              className={`text-xs font-semibold transition-colors ${mutedClass} hover:text-orange-600`}
            >
              Clear All
            </button>
          </div>
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto">
          {(!notifications || notifications.length === 0) ? (
            <div className={`px-4 py-8 text-center text-sm ${mutedClass}`}>
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
                      <span className={`text-sm truncate ${!notification.read ? 'font-semibold' : 'font-medium'} ${textClass}`}>
                        {notification.title}
                      </span>
                      <span className={`text-[10px] shrink-0 ${mutedClass}`}>
                        {formatTimeAgo(notification.createdAt)}
                      </span>
                    </div>
                    <p className={`text-xs mt-0.5 line-clamp-2 ${mutedClass}`}>
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
