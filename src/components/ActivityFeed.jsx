import React from 'react';

const ActivityFeed = ({ activities, isOpen, onToggle, darkMode }) => {
  const cardClass = darkMode ? 'bg-zinc-900/95 border-zinc-700' : 'bg-white/95 border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const getActivityIcon = (type) => {
    switch (type) {
      case 'trade': return '📈';
      case 'achievement': return '🏆';
      case 'mission': return '📋';
      case 'checkin': return '✅';
      case 'bet': return '🔮';
      case 'global': return '🌐';
      default: return '•';
    }
  };

  const getActivityColor = (type) => {
    switch (type) {
      case 'trade': return 'text-green-500';
      case 'achievement': return 'text-amber-500';
      case 'mission': return 'text-purple-500';
      case 'checkin': return 'text-teal-500';
      case 'bet': return 'text-orange-500';
      case 'global': return 'text-blue-400';
      default: return mutedClass;
    }
  };

  const formatTime = (timestamp) => {
    const diff = Date.now() - timestamp;
    if (diff < 60000) return 'just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    return new Date(timestamp).toLocaleDateString();
  };

  return (
    <div className={`fixed bottom-4 right-4 z-40 ${cardClass} border rounded-sm shadow-xl transition-all duration-200 ${isOpen ? 'w-80' : 'w-auto'}`}>
      {/* Header / Toggle Button */}
      <button
        onClick={onToggle}
        className={`w-full px-3 py-2 flex items-center justify-between ${textClass} hover:bg-black/10 transition-colors rounded-t-sm`}
      >
        <div className="flex items-center gap-2">
          <span>📜</span>
          <span className="font-semibold text-sm">Activity</span>
          {!isOpen && activities.length > 0 && (
            <span className="bg-orange-500 text-white text-xs px-1.5 py-0.5 rounded-full">{Math.min(activities.length, 99)}</span>
          )}
        </div>
        <span className={`text-xs ${mutedClass}`}>{isOpen ? '▼' : '▲'}</span>
      </button>

      {/* Feed Content */}
      {isOpen && (
        <div className="max-h-64 overflow-y-auto border-t border-inherit">
          {activities.length === 0 ? (
            <div className={`p-4 text-center text-sm ${mutedClass}`}>
              No activity yet. Start trading!
            </div>
          ) : (
            <div className="divide-y divide-inherit">
              {activities.slice(0, 20).map(activity => (
                <div key={activity.id} className={`px-3 py-2 text-sm ${activity.isGlobal ? 'bg-blue-500/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    <span className={getActivityColor(activity.type)}>{getActivityIcon(activity.type)}</span>
                    <div className="flex-1 min-w-0">
                      <div className={`${textClass} break-words`}>{activity.message}</div>
                      <div className={`text-xs ${mutedClass}`}>{formatTime(activity.timestamp)}</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ActivityFeed;
