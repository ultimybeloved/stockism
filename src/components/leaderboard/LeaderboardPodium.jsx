import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { useAppContext } from '../../context/AppContext';
import { CREW_MAP } from '../../crews';
import { formatCompactCurrency } from '../../utils/formatters';
import PinDisplay from '../common/PinDisplay';
import { getCosmeticStyles } from '../../utils/cosmetics';
import { getThemeClasses, getReadableCrewColor } from '../../utils/theme';

// Gold / silver / bronze card treatments, keyed by podium place.
const PLACE_STYLES = {
  1: {
    medal: '🥇',
    dark: 'border-yellow-500/60 bg-yellow-500/10',
    light: 'border-yellow-400 bg-yellow-50',
  },
  2: {
    medal: '🥈',
    dark: 'border-zinc-400/50 bg-zinc-400/10',
    light: 'border-zinc-300 bg-zinc-100',
  },
  3: {
    medal: '🥉',
    dark: 'border-amber-600/50 bg-amber-700/15',
    light: 'border-amber-500/60 bg-orange-50',
  },
};

const PodiumCard = forwardRef(({ leader, place, sortBy }, ref) => {
  const { darkMode, user, userData } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;
  const gainClass = colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const lossClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';

  const isCurrentUser = user && leader.id === user.uid;
  const userCrewColor = userData?.crew ? CREW_MAP[userData.crew]?.color : '#6b7280';
  const crew = leader.crew ? CREW_MAP[leader.crew] : null;
  const { nameColor, nameClass, glowColor, backdropColor, rowClass } = getCosmeticStyles(leader.activeCosmetics);
  const placeStyle = PLACE_STYLES[place];
  const isFirst = place === 1;
  // Crew-colored pulsing aura for crew heads; purchased glows always win.
  const crownGlow = leader.isCrewHead && crew && !leader.activeCosmetics?.rowGlow;

  const style = {};
  if (backdropColor) style.backgroundColor = darkMode ? `${backdropColor}18` : `${backdropColor}12`;
  const shadows = [];
  if (glowColor) shadows.push(`0 0 18px ${glowColor}50`);
  if (isCurrentUser) shadows.push(`0 0 0 2px ${userCrewColor}`);
  if (shadows.length) style.boxShadow = shadows.join(', ');
  if (crownGlow) style['--cgp'] = crew.color;

  const nameStyle = nameClass ? undefined : {
    color: nameColor || (leader.isCrewHead && crew ? getReadableCrewColor(leader.crewHeadColor || crew.color, darkMode) : undefined),
  };
  const gain = leader.weeklyGain || 0;

  return (
    <div
      ref={ref}
      className={`relative min-w-0 border rounded-sm text-center px-1.5 sm:px-2 ${
        isFirst ? 'flex-[1.15] py-3 sm:py-4' : 'flex-1 py-2.5 sm:py-3'
      } ${darkMode ? placeStyle.dark : placeStyle.light} ${rowClass} ${crownGlow ? 'cos-glow-pulse-crew' : ''}`}
      style={style}
    >
      {isFirst && <div className={`podium-sheen${darkMode ? '' : ' podium-sheen-light'}`} aria-hidden="true" />}
      <div className={isFirst ? 'text-3xl' : 'text-2xl'}>{placeStyle.medal}</div>
      {/* Name gets the full card width; pins/globe live on their own row below
          so they can never squeeze the name into truncating early. */}
      <div className={`font-semibold ${isFirst ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'} ${textClass} truncate mt-1`}>
        {leader.isPublic ? (
          <Link
            to={`/u/${(leader.displayName || '').toLowerCase()}`}
            className={`hover:underline ${nameClass}`}
            style={nameStyle}
          >
            {leader.displayName || 'Anonymous Trader'}
          </Link>
        ) : (
          <span className={nameClass} style={nameStyle}>
            {leader.displayName || 'Anonymous Trader'}
          </span>
        )}
      </div>
      <div className="flex items-center justify-center gap-1 flex-wrap">
        <PinDisplay userData={leader} size="sm" />
        {leader.isPublic && <span className="text-xs" title="Public profile">🌐</span>}
      </div>
      <div className={`text-xs ${mutedClass} truncate`}>
        {leader.holdingsCount || 0} characters
      </div>
      {sortBy === 'weeklyGain' ? (
        <div className="mt-1">
          <div className={`font-bold ${isFirst ? 'text-base sm:text-lg' : 'text-sm sm:text-base'} ${gain >= 0 ? gainClass : lossClass}`}>
            {gain >= 0 ? '+' : ''}{formatCompactCurrency(gain)}
          </div>
          <div className={`text-xs ${mutedClass}`}>
            {(leader.weeklyGainPercent || 0) >= 0 ? '+' : ''}{(leader.weeklyGainPercent || 0).toFixed(1)}%
          </div>
        </div>
      ) : (
        <div className={`font-bold mt-1 ${isFirst ? 'text-base sm:text-lg' : 'text-sm sm:text-base'} ${textClass}`}>
          {formatCompactCurrency(leader.portfolioValue || 0)}
        </div>
      )}
    </div>
  );
});
PodiumCard.displayName = 'PodiumCard';

// Olympic-style podium for the top 3: #1 center and largest with a gold sheen,
// #2 left, #3 right. `userRowRef` attaches to the current user's card so the
// page's scroll tracking (sticky rank bars) keeps working when they're on it.
const LeaderboardPodium = ({ leaders, sortBy, user, userRowRef }) => {
  const arrangement = [
    { leader: leaders[1], place: 2 },
    { leader: leaders[0], place: 1 },
    { leader: leaders[2], place: 3 },
  ];
  return (
    <div className="flex items-end gap-1.5 sm:gap-2 p-2 sm:p-3">
      {arrangement.map(({ leader, place }) => (
        <PodiumCard
          key={leader.id}
          ref={user && leader.id === user.uid ? userRowRef : null}
          leader={leader}
          place={place}
          sortBy={sortBy}
        />
      ))}
    </div>
  );
};

export default LeaderboardPodium;
