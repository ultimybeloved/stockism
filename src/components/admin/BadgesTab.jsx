import React from 'react';
import { ACHIEVEMENTS } from '../../constants/achievements';

const BadgesTab = ({
  darkMode,
  textClass,
  mutedClass,
  loading,
  badgesLoaded,
  badgeUsers,
  expandedBadge,
  setExpandedBadge,
  handleRemoveAchievement,
}) => {
  return (
    <div className="space-y-4 p-4" onClick={e => e.stopPropagation()}>
      <h3 className={`text-lg font-bold ${darkMode ? 'text-white' : 'text-slate-900'}`}>Achievement Badges</h3>
      {!badgesLoaded ? (
        <p className={mutedClass}>Loading...</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {Object.values(ACHIEVEMENTS).map(ach => {
            const holders = badgeUsers.filter(u => u.achievements.includes(ach.id));
            const isExpanded = expandedBadge === ach.id;
            return (
              <div key={ach.id} className={`rounded-sm border ${darkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-slate-200'}`}>
                <button
                  onClick={() => setExpandedBadge(isExpanded ? null : ach.id)}
                  className={`w-full text-left p-3 flex items-center justify-between hover:bg-slate-500/10 transition-colors`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{ach.emoji}</span>
                    <div>
                      <div className={`font-semibold text-sm ${darkMode ? 'text-white' : 'text-slate-900'}`}>{ach.name}</div>
                      <div className={`text-xs ${mutedClass}`}>{ach.description}</div>
                    </div>
                  </div>
                  <span className={`text-sm font-bold ${holders.length > 0 ? 'text-amber-500' : mutedClass}`}>
                    {holders.length}
                  </span>
                </button>
                {isExpanded && holders.length > 0 && (
                  <div className={`border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} max-h-64 overflow-y-auto`}>
                    {holders
                      .sort((a, b) => (b.portfolioValue || 0) - (a.portfolioValue || 0))
                      .map(u => (
                      <div key={u.id} className={`px-3 py-2 flex items-center justify-between text-sm ${darkMode ? 'hover:bg-slate-700' : 'hover:bg-slate-50'}`}>
                        <div>
                          <span className={darkMode ? 'text-white' : 'text-slate-900'}>{u.displayName}</span>
                          {u.isBot && <span className="ml-1 text-xs text-purple-400">(bot)</span>}
                          <span className={`ml-2 text-xs ${mutedClass}`}>${(u.portfolioValue || 0).toLocaleString()}</span>
                          {u.achievementDates[ach.id] && (
                            <span className={`ml-2 text-xs ${mutedClass}`}>
                              {new Date(u.achievementDates[ach.id]).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        <button
                          onClick={() => handleRemoveAchievement(u.id, ach.id, u.displayName)}
                          className="text-xs px-2 py-1 bg-red-600 hover:bg-red-700 text-white rounded-sm"
                          disabled={loading}
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {isExpanded && holders.length === 0 && (
                  <div className={`p-3 text-sm border-t ${darkMode ? 'border-slate-700' : 'border-slate-200'} ${mutedClass}`}>
                    No holders
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default BadgesTab;
