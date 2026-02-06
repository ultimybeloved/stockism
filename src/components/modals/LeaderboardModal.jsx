import React, { useState, useEffect, useMemo, useRef } from 'react';
import { CREWS, CREW_MAP } from '../../crews';
import PinDisplay from '../common/PinDisplay';
import { db } from '../../firebase';
import { collection, query, orderBy, limit, getDocs } from 'firebase/firestore';
import { formatCurrency } from '../../utils/formatters';

const LeaderboardModal = ({ onClose, darkMode, currentUserCrew, currentUser, currentUserData }) => {
  const [leaders, setLeaders] = useState([]);
  const [crewLeaders, setCrewLeaders] = useState([]); // Separate state for crew-specific leaderboard
  const [loading, setLoading] = useState(true);
  const [crewFilter, setCrewFilter] = useState('ALL'); // 'ALL' or crew ID
  const [userRank, setUserRank] = useState(null); // User's actual rank in current view
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
          limit(100) // Fetch extra to account for bots
        );
        const snapshot = await getDocs(q);
        const leaderData = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id }))
          .filter(user => !user.isBot) // Filter out bots
          .slice(0, 50) // Limit to top 50 real users
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
        // Fetch all users in this crew, sorted by portfolio value
        const q = query(
          collection(db, 'users'),
          orderBy('portfolioValue', 'desc')
        );
        const snapshot = await getDocs(q);
        const crewMembers = snapshot.docs
          .map(doc => ({ ...doc.data(), id: doc.id }))
          .filter(user => user.crew === crewFilter && !user.isBot) // Filter out bots
          .slice(0, 50) // Limit to top 50 crew members
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

  // Use crew-specific leaderboard when filtering, otherwise use main leaderboard
  const filteredLeaders = useMemo(() => {
    if (crewFilter === 'ALL') return leaders;
    return crewLeaders;
  }, [leaders, crewLeaders, crewFilter]);

  // Calculate user's rank when leaderboard data changes
  useEffect(() => {
    if (!currentUser || !currentUserData) {
      setUserRank(null);
      return;
    }

    const fetchUserRank = async () => {
      try {
        if (crewFilter === 'ALL') {
          // Count users with higher portfolio value (excluding bots)
          const q = query(
            collection(db, 'users'),
            orderBy('portfolioValue', 'desc')
          );
          const snapshot = await getDocs(q);
          const allUsers = snapshot.docs
            .map(doc => ({ id: doc.id, portfolioValue: doc.data().portfolioValue, isBot: doc.data().isBot }))
            .filter(u => !u.isBot); // Filter out bots
          const rank = allUsers.findIndex(u => u.id === currentUser.uid) + 1;
          setUserRank(rank || null);
        } else {
          // Crew leaderboard rank
          const userInCrew = crewLeaders.findIndex(u => u.id === currentUser.uid);
          setUserRank(userInCrew >= 0 ? userInCrew + 1 : null);
        }
      } catch (err) {
        console.error('Failed to fetch user rank:', err);
      }
    };

    fetchUserRank();
  }, [currentUser, currentUserData, crewFilter, leaders, crewLeaders]);

  // Track user row position via direct DOM manipulation (no state updates = no re-renders)
  useEffect(() => {
    const container = scrollContainerRef.current;
    const userRow = userRowRef.current;
    const header = stickyHeaderRef.current;
    const footer = stickyFooterRef.current;

    if (!container || !userRow || !header || !footer) return;

    // Use Intersection Observer to directly update DOM visibility
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          // User row is visible - hide both sticky elements
          header.style.display = 'none';
          footer.style.display = 'none';
        } else {
          // User row is not visible - determine position
          const rowRect = entry.boundingClientRect;
          const containerRect = entry.rootBounds;

          if (rowRect.bottom < containerRect.top) {
            // Row is above viewport - show header, hide footer
            header.style.display = 'flex';
            footer.style.display = 'none';
          } else {
            // Row is below viewport - show footer, hide header
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
  }, [filteredLeaders, currentUser]);

  // Get user's crew color
  const userCrewColor = currentUserData?.crew ? CREW_MAP[currentUserData.crew]?.color : '#6b7280';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center p-4 z-50" onClick={onClose}>
      <div className={`w-full max-w-lg ${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[80vh] flex flex-col`}
        onClick={e => e.stopPropagation()}>

        <div className={`p-4 border-b ${darkMode ? 'border-zinc-800' : 'border-amber-200'}`}>
          <div className="flex justify-between items-center mb-3">
            <h2 className={`text-lg font-semibold ${textClass}`}>🏆 Leaderboard</h2>
            <button onClick={onClose} className={`p-2 ${mutedClass} hover:text-orange-600 text-xl`}>×</button>
          </div>

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
          {/* Sticky Header - visibility controlled by IO via ref */}
          {currentUser && userRank && (
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
                <span style={{ color: userCrewColor }}>#{userRank}</span> {currentUserData?.displayName}
              </div>
              <div className={`text-sm font-bold ${textClass}`}>
                {formatCurrency(currentUserData?.portfolioValue || 0)}
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
                const isCurrentUser = currentUser && leader.id === currentUser.uid;

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

          {/* Sticky Footer - visibility controlled by IO via ref */}
          {currentUser && userRank && !loading && (
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
                <span className={`ml-2 ${mutedClass}`}>• {currentUserData?.displayName}</span>
              </div>
              <div className={`text-sm font-bold ${textClass}`}>
                {formatCurrency(currentUserData?.portfolioValue || 0)}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeaderboardModal;
