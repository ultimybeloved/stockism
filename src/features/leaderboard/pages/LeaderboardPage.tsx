import { memo, useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useSession } from '../../../context/AppContext';
import { useSeason } from '../../season/hooks/useSeason';
import SeasonBoard from '../../season/components/SeasonBoard';
import CallBoard from '../components/CallBoard';
import { useUserRowPosition } from '../hooks/useUserRowPosition';
import { useYourStanding } from '../hooks/useYourStanding';
import { formatGainPct, formatGainDollars } from '../../../utils/leaderboardRank';
import { useLeaderboard } from '../hooks/useLeaderboard';
import { prefetchBoard } from '../hooks/boardCache';
import { CREW_MAP } from '../../../crews';
import { CrewMenu, CrewRail } from '../components/CrewFilter';
import { BoardRail, BoardTabs, GainUnitSwitch, type BoardMode, type GainUnit } from '../components/BoardNav';
import { YourRankBar, YourRankCard } from '../components/YourRank';
import { ClimbersPanel, TopGainersPanel } from '../components/SidePanels';
import PlayerSearch from '../components/PlayerSearch';
import { formatCurrency } from '../../../utils/formatters';
import LeaderboardPodium from '../components/LeaderboardPodium';
import LeaderboardRow from '../components/LeaderboardRow';
import { themeClasses } from '../../../utils/theme';
import { useWideScreen } from '../../../shared/hooks/useMediaQuery';
import PixelIcon from '../../../shared/components/PixelIcon';

const sortFor = (mode: BoardMode, unit: GainUnit) =>
  mode === 'gain' ? (unit === '%' ? 'weeklyGainPercent' : 'weeklyGain') : 'value';

