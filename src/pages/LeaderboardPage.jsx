import React, { useState, useEffect, useMemo, useRef } from 'react';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAppContext } from '../context/AppContext';
import { CREWS, CREW_MAP } from '../crews';
import { formatCurrency } from '../utils/formatters';
import PinDisplay from '../components/common/PinDisplay';

const LeaderboardPage = () => {
  const { darkMode, user, userData } = useAppContext();
  const [leaders, setLeaders] = useState([]);
  const [crewLeaders, setCrewLeaders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [crewFilter, setCrewFilter] = useState('ALL');
  const [userRank, setUserRank] = useState(null);
  const scrollContainerRef = useRef(null);
  const userRowRef = useRef(null);
  const stickyHeaderRef = useRef(null);
  const stickyFooterRef = useRef(null);

  // Fetch main top 50 leaderboard
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc'),
          limit(100)
        );
        const snapshot = await getDocs(q);
        const leaderData = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id }))
          .filter(user => !user.isBot)
          .slice(0, 50)
          .map((user, index) => ({
            rank: index + 1,
            ...user
          }));
        setLeaders(leaderData);
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
      return;
    }

    const fetchCrewLeaderboard = async () => {
      try {
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc')
        );
        const snapshot = await getDocs(q);
        const crewMembers = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id }))
          .filter(user => user.crew === crewFilter && !user.isBot)
          .slice(0, 50)
          .map((user, idx) => ({ ...user, crewRank: idx + 1 }));

        setCrewLeaders(crewMembers);
      } catch (err) {
        console.error('Failed to fetch crew leaderboard:', err);
      }
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

  // Calculate user's rank when leaderboard data changes
  useEffect(() => {
    if (!user || !userData) {
      setUserRank(null);
      return;
    }

    const fetchUserRank = async () => {
      try {
        if (crewFilter === 'ALL') {
          const q = query(
            collection(db, 'users'),
            orderBy('portfolioValue', 'desc')
          );
          const snapshot = await getDocs(q);
          const allUsers = snapshot.docs
            .map(doc => ({ id: doc.id, portfolioValue: doc.data().portfolioValue, isBot: doc.data().isBot }))
            .filter(u => !u.isBot);
          const rank = allUsers.findIndex(u => u.id === user.uid) + 1;
          setUserRank(rank || null);
        } else {
          const userInCrew = crewLeaders.findIndex(u => u.id === user.uid);
          setUserRank(userInCrew >= 0 ? userInCrew + 1 : null);
        }
      } catch (err) {
        console.error('Failed to fetch user rank:', err);
      }
    };

    fetchUserRank();
  }, [user, userData, crewFilter, leaders, crewLeaders]);

  // Track user row position via direct DOM manipulation
  useEffect(() => {
    const container = scrollContainerRef.current;
    const userRow = userRowRef.current;
    const header = stickyHeaderRef.current;
    const footer = stickyFooterRef.current;

    if (!container || !userRow || !header || !footer) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          header.style.display = 'none';
          footer.style.display = 'none';
        } else {
          const rowRect = entry.boundingClientRect;
          const containerRect = entry.rootBounds;

          if (rowRect.bottom < containerRect.top) {
            header.style.display = 'flex';
            footer.style.display = 'none';
          } else {
            header.style.display = 'none';
            footer.style.display = 'flex';
          }
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
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setCrewFilter('ALL')}
              className={`px-3 py-1 text-xs rounded-sm font-semibold ${
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
                className={`px-3 py-1 text-xs rounded-sm font-semibold flex items-center gap-1 ${
                  crewFilter === crew.id
                    ? 'text-white'
                    : darkMode ? 'bg-zinc-800 text-zinc-300' : 'bg-slate-200 text-zinc-600'
                }`}
                style={crewFilter === crew.id ? { backgroundColor: crew.color } : {}}
              >
                {crew.icon ? (
                  <img src={crew.icon} alt="" className="w-4 h-4 object-contain" />
                ) : (
                  crew.emblem
                )}
                {crew.name}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef}>
          {/* Sticky Header */}
          {user && userRank && (
            <div
              ref={stickyHeaderRef}
              className="sticky top-0 z-10 px-4 py-2 flex justify-between items-center border-b"
              style={{
                display: 'none',
                backgroundColor: darkMode ? '#18181b' : '#ffffff',
                borderColor: userCrewColor,
                boxShadow: `0 2px 8px ${userCrewColor}40`,
                willChange: 'transform',
                transform: 'translateZ(0)'
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
                        {Object.keys(leader.holdings || {}).filter(k => leader.holdings[k] > 0).length} characters
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

          {/* Sticky Footer */}
          {user && userRank && !loading && (
            <div
              ref={stickyFooterRef}
              className="sticky bottom-0 z-10 px-4 py-3 flex justify-between items-center border-t"
              style={{
                display: 'flex',
                backgroundColor: darkMode ? '#18181b' : '#ffffff',
                borderColor: userCrewColor,
                boxShadow: `0 -2px 12px ${userCrewColor}40`,
                willChange: 'transform',
                transform: 'translateZ(0)'
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
