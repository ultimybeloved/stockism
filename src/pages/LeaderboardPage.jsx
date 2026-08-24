import { useState, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAppContext } from '../context/AppContext';
import { useSeason } from '../hooks/useSeason';
import SeasonBoard from '../components/season/SeasonBoard';
import { useUserRowPosition } from '../hooks/useUserRowPosition';
import { getRankEmoji, getRankStyle } from '../utils/leaderboardRank';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { CREW_MAP } from '../crews';
import CrewFilter from '../components/leaderboard/CrewFilter';
import AdminNetToggle from '../components/leaderboard/AdminNetToggle';
import { useAdminNetWorth } from '../hooks/useAdminNetWorth';
import { formatCurrency } from '../utils/formatters';
import PinDisplay from '../components/common/PinDisplay';
import LeaderboardPodium from '../components/leaderboard/LeaderboardPodium';
import { getCosmeticStyles } from '../utils/cosmetics';
import { getThemeClasses, getReadableCrewColor } from '../utils/theme';

const LeaderboardPage = () => {
  const { darkMode, user, userData } = useAppContext();
  const [crewFilter, setCrewFilter] = useState('ALL');
  // Two-level sort control: Net Worth vs Top Gainers, and within gainers a
  // $/% flick that remembers its last setting.
  // 'value' | 'gain' | 'season'. The season card deep-links in with ?board=season.
  const [searchParams] = useSearchParams();
  const { active: seasonActive } = useSeason();
  const [sortMode, setSortMode] = useState(
    searchParams.get('board') === 'season' ? 'season' : 'value'
  );
  const [gainUnit, setGainUnit] = useState('$');     // '$' | '%'
  const sortBy = sortMode === 'value' ? 'value' : (gainUnit === '%' ? 'weeklyGainPercent' : 'weeklyGain');
  const { leaders: rawLeaders, userRank, loading } = useLeaderboard(sortBy, crewFilter, user, userData?.crew);
  // Admin only: re-rank on net worth with margin debt taken off. Returns the
  // untouched list for everyone else.
  const { isAdmin, netMode, setNetMode, adjustedLeaders: filteredLeaders, loadingMargins } =
    useAdminNetWorth(rawLeaders, user);
  const { scrollContainerRef, userRowRef, userRowPosition } = useUserRowPosition([filteredLeaders, user]);

  const { cardClass, textClass, mutedClass, divideClass, chipClass, cardEdgeClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;
  const gainClass = colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const lossClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';


  const userEntry = useMemo(
    () => (user ? filteredLeaders.find(leader => leader.id === user.uid) : null),
    [filteredLeaders, user]
  );
  const userInList = !!userEntry;

  // A rank only makes sense on the global board or the user's own crew board
  const rankRelevant = crewFilter === 'ALL' || crewFilter === userData?.crew;

  // Top 3 get the podium and the scrolling list starts at #4. With fewer than
  // 3 players (tiny crew boards) the plain list covers everyone.
  const showPodium = filteredLeaders.length >= 3;
  const listLeaders = showPodium ? filteredLeaders.slice(3) : filteredLeaders;

  const isGainSort = sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent';
  const fmtPct = (p) => `${(p || 0) >= 0 ? '+' : ''}${(p || 0).toFixed(1)}%`;
  const fmtGain = (g) => `${(g || 0) >= 0 ? '+' : ''}${formatCurrency(g || 0)}`;

  // The value shown in the sticky bars must match what the list is sorted by
  const userStickyValue = isGainSort && userEntry ? (
    <span className={(userEntry.weeklyGain || 0) >= 0 ? gainClass : lossClass}>
      {sortBy === 'weeklyGainPercent' ? fmtPct(userEntry.weeklyGainPercent) : fmtGain(userEntry.weeklyGain)}
    </span>
  ) : (
    formatCurrency(userData?.portfolioValue || 0)
  );


  const userCrewColor = userData?.crew ? CREW_MAP[userData.crew]?.color : '#6b7280';

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className={`${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}>
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <h2 className={`text-lg font-semibold ${textClass} mb-3`}>🏆 Leaderboard</h2>

          {/* Crew Filter */}
          <CrewFilter crewFilter={crewFilter} setCrewFilter={setCrewFilter} chipClass={chipClass} />

          <AdminNetToggle
            isAdmin={isAdmin}
            netMode={netMode}
            setNetMode={setNetMode}
            loading={loadingMargins}
            darkMode={darkMode}
          />

          {/* Sort Toggle */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setSortMode('value')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                sortMode === 'value'
                  ? 'bg-orange-600 text-white'
                  : darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
              }`}
            >
              Net Worth
            </button>
            <button
              onClick={() => setSortMode('gain')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                sortMode === 'gain'
                  ? `${colorBlindMode ? 'bg-teal-600' : 'bg-emerald-600'} text-white`
                  : darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
              }`}
            >
              Top Gainers
            </button>
            {seasonActive && (
              <button
                onClick={() => setSortMode('season')}
                className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                  sortMode === 'season'
                    ? 'bg-amber-500 text-white'
                    : darkMode ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700' : 'bg-slate-200 text-zinc-600 hover:bg-slate-300'
                }`}
              >
                🏅 Season
              </button>
            )}
            {sortMode === 'gain' && (
              <div className="flex gap-1">
                {['$', '%'].map(unit => (
                  <button
                    key={unit}
                    onClick={() => setGainUnit(unit)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-sm transition-colors ${
                      gainUnit === unit
                        ? `${colorBlindMode ? 'bg-teal-600' : 'bg-emerald-600'} text-white`
                        : darkMode ? 'bg-zinc-800 text-zinc-400 hover:text-zinc-200' : 'bg-slate-200 text-slate-500 hover:text-slate-700'
                    }`}
                  >
                    {unit}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto relative" ref={scrollContainerRef}>
          {/* The season board is its own ranking (return net of granted value),
              so it replaces the list rather than re-sorting it. */}
          {sortMode === 'season' ? (
            <div className="p-3"><SeasonBoard /></div>
          ) : (
          <>
          {/* Sticky Header - shown when user row has scrolled above viewport */}
          {user && userRank && rankRelevant && userInList && userRowPosition === 'above' && (
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
                {userStickyValue}
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
            <>
            {showPodium && (
              <LeaderboardPodium leaders={filteredLeaders} sortBy={sortBy} user={user} userRowRef={userRowRef} />
            )}
            <div className={`divide-y ${divideClass}`}>
              {listLeaders.map(leader => {
                const displayRank = crewFilter === 'ALL' ? leader.rank : leader.crewRank;
                const crew = leader.crew ? CREW_MAP[leader.crew] : null;
                const isCurrentUser = user && leader.id === user.uid;
                const { nameColor, nameClass, glowColor, backdropColor, rowClass } = getCosmeticStyles(leader.activeCosmetics);
                // Crew heads get a crew-colored pulsing aura, but a purchased
                // glow cosmetic always wins — the crown never hides paid looks.
                const crownGlow = leader.isCrewHead && crew && !leader.activeCosmetics?.rowGlow;

                return (
                  <div
                    key={leader.id}
                    ref={isCurrentUser ? userRowRef : null}
                    className={`relative p-3 flex items-center gap-3 ${rowClass} ${crownGlow ? 'cos-glow-pulse-crew' : ''} ${
                      displayRank <= 3 ? (darkMode ? 'bg-zinc-900/50' : 'bg-amber-50') : ''
                    } ${
                      isCurrentUser ? 'border-l-4' : ''
                    }`}
                    style={{
                      ...(isCurrentUser ? {
                        borderLeftColor: userCrewColor,
                        backgroundColor: backdropColor ? (darkMode ? `${backdropColor}18` : `${backdropColor}12`) : (darkMode ? `${userCrewColor}20` : `${userCrewColor}15`),
                        boxShadow: glowColor ? `0 0 18px ${glowColor}50` : `inset 0 0 12px ${userCrewColor}30`,
                      } : {
                        ...(glowColor ? { boxShadow: `0 0 18px ${glowColor}50` } : {}),
                        ...(backdropColor ? { backgroundColor: darkMode ? `${backdropColor}18` : `${backdropColor}12` } : {}),
                      }),
                      ...(crownGlow ? { '--cgp': crew.color } : {}),
                    }}
                  >
                    <div className={`w-10 text-center font-bold ${getRankStyle(displayRank, darkMode, mutedClass)}`}>
                      {getRankEmoji(displayRank)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`font-semibold truncate ${textClass} flex items-center gap-1`}>
                        {leader.isPublic ? (
                          <Link
                            to={`/u/${(leader.displayName || '').toLowerCase()}`}
                            className={`hover:underline ${nameClass}`}
                            style={nameClass ? undefined : { color: nameColor || (leader.isCrewHead && crew ? getReadableCrewColor(leader.crewHeadColor || crew.color, darkMode) : undefined) }}
                          >
                            {leader.displayName || 'Anonymous Trader'}
                          </Link>
                        ) : (
                          <span className={nameClass} style={nameClass ? undefined : { color: nameColor || (leader.isCrewHead && crew ? getReadableCrewColor(leader.crewHeadColor || crew.color, darkMode) : undefined) }}>
                            {leader.displayName || 'Anonymous Trader'}
                          </span>
                        )}
                        {leader.isPublic && <span className="text-xs" title="Public profile">🌐</span>}
                        <PinDisplay userData={leader} size="sm" />
                      </div>
                      {leader.title && (
                        <div className={`text-xs font-semibold ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>{leader.title.text}</div>
                      )}
                      {leader.previousDisplayName && leader.nameChangedAt &&
                        Date.now() - (leader.nameChangedAt._seconds ? leader.nameChangedAt._seconds * 1000 : leader.nameChangedAt) < 30 * 24 * 60 * 60 * 1000 && (
                        <div className={`text-xs ${mutedClass}`}>formerly {leader.previousDisplayName}</div>
                      )}
                      <div className={`text-xs ${mutedClass}`}>
                        {leader.holdingsCount || 0} characters
                      </div>
                    </div>
                    <div className="text-right">
                      {isGainSort ? (
                        <>
                          <div className={`font-bold ${(leader.weeklyGain || 0) >= 0 ? gainClass : lossClass}`}>
                            {sortBy === 'weeklyGainPercent' ? fmtPct(leader.weeklyGainPercent) : fmtGain(leader.weeklyGain)}
                          </div>
                          <div className={`text-xs ${mutedClass}`}>
                            {sortBy === 'weeklyGainPercent' ? fmtGain(leader.weeklyGain) : fmtPct(leader.weeklyGainPercent)}
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
            </>
          )}

          {/* Sticky Footer - shown when user row is below viewport */}
          {sortMode !== 'season' && user && userRank && rankRelevant && !loading && (userRowPosition === 'below' || !userInList) && (
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
                {userStickyValue}
              </div>
            </div>
          )}
          </>
          )}
        </div>
      </div>
    </div>
  );
};

export default LeaderboardPage;