// Phones and tablets: one card, boards as tabs and crews in a menu, with a
// "your rank" bar on its edge. Desktop (lg and up): boards and crews move to a
// left column and the player's rank plus the week's movers to a right one.
const LeaderboardPage = () => {
  const { user, userData } = useSession();
  const wide = useWideScreen();
  const [crewFilter, setCrewFilter] = useState('ALL');
  // The season card deep-links in with ?board=season, the Calls card with ?board=calls.
  const [searchParams] = useSearchParams();
  const { active: seasonActive } = useSeason();
  const [sortMode, setSortMode] = useState<BoardMode>(
    searchParams.get('board') === 'season' ? 'season' : searchParams.get('board') === 'calls' ? 'calls' : 'value',
  );
  const [gainUnit, setGainUnit] = useState<GainUnit>('$');
  const sortBy = sortFor(sortMode, gainUnit);
  const uid = user?.uid ?? null;
  // Ranked on net worth: margin debt is taken off on the server.
  const {
    leaders: filteredLeaders,
    userRank,
    nextGap,
    loading,
  } = useLeaderboard(sortBy, crewFilter, user, userData?.crew);
  const { scrollContainerRef, userRowRef, userRowPosition } = useUserRowPosition([filteredLeaders, user]);

  const { cardClass, textClass, mutedClass, divideClass } = themeClasses;
  const colorBlindMode = userData?.colorBlindMode || false;
  const gainClass = colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const lossClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';

  const userEntry = useMemo(
    () => (user ? filteredLeaders.find((leader) => leader.id === user.uid) : null),
    [filteredLeaders, user],
  );
  const userInList = !!userEntry;

  // Crews only split the net-worth and gainers boards.
  const listMode = sortMode === 'value' || sortMode === 'gain';
  // A rank only makes sense on the global board or the user's own crew board
  const rankRelevant = crewFilter === 'ALL' || crewFilter === userData?.crew;
  const standing = useYourStanding(filteredLeaders, user?.uid, rankRelevant ? userRank : null, nextGap, sortBy);

  // Top 3 get the podium and the scrolling list starts at #4. With fewer than
  // 3 players (tiny crew boards) the plain list covers everyone.
  const showPodium = filteredLeaders.length >= 3;
  const listLeaders = showPodium ? filteredLeaders.slice(3) : filteredLeaders;

  const isGainSort = sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent';

  // The value shown with the rank must match what the list is sorted by
  const userValue =
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

  const userCrewColor = (userData?.crew && CREW_MAP[userData.crew]?.color) || '#6b7280';
  const rankProps = { standing, name: userData?.displayName || '', value: userValue, crewColor: userCrewColor };
  const rankNote = !user
    ? 'Sign in to see where you rank.'
    : !rankRelevant
      ? 'Open your own crew or All players to see your rank.'
      : isGainSort && !loading && !userInList
        ? 'Not in the top 50 this week.'
        : null;

  // Warm a board before it's opened (pointing at its tab or crew).
  const prefetchMode = (mode: BoardMode) => {
    if (mode === 'value' || mode === 'gain')
      prefetchBoard(sortFor(mode, gainUnit), crewFilter === 'ALL' ? null : crewFilter, uid);
  };
  const prefetchCrew = (id: string) => listMode && prefetchBoard(sortBy, id === 'ALL' ? null : id, uid);
  const openGainers = () => {
    setGainUnit('$');
    setSortMode('gain');
  };

  const navProps = {
    mode: sortMode,
    setMode: setSortMode,
    gainUnit,
    setGainUnit,
    seasonActive,
    onPrefetch: prefetchMode,
  };
  // Phones get a bar on either edge while their row is out of view, or along
  // the bottom when they're off the board. Desktop has the rank card, so only
  // the bottom bar, and only until it catches up with their row on the list.
  const barsOn = listMode && !!standing && !loading;
  const topBar = barsOn && !wide && userInList && userRowPosition === 'above';
  const bottomBar = barsOn && (userInList ? userRowPosition === 'below' : !wide);

  return (
    <div className="max-w-2xl lg:max-w-6xl mx-auto p-4 lg:grid lg:grid-cols-[13rem_minmax(0,1fr)_16rem] lg:gap-4 lg:items-start">
      {wide && (
        <aside className={`${cardClass} border rounded-sm shadow-xl sticky top-20 pb-2`}>
          <BoardRail {...navProps} />
          {listMode && <CrewRail crewFilter={crewFilter} setCrewFilter={setCrewFilter} onPrefetch={prefetchCrew} />}
        </aside>
      )}

      <section
        className={`${cardClass} border rounded-sm shadow-xl overflow-hidden max-h-[85vh] lg:max-h-[calc(100vh-13rem)] lg:min-h-[28rem] flex flex-col`}
      >
        <div className={`px-4 pt-4 ${wide ? 'pb-4 border-b light:border-amber-200 dark:border-zinc-800' : ''}`}>
          <h2 className={`text-lg font-semibold ${textClass} mb-3`}>
            <PixelIcon name="trophy" className="w-5 h-5 mr-1.5 align-[-3px]" />
            Leaderboard
          </h2>
          <PlayerSearch />
          {!wide && (
            <>
              {listMode && (
                <div className="flex gap-2 mb-3">
                  <div className="flex-1 min-w-0">
                    <CrewMenu crewFilter={crewFilter} setCrewFilter={setCrewFilter} />
                  </div>
                  {sortMode === 'gain' && <GainUnitSwitch gainUnit={gainUnit} setGainUnit={setGainUnit} />}
                </div>
              )}
              <BoardTabs {...navProps} />
            </>
          )}
        </div>

        {topBar && <YourRankBar {...rankProps} edge="top" />}

        {/* overflow-x-hidden: an overflow-y box scrolls sideways too, so any
            row cosmetic that pokes out flashed a sideways scrollbar. */}
        <div className="flex-1 overflow-y-auto overflow-x-hidden relative" ref={scrollContainerRef}>
          {/* The season board is its own ranking (return net of granted value),
              so it replaces the list rather than re-sorting it. */}
          {sortMode === 'season' ? (
            <div className="p-3">
              <SeasonBoard />
            </div>
          ) : sortMode === 'calls' ? (
            <CallBoard />
          ) : loading ? (
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
        </div>

        {/* Outside the scroll box, so showing it never changes what scrolls. */}
        {bottomBar && <YourRankBar {...rankProps} edge="bottom" />}
      </section>

      {wide && (
        <aside className="sticky top-20 space-y-4">
          {listMode && <YourRankCard {...rankProps} note={rankNote} />}
          {sortMode === 'value' && <ClimbersPanel leaders={filteredLeaders} />}
          {sortMode !== 'gain' && <TopGainersPanel onOpen={openGainers} />}
        </aside>
      )}
    </div>
  );
};

export default memo(LeaderboardPage);
