import { useState, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { CREWS, CREW_MAP } from '../crews';
import { formatCurrency } from '../utils/formatters';
import PinDisplay from '../components/common/PinDisplay';
import { COSMETIC_MAP } from '../constants/cosmetics';
import { getThemeClasses } from '../utils/theme';

const LeaderboardPage = () => {
  const { darkMode, user, userData } = useAppContext();
  const [crewFilter, setCrewFilter] = useState('ALL');
  const [sortBy, setSortBy] = useState('value');
  const { leaders: filteredLeaders, userRank, loading } = useLeaderboard(sortBy, crewFilter, user);
  const scrollContainerRef = useRef(null);
  const userRowRef = useRef(null);
  const [userRowPosition, setUserRowPosition] = useState('unknown');

  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);

  const getRankStyle = (rank) => {
    if (rank === 1) return 'text-yellow-500';
    if (rank === 2) return 'text-zinc-400';
    if (rank === 3) return 'text-amber-600';
    return mutedClass;
  };

  const getRankEmoji = (rank) => {
    if (rank === 1) return '🥇';
    if (rank === 2) return '🥈';
    if (rank === 3) return '🥉';
    return `#${rank}`;
  };

  const userInList = useMemo(
    () => filteredLeaders.some(leader => user && leader.id === user.uid),
    [filteredLeaders, user]
  );


  // Track whether user's row has scrolled above or below the visible area
  useEffect(() => {
    const container = scrollContainerRef.current;
    const userRow = userRowRef.current;

    if (!container || !userRow) {
      setUserRowPosition('unknown');
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setUserRowPosition('visible');
        } else {
          const rowRect = entry.boundingClientRect;
          const containerRect = entry.rootBounds;
          setUserRowPosition(rowRect.bottom < containerRect.top ? 'above' : 'below');
        }
      },
      {
        root: container,
        threshold: [0, 0.1]
      }
    );

    observer.observe(userRow);

    return () => {
      observer.disconnect();
    };
  }, [filteredLeaders, user]);

  const userCrewColor = userData?.crew ? CREW_MAP[userData.crew]?.color : '#6b7280';

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className={`${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}>
        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <h2 className={`text-lg font-semibold ${textClass} mb-3`}>🏆 Leaderboard</h2>

          {/* Crew Filter */}
          <div className="grid grid-cols-5 gap-1.5">
            <button
              onClick={() => setCrewFilter('ALL')}
              className={`px-2 py-1.5 text-xs rounded-full font-semibold transition-colors ${
                crewFilter === 'ALL'
                  ? 'bg-orange-600 text-white'
                  : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
              }`}
            >
              All
            </button>
            {Object.values(CREWS).map(crew => (
              <button
                key={crew.id}
                onClick={() => setCrewFilter(crew.id)}
                className={`px-2 py-1.5 text-xs rounded-full font-semibold flex items-center justify-center gap-1 truncate transition-colors ${
                  crewFilter === crew.id
                    ? 'text-white'
                    : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
                }`}
                style={crewFilter === crew.id ? { backgroundColor: crew.color } : {}}
              >
                {crew.icon ? (
                  <img src={crew.icon} alt="" className="w-3.5 h-3.5 object-contain shrink-0" />
                ) : (
                  <span className="shrink-0">{crew.emblem}</span>
                )}
                <span className="truncate">{crew.name}</span>
              </button>
            ))}
          </div>

          {/* Sort Toggle */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setSortBy('value')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                sortBy === 'value'
                  ? 'bg-orange-600 text-white'
                  : darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
              }`}
            >
              Net Worth
            </button>
            <button
              onClick={() => setSortBy('weeklyGain')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                sortBy === 'weeklyGain'
                  ? 'bg-emerald-600 text-white'
                  : darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
              }`}
            >
              Top Gainers
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef}>
          {/* Sticky Header - shown when user row has scrolled above viewport */}
          {user && userRank && userInList && userRowPosition === 'above' && (
            <div
              className="sticky top-0 z-10 px-4 py-2 flex justify-between items-center border-b"
              style={{
                backgroundColor: darkMode ? '#18181b' : '#ffffff',
                borderColor: userCrewColor,
                boxShadow: `0 2px 8px ${userCrewColor}40`,
              }}
            >
              <div className={`text-sm font-semibold ${textClass}`}>
                <span style={{ color: userCrewColor }}>#{userRank}</span> {userData?.displayName}
              </div>
              <div className={`text-sm font-bold ${textClass}`}>
                {formatCurrency(userData?.portfolioValue || 0)}
              </div>
            </div>
          )}

          {loading ? (
            <div className={`text-center py-8 ${mutedClass}`}>Loading...</div>
          ) : filteredLeaders.length === 0 ? (
            <div className={`text-center py-8 ${mutedClass}`}>
              <p>No traders{crewFilter !== 'ALL' ? ' in this crew' : ''} yet!</p>
              <p className="text-sm">Be the first to make your mark.</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-700">
              {filteredLeaders.map(leader => {
                const displayRank = crewFilter === 'ALL' ? leader.rank : leader.crewRank;
                const crew = leader.crew ? CREW_MAP[leader.crew] : null;
                const isCurrentUser = user && leader.id === user.uid;
                const ac = leader.activeCosmetics || {};
                const nameColorC = ac.nameColor ? COSMETIC_MAP[ac.nameColor] : null;
                const rowGlowC = ac.rowGlow ? COSMETIC_MAP[ac.rowGlow] : null;
                const rowBackdropC = ac.rowBackdrop ? COSMETIC_MAP[ac.rowBackdrop] : null;

                return (
                  <div
                    key={leader.id}
                    ref={isCurrentUser ? userRowRef : null}
                    className={`p-3 flex items-center gap-3 ${
                      displayRank <= 3 ? (darkMode ? 'bg-zinc-900/50' : 'bg-amber-50') : ''
                    } ${
                      isCurrentUser ? 'border-l-4' : ''
                    }`}
                    style={{
                      ...(isCurrentUser ? {
                        borderLeftColor: userCrewColor,
                        backgroundColor: rowBackdropC ? (darkMode ? `${rowBackdropC.color}18` : `${rowBackdropC.color}12`) : (darkMode ? `${userCrewColor}20` : `${userCrewColor}15`),
                        boxShadow: rowGlowC ? `0 0 18px ${rowGlowC.color}50` : `inset 0 0 12px ${userCrewColor}30`,
                        willChange: 'auto',
                        contain: 'layout style paint',
                      } : {
                        ...(rowGlowC ? { boxShadow: `0 0 18px ${rowGlowC.color}50` } : {}),
                        ...(rowBackdropC ? { backgroundColor: darkMode ? `${rowBackdropC.color}18` : `${rowBackdropC.color}12` } : {}),
                      }),
                    }}
                  >
                    <div className={`w-10 text-center font-bold ${getRankStyle(displayRank)}`}>
                      {getRankEmoji(displayRank)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold truncate ${textClass} flex items-center gap-1`}>
                        {leader.isPublic ? (
                          <Link
                            to={`/u/${(leader.displayName || '').toLowerCase()}`}
                            className="hover:underline"
                            style={{ color: nameColorC?.color || (leader.isCrewHead && crew ? leader.crewHeadColor || crew.color : undefined) }}
                          >
                            {leader.displayName || 'Anonymous Trader'}
                          </Link>
                        ) : (
                          <span style={{ color: nameColorC?.color || (leader.isCrewHead && crew ? leader.crewHeadColor || crew.color : undefined) }}>
                            {leader.displayName || 'Anonymous Trader'}
                          </span>
                        )}
                        {leader.isPublic && <span className="text-xs" title="Public profile">🌐</span>}
                        <PinDisplay userData={leader} size="sm" />
                      </div>
                      {leader.previousDisplayName && leader.nameChangedAt &&
                        Date.now() - (leader.nameChangedAt._seconds ? leader.nameChangedAt._seconds * 1000 : leader.nameChangedAt) < 30 * 24 * 60 * 60 * 1000 && (
                        <div className={`text-xs ${mutedClass}`}>formerly {leader.previousDisplayName}</div>
                      )}
                      <div className={`text-xs ${mutedClass}`}>
                        {leader.holdingsCount || 0} characters
                      </div>
                    </div>
                    <div className="text-right">
                      {sortBy === 'weeklyGain' ? (
                        <>
                          <div className={`font-bold ${(leader.weeklyGain || 0) >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {(leader.weeklyGain || 0) >= 0 ? '+' : ''}{formatCurrency(leader.weeklyGain || 0)}
                          </div>
                          <div className={`text-xs ${mutedClass}`}>
                            {(leader.weeklyGainPercent || 0) >= 0 ? '+' : ''}{(leader.weeklyGainPercent || 0).toFixed(1)}%
                          </div>
                        </>
                      ) : (
                        <div className={`font-bold ${textClass}`}>{formatCurrency(leader.portfolioValue || 0)}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sticky Footer - shown when user row is below viewport */}
          {user && userRank && !loading && (userRowPosition === 'below' || !userInList) && (
            <div
              className="sticky bottom-0 z-10 px-4 py-3 flex justify-between items-center border-t"
              style={{
                backgroundColor: darkMode ? '#18181b' : '#ffffff',
                borderColor: userCrewColor,
                boxShadow: `0 -2px 12px ${userCrewColor}40`,
              }}
            >
              <div className={`text-sm font-semibold ${textClass}`}>
                <span style={{ color: userCrewColor }}>Your Rank: #{userRank}</span>
                <span className={`ml-2 ${mutedClass}`}>• {userData?.displayName}</span>
              </div>
              <div className={`text-sm font-bold ${textClass}`}>
                {formatCurrency(userData?.portfolioValue || 0)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPage;
