import { useState } from 'react';
import CrewMissionsTab from '../missions/CrewMissionsTab';
import { CREW_MAP, getWeekId, getCrewWeeklyMissions, getDailyMissions, getCrewMultiplier } from '../../crews';
import { formatCurrency } from '../../utils/formatters';
import { getTodayDateString } from '../../utils/date';
import { getDailyMissionProgress, getWeeklyMissionProgress, getDaysUntilWeeklyReset } from '../../utils/missionProgress';
import { getThemeClasses, getReadableCrewColor } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';
import { useEscapeKey } from '../../hooks/useEscapeKey';

const DailyMissionsModal = ({ onClose, onClaimReward, onClaimWeeklyReward, onRerollMissions, onOpenCrewSelection, portfolioValue, isGuest, claimLoading, claimWeeklyLoading, rerollLoading }) => {
  useEscapeKey(onClose);
  const { darkMode, userData, prices, crewStats } = useAppContext();
  const [activeTab, setActiveTab] = useState('daily');

  const { textClass, mutedClass, borderClass, overlayClass, modalShellClass, cardEdgeClass } = getThemeClasses(darkMode);

  const today = getTodayDateString();
  const weekId = getWeekId();
  const dailyProgress = userData?.dailyMissions?.[today] || {};
  const weeklyProgress = userData?.weeklyMissions?.[weekId] || {};
  const userCrew = userData?.crew;
  const crewMembers = userCrew ? CREW_MAP[userCrew]?.members || [] : [];

  // Get reroll seed if any
  const rerollSeed = userData?.weeklyMissions?.[weekId]?.rerollSeed || 0;
  const hasRerolled = !!userData?.weeklyMissions?.[weekId]?.rerolled;

  // Underdog bonus: rewards shown (and paid by the server) are the base
  // amounts times this week's crew multiplier from market/crewStats.
  const crewMultiplier = getCrewMultiplier(crewStats, userCrew);

  const todaysMissions = getDailyMissions(today, userCrew, rerollSeed);

  const missions = todaysMissions.map(mission => ({
    ...mission,
    reward: Math.round(mission.reward * crewMultiplier),
    ...getDailyMissionProgress(mission, { holdings: userData?.holdings || {}, dailyProgress, crewMembers }),
    claimed: dailyProgress.claimed?.[mission.id] || false
  }));

  const totalRewards = missions.reduce((sum, m) => sum + m.reward, 0);
  const earnedRewards = missions.filter(m => m.complete && m.claimed).reduce((sum, m) => sum + m.reward, 0);
  const claimableRewards = missions.filter(m => m.complete && !m.claimed).reduce((sum, m) => sum + m.reward, 0);

  // ============================================
  // WEEKLY MISSIONS
  // ============================================

  // Get this crew's 2 weekly missions
  const thisWeeksMissions = userCrew ? getCrewWeeklyMissions(userCrew, weekId, rerollSeed) : [];

  const weeklyMissions = thisWeeksMissions.map(mission => ({
    ...mission,
    reward: Math.round(mission.reward * crewMultiplier),
    ...getWeeklyMissionProgress(mission, { holdings: userData?.holdings || {}, weeklyProgress, prices, crewMembers, portfolioValue }),
    claimed: weeklyProgress.claimed?.[mission.id] || false
  }));

  const weeklyTotalRewards = weeklyMissions.reduce((sum, m) => sum + m.reward, 0);
  const weeklyEarnedRewards = weeklyMissions.filter(m => m.complete && m.claimed).reduce((sum, m) => sum + m.reward, 0);
  const weeklyClaimableRewards = weeklyMissions.filter(m => m.complete && !m.claimed).reduce((sum, m) => sum + m.reward, 0);


  // Check if user has no crew
  const noCrew = !userCrew;

  return (
    <div className={`${overlayClass} z-50`} onClick={onClose}>
      <div className={`${modalShellClass} max-w-md overflow-hidden`}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <div className="flex justify-between items-center">
            <h2 className={`text-lg font-semibold ${textClass}`}>📋 Missions</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-500 text-xl`}>×</button>
          </div>
        </div>

        {/* Tabs */}
        <div className={`grid grid-cols-3 border-b ${cardEdgeClass}`}>
          <button
            onClick={() => setActiveTab('daily')}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'daily'
                ? 'text-orange-500 border-b-2 border-orange-500 bg-orange-500/10'
                : `${mutedClass} hover:bg-slate-500/10`
            }`}
          >
            Daily {claimableRewards > 0 && <span className={`ml-1 ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>●</span>}
          </button>
          <button
            onClick={() => setActiveTab('weekly')}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'weekly'
                ? 'text-purple-500 border-b-2 border-purple-500 bg-purple-500/10'
                : `${mutedClass} hover:bg-slate-500/10`
            }`}
          >
            Weekly {weeklyClaimableRewards > 0 && <span className={`ml-1 ${userData?.colorBlindMode ? 'text-teal-500' : 'text-green-500'}`}>●</span>}
          </button>
          <button
            onClick={() => setActiveTab('crew')}
            className={`py-2.5 text-sm font-semibold transition-colors ${
              activeTab === 'crew'
                ? 'text-blue-500 border-b-2 border-blue-500 bg-blue-500/10'
                : `${mutedClass} hover:bg-slate-500/10`
            }`}
          >
            Crew
          </button>
        </div>

        {/* Subheader */}
        {!isGuest && !noCrew && activeTab !== 'crew' && (
          <div className={`px-4 py-2 ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} flex items-center justify-between`}>
            {activeTab === 'daily' ? (
              <p className={`text-xs ${mutedClass}`}>
                Resets daily • Earned: <span className="text-orange-500">{formatCurrency(earnedRewards)}</span> / {formatCurrency(totalRewards)}
              </p>
            ) : (
              <p className={`text-xs ${mutedClass}`}>
                Resets Monday • {getDaysUntilWeeklyReset()} days left • Earned: <span className="text-purple-500">{formatCurrency(weeklyEarnedRewards)}</span> / {formatCurrency(weeklyTotalRewards)}
              </p>
            )}
            {!hasRerolled && (earnedRewards === 0 && weeklyEarnedRewards === 0) && (userData?.cash || 0) >= 50 && (
              <button
                onClick={onRerollMissions}
                disabled={rerollLoading}
                className={`flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded-sm transition-colors ${
                  rerollLoading
                    ? 'opacity-50 cursor-not-allowed'
                    : darkMode
                      ? 'bg-zinc-700 hover:bg-zinc-600 text-zinc-200'
                      : 'bg-amber-200 hover:bg-amber-300 text-amber-800'
                }`}
                title="Reroll all missions ($50)"
              >
                {rerollLoading ? '...' : '🎲 Reroll $50'}
              </button>
            )}
            {hasRerolled && (
              <span className={`text-xs ${mutedClass} italic`}>Rerolled ✓</span>
            )}
          </div>
        )}

        {/* Underdog bonus banner */}
        {!isGuest && !noCrew && crewMultiplier > 1 && (
          <div className={`px-4 py-1.5 ${darkMode ? 'bg-orange-900/30' : 'bg-orange-100'} border-b border-orange-500/30`}>
            <p className="text-orange-500 text-xs text-center font-semibold">
              🔥 Underdog bonus: all mission rewards x{crewMultiplier} this week
            </p>
          </div>
        )}

        <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
          {activeTab === 'crew' ? (
            <CrewMissionsTab />
          ) : isGuest ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} text-center`}>
              <p className={`text-amber-500 mb-2`}>Sign in to access missions!</p>
              <p className={`text-xs ${mutedClass}`}>Complete missions to earn bonus cash rewards.</p>
            </div>
          ) : noCrew ? (
            <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-amber-50'} text-center`}>
              <p className={`${mutedClass} mb-2`}>Join a crew to unlock missions!</p>
              <p className={`text-xs ${mutedClass} mb-3`}>Crew missions give you bonus cash rewards.</p>
              {onOpenCrewSelection && (
                <button
                  onClick={() => { onClose(); onOpenCrewSelection(); }}
                  className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
                >
                  🏴 Choose a Crew
                </button>
              )}
            </div>
          ) : activeTab === 'daily' ? (
            <>
              {missions.map(mission => (
                <div
                  key={mission.id}
                  className={`p-3 rounded-sm border ${
                    mission.claimed
                      ? 'border-orange-500/30 bg-orange-500/5'
                      : mission.complete
                        ? 'border-orange-500 bg-orange-500/10'
                        : borderClass
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
                      <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
                    </div>
                    <span className={`text-sm font-bold ${mission.complete ? 'text-orange-500' : mutedClass}`}>
                      +{formatCurrency(mission.reward)}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="flex items-center gap-2">
                    <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                      <div
                        className={`h-full rounded-full transition-all ${mission.complete ? 'bg-orange-500' : 'bg-amber-500'}`}
                        style={{ width: `${Math.min(100, mission.target > 0 ? (mission.progress / mission.target) * 100 : 0)}%` }}
                      />
                    </div>
                    <span className={`text-xs ${mutedClass} w-12 text-right`}>
                      {mission.progress}/{mission.target}
                    </span>
                  </div>

                  {/* Claim button */}
                  {mission.complete && !mission.claimed && (
                    <button
                      onClick={() => onClaimReward(mission.id, mission.reward)}
                      disabled={claimLoading}
                      className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-orange-600 hover:bg-orange-700 text-white disabled:opacity-50"
                    >
                      {claimLoading ? 'Claiming...' : 'Claim Reward'}
                    </button>
                  )}
                  {mission.claimed && (
                    <p className="text-xs text-orange-500 mt-2 text-center">✓ Claimed</p>
                  )}
                </div>
              ))}

              {/* Crew member hint */}
              <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-amber-50'}`}>
                <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                  {CREW_MAP[userCrew]?.icon ? (
                    <img src={CREW_MAP[userCrew]?.icon} alt="" className="w-4 h-4 object-contain inline" />
                  ) : (
                    <span style={{ color: getReadableCrewColor(CREW_MAP[userCrew]?.color, darkMode) }}>{CREW_MAP[userCrew]?.emblem}</span>
                  )}
                  <span style={{ color: getReadableCrewColor(CREW_MAP[userCrew]?.color, darkMode) }}>{CREW_MAP[userCrew]?.name}</span> members: {crewMembers.join(', ')}
                </p>
              </div>
            </>
          ) : (
            /* WEEKLY MISSIONS TAB */
            <>
              {weeklyMissions.length === 0 ? (
                <div className={`p-4 rounded-sm ${darkMode ? 'bg-zinc-800/50' : 'bg-purple-50'} text-center`}>
                  <p className={`${mutedClass}`}>No weekly missions available</p>
                </div>
              ) : (
                weeklyMissions.map(mission => (
                  <div
                    key={mission.id}
                    className={`p-3 rounded-sm border ${
                      mission.claimed
                        ? 'border-purple-500/30 bg-purple-500/5'
                        : mission.complete
                          ? 'border-purple-500 bg-purple-500/10'
                          : borderClass
                    }`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <div>
                        <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
                        <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
                      </div>
                      <span className={`text-sm font-bold ${mission.complete ? 'text-purple-500' : mutedClass}`}>
                        +{formatCurrency(mission.reward)}
                      </span>
                    </div>

                    {/* Progress bar */}
                    <div className="flex items-center gap-2">
                      <div className={`flex-1 h-2 rounded-full ${darkMode ? 'bg-zinc-800' : 'bg-slate-200'}`}>
                        <div
                          className={`h-full rounded-full transition-all ${mission.complete ? 'bg-purple-500' : 'bg-purple-400'}`}
                          style={{ width: `${Math.min(100, mission.target > 0 ? (mission.progress / mission.target) * 100 : 0)}%` }}
                        />
                      </div>
                      <span className={`text-xs ${mutedClass} w-16 text-right`}>
                        {mission.progress >= 1000 ? `${(mission.progress/1000).toFixed(1)}k` : mission.progress}/{mission.target >= 1000 ? `${(mission.target/1000).toFixed(0)}k` : mission.target}
                      </span>
                    </div>

                    {/* Claim button */}
                    {mission.complete && !mission.claimed && (
                      <button
                        onClick={() => onClaimWeeklyReward(mission.id, mission.reward)}
                        disabled={claimWeeklyLoading}
                        className="w-full mt-2 py-1.5 text-sm font-semibold rounded-sm bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
                      >
                        {claimWeeklyLoading ? 'Claiming...' : 'Claim Reward'}
                      </button>
                    )}
                    {mission.claimed && (
                      <p className="text-xs text-purple-500 mt-2 text-center">✓ Claimed</p>
                    )}
                  </div>
                ))
              )}

              {/* Crew member hint */}
              <div className={`p-2 rounded-sm ${darkMode ? 'bg-zinc-800/30' : 'bg-purple-50'}`}>
                <p className={`text-xs ${mutedClass} flex items-center flex-wrap gap-1`}>
                  {CREW_MAP[userCrew]?.icon ? (
                    <img src={CREW_MAP[userCrew]?.icon} alt="" className="w-4 h-4 object-contain inline" />
                  ) : (
                    <span style={{ color: getReadableCrewColor(CREW_MAP[userCrew]?.color, darkMode) }}>{CREW_MAP[userCrew]?.emblem}</span>
                  )}
                  <span style={{ color: getReadableCrewColor(CREW_MAP[userCrew]?.color, darkMode) }}>{CREW_MAP[userCrew]?.name}</span> members: {crewMembers.join(', ')}
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default DailyMissionsModal;
