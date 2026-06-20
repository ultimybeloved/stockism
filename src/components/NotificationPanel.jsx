import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { getThemeClasses } from '../utils/theme';
import {
  FILTER_TABS,
  getNotificationCategory,
  getNotificationRoute,
  hasExpandableDetail,
} from '../utils/notifications';
import NotificationRow from './notifications/NotificationRow';

export default function NotificationPanel({
  darkMode,
  notifications,
  onClose,
  onMarkRead,
  onMarkAllRead,
  onClearAll,
  onDelete,
}) {
  const navigate = useNavigate();
  const [filter, setFilter] = useState('All');
  const [expandedId, setExpandedId] = useState(null);

  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  const all = notifications || [];
  const unreadCount = all.filter((n) => !n.read).length;
  const visible = filter === 'All' ? all : all.filter((n) => getNotificationCategory(n) === filter);
  const visibleIds = visible.map((n) => n.id);
  const visibleUnreadIds = visible.filter((n) => !n.read).map((n) => n.id);
  const scope = filter === 'All' ? 'All' : filter;

  const handleRowClick = (notification) => {
    if (!notification.read) onMarkRead(notification.id);
    const route = getNotificationRoute(notification);
    if (route) {
      navigate(route);
      onClose();
      return;
    }
    if (hasExpandableDetail(notification)) {
      setExpandedId((cur) => (cur === notification.id ? null : notification.id));
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-50" onClick={onClose} />

      {/* Panel — fixed to top-right below header */}
      <div className={`fixed top-16 right-4 w-80 rounded-sm shadow-xl border z-50 flex flex-col max-h-[70vh] ${cardClass}`}>
        {/* Header */}
        <div className={`flex items-center justify-between px-4 py-3 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <h3 className={`font-semibold text-sm ${textClass}`}>
            Notifications{unreadCount > 0 && <span className="text-orange-600"> ({unreadCount})</span>}
          </h3>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onMarkAllRead(visibleUnreadIds)}
              className="text-xs text-orange-600 hover:text-orange-500 font-semibold transition-colors"
            >
              Mark {scope} Read
            </button>
            <button
              onClick={() => onClearAll(visibleIds)}
              className={`text-xs font-semibold transition-colors ${mutedClass} hover:text-orange-600`}
            >
              Clear {scope}
            </button>
          </div>
        </div>

        {/* Filter tabs */}
        <div className={`flex items-center gap-1 px-2 py-2 border-b overflow-x-auto ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          {FILTER_TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => setFilter(tab)}
              className={`text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition-colors ${
                filter === tab
                  ? 'bg-orange-600 text-white'
                  : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-slate-500 hover:bg-zinc-100'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        {/* Notification list */}
        <div className="flex-1 overflow-y-auto">
          {visible.length === 0 ? (
            <div className={`px-4 py-8 text-center text-sm ${mutedClass}`}>
              {all.length === 0 ? 'No notifications yet' : `No ${filter.toLowerCase()} notifications`}
            </div>
          ) : (
            visible.map((notification) => (
              <NotificationRow
                key={notification.id}
                notification={notification}
                darkMode={darkMode}
                expanded={expandedId === notification.id}
                actionable={!!getNotificationRoute(notification)}
                canExpand={!getNotificationRoute(notification) && hasExpandableDetail(notification)}
                onClick={handleRowClick}
                onToggleExpand={(id) => setExpandedId((cur) => (cur === id ? null : id))}
                onDelete={onDelete}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
