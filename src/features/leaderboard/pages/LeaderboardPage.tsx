import { memo, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useTheme, useSession } from '../../../context/AppContext';
import { useSeason } from '../../season/hooks/useSeason';
import SeasonBoard from '../../season/components/SeasonBoard';
import CallBoard from '../components/CallBoard';
import { useUserRowPosition } from '../hooks/useUserRowPosition';
import { formatGainPct, formatGainDollars } from '../../../utils/leaderboardRank';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { CREW_MAP } from '../../../crews';
import CrewFilter from '../components/CrewFilter';
import PlayerSearch from '../components/PlayerSearch';
import { formatCurrency } from '../../../utils/formatters';
import LeaderboardPodium from '../components/LeaderboardPodium';
import LeaderboardRow from '../components/LeaderboardRow';
import { themeClasses } from '../../../utils/theme';
import PixelIcon from '../../../shared/components/PixelIcon';

type BoardMode = 'value' | 'gain' | 'season' | 'calls';

const LeaderboardPage = () => {
  const { darkMode } = useTheme();
  const { user, userData } = useSession();
  const [crewFilter, setCrewFilter] = useState('ALL');
  // Two-level sort control: Net Worth vs Top Gainers, and within gainers a
  // $/% flick that remembers its last setting.
  // 'value' | 'gain' | 'season'. The season card deep-links in with ?board=season.
  const [searchParams] = useSearchParams();
  const { active: seasonActive } = useSeason();
  const [sortMode, setSortMode] = useState<BoardMode>(
    searchParams.get('board') === 'season' ? 'season' : searchParams.get('board') === 'calls' ? 'calls' : 'value',
  );
  const [gainUnit, setGainUnit] = useState<'$' | '%'>('$');
  const sortBy = sortMode === 'value' ? 'value' : gainUnit === '%' ? 'weeklyGainPercent' : 'weeklyGain';
  // Ranked on net worth: margin debt is taken off on the server.
  const { leaders: filteredLeaders, userRank, loading } = useLeaderboard(sortBy, crewFilter, user, userData?.crew);
  const { scrollContainerRef, userRowRef, userRowPosition } = useUserRowPosition([filteredLeaders, user]);

  const { cardClass, textClass, mutedClass, divideClass, chipClass, cardEdgeClass } = themeClasses;
  const colorBlindMode = userData?.colorBlindMode || false;
  const gainClass = colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const lossClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';

  const userEntry = useMemo(
    () => (user ? filteredLeaders.find((leader) => leader.id === user.uid) : null),
    [filteredLeaders, user],
  );
  const userInList = !!userEntry;

  // A rank only makes sense on the global board or the user's own crew board
  const rankRelevant = crewFilter === 'ALL' || crewFilter === userData?.crew;

  // Top 3 get the podium and the scrolling list starts at #4. With fewer than
  // 3 players (tiny crew boards) the plain list covers everyone.
  const showPodium = filteredLeaders.length >= 3;
  const listLeaders = showPodium ? filteredLeaders.slice(3) : filteredLeaders;

  const isGainSort = sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent';

  // The value shown in the sticky bars must match what the list is sorted by
  const userStickyValue =
    isGainSort && userEntry ? (
      <span className={(userEntry.weeklyGain || 0) >= 0 ? gainClass : lossClass}>
        {sortBy === 'weeklyGainPercent'
          ? formatGainPct(userEntry.weeklyGainPercent)
          : formatGainDollars(userEntry.weeklyGain)}
      </span>
    ) : (
      formatCurrency(
        (userData?.portfolioValue || 0) - (userData?.marginUsed || 0) + (userData?.eventPositionsValue || 0),
      )
    );

  const userCrewColor = userData?.crew ? CREW_MAP[userData.crew]?.color : '#6b7280';

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className={`${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] flex flex-col`}>
        <div className={`p-4 border-b ${cardEdgeClass}`}>
          <h2 className={`text-lg font-semibold ${textClass} mb-3`}>
            <PixelIcon name="trophy" className="w-5 h-5 mr-1.5 align-[-3px]" />
            Leaderboard
          </h2>

          <PlayerSearch />

          {/* Crew Filter */}
          <CrewFilter crewFilter={crewFilter} setCrewFilter={setCrewFilter} chipClass={chipClass} />

          {/* Sort Toggle */}
          <div className="flex gap-2 mt-3">
            <button
              onClick={() => setSortMode('value')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                sortMode === 'value'
                  ? 'bg-orange-600 text-white'
                  : 'light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              Net Worth
            </button>
            <button
              onClick={() => setSortMode('gain')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                sortMode === 'gain'
                  ? `${colorBlindMode ? 'bg-teal-600' : 'bg-emerald-600'} text-white`
                  : 'light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
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
                    : 'light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
                }`}
              >
                <PixelIcon name="season" className="w-3.5 h-3.5 mr-1 align-[-2px]" />
                Season
              </button>
            )}
            <button
              onClick={() => setSortMode('calls')}
              className={`flex-1 py-1.5 text-xs font-semibold rounded-sm transition-colors ${
                sortMode === 'calls'
                  ? 'bg-purple-600 text-white'
                  : 'light:bg-slate-200 light:text-zinc-600 light:hover:bg-slate-300 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700'
              }`}
            >
              Calls
            </button>
            {sortMode === 'gain' && (
              <div className="flex gap-1">
                {(['$', '%'] as const).map((unit) => (
                  <button
                    key={unit}
                    onClick={() => setGainUnit(unit)}
                    className={`px-3 py-1.5 text-xs font-bold rounded-sm transition-colors ${
                      gainUnit === unit
                        ? `${colorBlindMode ? 'bg-teal-600' : 'bg-emerald-600'} text-white`
                        : 'light:bg-slate-200 light:text-slate-500 light:hover:text-slate-700 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
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
            <div className="p-3">
              <SeasonBoard />
            </div>
          ) : sortMode === 'calls' ? (
            <CallBoard />
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
                  <div className={`text-sm font-bold ${textClass}`}>{userStickyValue}</div>
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
                    {listLeaders.map((leader) => (
                      <LeaderboardRow
                        key={leader.id}
                        leader={leader}
                        displayRank={crewFilter === 'ALL' ? leader.rank : leader.crewRank}
                        isCurrentUser={!!user && leader.id === user.uid}
                        userCrewColor={userCrewColor}
                        userRowRef={userRowRef}
                        sortBy={sortBy}
                      />
                    ))}
                  </div>
                </>
              )}

              {/* Sticky Footer - shown when user row is below viewport */}
              {user && userRank && rankRelevant && !loading && (userRowPosition === 'below' || !userInList) && (
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
                  <div className={`text-sm font-bold ${textClass}`}>{userStickyValue}</div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default memo(LeaderboardPage);
