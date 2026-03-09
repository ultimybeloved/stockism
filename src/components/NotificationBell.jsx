import React from 'react';

export default function NotificationBell({ darkMode, user, onTogglePanel, unreadCount }) {
  return (
    <button
      onClick={onTogglePanel}
      className={`relative p-2 rounded-md transition-colors ${
        darkMode
          ? 'hover:bg-zinc-800 text-zinc-100'
          : 'hover:bg-amber-50 text-slate-900'
      }`}
      title="Notifications"
    >
      <span className="text-lg">🔔</span>
      {unreadCount > 0 && (
        <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] flex items-center justify-center px-1 text-[10px] font-semibold text-white bg-orange-600 rounded-full leading-none">
          {unreadCount > 99 ? '99+' : unreadCount}
        </span>
      )}
    </button>
  );
}
