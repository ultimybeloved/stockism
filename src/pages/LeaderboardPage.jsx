import React, { useState, useEffect, useMemo, useRef } from 'react';
import { getLeaderboardFunction } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { CREWS, CREW_MAP } from '../crews';
import { formatCurrency } from '../utils/formatters';
import PinDisplay from '../components/common/PinDisplay';

const LeaderboardPage = () => {
  const { darkMode, user, userData } = useAppContext();
  const [leaders, setLeaders] = useState([]);
  const [crewLeaders, setCrewLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [crewLoading, setCrewLoading] = useState(false);
  const [crewFilter, setCrewFilter] = useState('ALL');
  const [userRank, setUserRank] = useState(null);
  const scrollContainerRef = useRef(null);
  const userRowRef = useRef(null);
  const [userRowPosition, setUserRowPosition] = useState('unknown');
  const crewCache = useRef({});

  // Fetch main top 50 leaderboard (only once on mount)
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const result = await getLeaderboardFunction();
        const leaderData = result.data.leaderboard.map((user, index) => ({
          rank: index + 1,
          ...user,
          id: user.userId
        }));
        setLeaders(leaderData);
        setUserRank(result.data.callerRank);
        crewCache.current['ALL'] = { leaders: leaderData, callerRank: result.data.callerRank };
      } catch (err) {
        console.error('Failed to fetch leaderboard:', err);
      }
      setLoading(false);
    };
    fetchLeaderboard();
  }, []);

  // Fetch crew-specific leaderboard when crew filter changes
  useEffect(() => {
    if (crewFilter === 'ALL') {
      setCrewLeaders([]);
      if (crewCache.current['ALL']) {
        setUserRank(crewCache.current['ALL'].callerRank);
      }
      return;
    }

    // Use cached data if available
    if (crewCache.current[crewFilter]) {
      const cached = crewCache.current[crewFilter];
      setCrewLeaders(cached.leaders);
      setUserRank(cached.callerRank);
      return;
    }

    const fetchCrewLeaderboard = async () => {
      setCrewLoading(true);
      try {
        const result = await getLeaderboardFunction({ crew: crewFilter });
        const crewMembers = result.data.leaderboard.map((user, idx) => ({
          ...user,
          id: user.userId,
          crewRank: idx + 1
        }));
        setCrewLeaders(crewMembers);
        setUserRank(result.data.callerRank);
        crewCache.current[crewFilter] = { leaders: crewMembers, callerRank: result.data.callerRank };
      } catch (err) {
        console.error('Failed to fetch crew leaderboard:', err);
      }
      setCrewLoading(false);
    };
    fetchCrewLeaderboard();
  }, [crewFilter]);

  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

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

  const filteredLeaders = useMemo(() => {
    if (crewFilter === 'ALL') return leaders;
    return crewLeaders;
  }, [leaders, crewLeaders, crewFilter]);


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
        </div>

        <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef}>
          {/* Sticky Header - shown when user row has scrolled above viewport */}
          {user && userRank && userRowPosition === 'above' && (
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

          {(loading || crewLoading) ? (
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

                return (
                  <div
                    key={leader.id}
                    ref={isCurrentUser ? userRowRef : null}
                    className={`p-3 flex items-center gap-3 ${
                      displayRank <= 3 ? (darkMode ? 'bg-zinc-900/50' : 'bg-amber-50') : ''
                    } ${
                      isCurrentUser ? 'border-l-4' : ''
                    }`}
                    style={isCurrentUser ? {
                      borderLeftColor: userCrewColor,
                      backgroundColor: darkMode ? `${userCrewColor}20` : `${userCrewColor}15`,
                      boxShadow: `inset 0 0 12px ${userCrewColor}30`,
                      willChange: 'auto',
                      contain: 'layout style paint'
                    } : {}}
                  >
                    <div className={`w-10 text-center font-bold ${getRankStyle(displayRank)}`}>
                      {getRankEmoji(displayRank)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold truncate ${textClass} flex items-center`}>
                        <span style={leader.isCrewHead && crew ? { color: leader.crewHeadColor || crew.color } : {}}>
                          {leader.displayName || 'Anonymous Trader'}
                        </span>
                        <PinDisplay userData={leader} size="sm" />
                      </div>
                      <div className={`text-xs ${mutedClass}`}>
                        {leader.holdingsCount || 0} characters
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={`font-bold ${textClass}`}>{formatCurrency(leader.portfolioValue || 0)}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Sticky Footer - shown when user row is below viewport */}
          {user && userRank && !loading && userRowPosition === 'below' && (
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
