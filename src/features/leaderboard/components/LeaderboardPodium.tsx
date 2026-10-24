import { forwardRef } from 'react';
import { Link } from 'react-router-dom';
import { useTheme, useSession } from '../../../context/AppContext';
import { CREW_MAP } from '../../../crews';
import { formatCompactCurrency } from '../../../utils/formatters';
import PinDisplay from '../../../shared/components/PinDisplay';
import TitleText from '../../../shared/components/TitleText';
import CosmeticLayers from '../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../shared/components/cosmetics/CosmeticName';
import { getCosmeticStyles } from '../../../utils/cosmetics';
import { themeClasses, getReadableCrewColor } from '../../../utils/theme';
import type { CSSProperties, Ref } from 'react';
import type { User } from 'firebase/auth';
import type { RankedLeader } from '../hooks/boardCache';
import PixelIcon from '../../../shared/components/PixelIcon';

// Gold / silver / bronze card treatments, keyed by podium place.
const PLACE_STYLES: Record<number, { medal: string; dark: string; light: string }> = {
  1: {
    medal: 'rank1',
    dark: 'border-yellow-500/60 bg-yellow-500/10',
    light: 'border-yellow-400 bg-yellow-50',
  },
  2: {
    medal: 'rank2',
    dark: 'border-zinc-400/50 bg-zinc-400/10',
    light: 'border-zinc-300 bg-zinc-100',
  },
  3: {
    medal: 'rank3',
    dark: 'border-amber-600/50 bg-amber-700/15',
    light: 'border-amber-500/60 bg-orange-50',
  },
};

interface PodiumCardProps {
  leader: RankedLeader;
  place: number;
  sortBy: string;
}

const PodiumCard = forwardRef<HTMLDivElement, PodiumCardProps>(({ leader, place, sortBy }, ref) => {
  const { darkMode } = useTheme();
  const { user, userData } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const colorBlindMode = userData?.colorBlindMode || false;
  const gainClass = colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const lossClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';

  const isCurrentUser = user && leader.id === user.uid;
  const crew = leader.crew ? CREW_MAP[leader.crew] : null;
  const cosmetics = getCosmeticStyles(leader.activeCosmetics, null, {
    seedKey: leader.displayName,
    trend: leader.frameTrend,
    style: leader.cosmeticStyle,
  });
  const { glowColor, rowClass, rowStyle, frameTrend, layers } = cosmetics;
  // place is always 1, 2 or 3.
  const placeStyle = PLACE_STYLES[place]!;
  const isFirst = place === 1;
  // Crew-colored pulsing aura for crew heads; purchased glows always win.
  const crownGlow = leader.isCrewHead && crew && !leader.activeCosmetics?.rowGlow;

  // --cgp feeds the crown-glow keyframes in index.css.
  const style: CSSProperties & { '--cgp'?: string } = {};
  const shadows = [];
  if (glowColor) shadows.push(`0 0 18px ${glowColor}50`);
  if (shadows.length) style.boxShadow = shadows.join(', ');
  if (crownGlow && crew) style['--cgp'] = crew.color;

  const crownColor =
    leader.isCrewHead && crew ? getReadableCrewColor(leader.crewHeadColor || crew.color, darkMode) : undefined;
  const name = leader.displayName || 'Anonymous Trader';
  const gain = leader.weeklyGain || 0;

  return (
    <div
      ref={ref}
      className={`relative min-w-0 border rounded-sm text-center px-1.5 sm:px-2 ${
        isFirst ? 'flex-[1.15] py-3 sm:py-4' : 'flex-1 py-2.5 sm:py-3'
      } ${darkMode ? placeStyle.dark : placeStyle.light} ${rowClass} ${crownGlow ? 'cos-glow-pulse-crew' : ''}`}
      data-trend={frameTrend}
      style={{ ...rowStyle, ...style }}
    >
      <CosmeticLayers {...layers} seedKey={leader.displayName} />
      {isFirst && <div className={`podium-sheen${darkMode ? '' : ' podium-sheen-light'}`} aria-hidden="true" />}
      <PixelIcon name={placeStyle.medal} className={isFirst ? 'w-9 h-9 mx-auto block' : 'w-7 h-7 mx-auto block'} />
      {/* Name gets the full card width; pins/globe live on their own row below
          so they can never squeeze the name into truncating early. */}
      <div
        className={`font-semibold ${isFirst ? 'text-sm sm:text-base' : 'text-xs sm:text-sm'} ${textClass} truncate mt-1`}
      >
        {leader.displayName ? (
          <Link to={`/u/${(leader.displayName || '').toLowerCase()}`} className="hover:underline">
            <CosmeticName name={name} styles={cosmetics} fallbackColor={crownColor} />
          </Link>
        ) : (
          <CosmeticName name={name} styles={cosmetics} fallbackColor={crownColor} />
        )}
      </div>
      <TitleText title={leader.title} className="text-[11px]" />
      <div className="flex items-center justify-center gap-1 flex-wrap">
        <PinDisplay userData={leader} size="sm" />
        {leader.isPublic && (
          <span className="text-xs" title="Public profile">
            <PixelIcon name="globe" set="admin" className="w-3 h-3 opacity-60" />
          </span>
        )}
        {isCurrentUser && <span className={`text-[10px] font-normal ${mutedClass}`}>(you)</span>}
      </div>
      <div className={`text-xs ${mutedClass} truncate`}>{leader.holdingsCount || 0} characters</div>
      {sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent' ? (
        <div className="mt-1">
          <div
            className={`font-bold ${isFirst ? 'text-base sm:text-lg' : 'text-sm sm:text-base'} ${gain >= 0 ? gainClass : lossClass}`}
          >
            {sortBy === 'weeklyGainPercent'
              ? `${(leader.weeklyGainPercent || 0) >= 0 ? '+' : ''}${(leader.weeklyGainPercent || 0).toFixed(1)}%`
              : `${gain >= 0 ? '+' : ''}${formatCompactCurrency(gain)}`}
          </div>
          <div className={`text-xs ${mutedClass}`}>
            {sortBy === 'weeklyGainPercent'
              ? `${gain >= 0 ? '+' : ''}${formatCompactCurrency(gain)}`
              : `${(leader.weeklyGainPercent || 0) >= 0 ? '+' : ''}${(leader.weeklyGainPercent || 0).toFixed(1)}%`}
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
interface LeaderboardPodiumProps {
  leaders: RankedLeader[];
  sortBy: string;
  user: User | null;
  userRowRef: Ref<HTMLDivElement>;
}

const LeaderboardPodium = ({ leaders, sortBy, user, userRowRef }: LeaderboardPodiumProps) => {
  const arrangement = [
    // Only rendered once the top three exist.
    { leader: leaders[1]!, place: 2 },
    { leader: leaders[0]!, place: 1 },
    { leader: leaders[2]!, place: 3 },
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
