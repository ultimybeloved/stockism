import { Link } from 'react-router-dom';
import type { RefObject } from 'react';
import { useTheme, useSession } from '../../../context/AppContext';
import { CREW_MAP } from '../../../crews';
import PinDisplay from '../../../shared/components/PinDisplay';
import TitleText from '../../../shared/components/TitleText';
import CosmeticLayers from '../../../shared/components/cosmetics/CosmeticLayers';
import CosmeticName from '../../../shared/components/cosmetics/CosmeticName';
import { getCosmeticStyles } from '../../../utils/cosmetics';
import { themeClasses, getReadableCrewColor } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { getRankMedal, getRankStyle, formatGainPct, formatGainDollars } from '../../../utils/leaderboardRank';
import type { RankedLeader } from '../hooks/boardCache';
import PixelIcon from '../../../shared/components/PixelIcon';
import RankMove from './RankMove';

interface LeaderboardRowProps {
  leader: RankedLeader;
  /** Global rank, or the crew rank on a crew board. */
  displayRank: number;
  isCurrentUser: boolean;
  userCrewColor: string | undefined;
  userRowRef: RefObject<HTMLDivElement | null>;
  sortBy: string;
}

// One player below the podium: rank, name with cosmetics and pins, and the
// number the board is sorted by.
const LeaderboardRow = ({
  leader,
  displayRank,
  isCurrentUser,
  userCrewColor,
  userRowRef,
  sortBy,
}: LeaderboardRowProps) => {
  const { darkMode } = useTheme();
  const { userData } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const colorBlindMode = userData?.colorBlindMode || false;
  const gainClass = colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const lossClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';
  const isGainSort = sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent';
  const crew = leader.crew ? CREW_MAP[leader.crew] : null;
  const cosmetics = getCosmeticStyles(leader.activeCosmetics, null, {
    seedKey: leader.displayName,
    trend: leader.frameTrend,
    style: leader.cosmeticStyle,
  });
  const { glowColor, backdropColor, rowClass, rowStyle, frameTrend, layers } = cosmetics;
  // Crew heads get a crew-colored pulsing aura, but a purchased
  // glow cosmetic always wins — the crown never hides paid looks.
  const crownGlow = leader.isCrewHead && crew && !leader.activeCosmetics?.rowGlow;
  const crownColor =
    leader.isCrewHead && crew ? getReadableCrewColor(leader.crewHeadColor || crew.color, darkMode) : undefined;
  const name = leader.displayName || 'Anonymous Trader';
  // A serialized Firestore Timestamp ({_seconds}), a millisecond time, or null
  // for a player who never renamed (typeof null is 'object', hence the guard).
  const changedAt = leader.nameChangedAt;
  const nameChangedMs = changedAt && typeof changedAt === 'object' ? (changedAt._seconds || 0) * 1000 : changedAt;

  return (
    <div
      ref={isCurrentUser ? userRowRef : null}
      className={`relative p-3 flex items-center gap-3 ${rowClass} ${crownGlow ? 'cos-glow-pulse-crew' : ''} ${
        displayRank <= 3 ? 'light:bg-amber-50 dark:bg-zinc-900/50' : ''
      } ${isCurrentUser ? 'border-l-4' : ''}`}
      data-trend={frameTrend}
      style={{
        ...rowStyle,
        ...(isCurrentUser
          ? {
              borderLeftColor: userCrewColor,
              ...(backdropColor ? {} : { backgroundColor: darkMode ? `${userCrewColor}20` : `${userCrewColor}15` }),
              boxShadow: glowColor
                ? `0 0 18px ${glowColor}50`
                : layers.glow
                  ? undefined
                  : `inset 0 0 12px ${userCrewColor}30`,
            }
          : glowColor
            ? { boxShadow: `0 0 18px ${glowColor}50` }
            : {}),
        ...(crownGlow ? { '--cgp': crew.color } : {}),
      }}
    >
      <CosmeticLayers {...layers} seedKey={leader.displayName} />
      <div className={`w-10 text-center font-bold ${getRankStyle(displayRank, darkMode, mutedClass)}`}>
        {getRankMedal(displayRank) ? (
          <PixelIcon name={getRankMedal(displayRank)!} className="w-6 h-6 mx-auto block" />
        ) : (
          `#${displayRank}`
        )}
        {!isGainSort && <RankMove change={leader.rankChange} className="block leading-tight" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className={`font-semibold truncate ${textClass} flex items-center gap-1`}>
          {leader.isPublic ? (
            <Link to={`/u/${(leader.displayName || '').toLowerCase()}`} className="hover:underline">
              <CosmeticName name={name} styles={cosmetics} fallbackColor={crownColor} />
            </Link>
          ) : (
            <CosmeticName name={name} styles={cosmetics} fallbackColor={crownColor} />
          )}
          {leader.isPublic && (
            <span className="text-xs" title="Public profile">
              🌐
            </span>
          )}
          <PinDisplay userData={leader} size="sm" />
        </div>
        <TitleText title={leader.title} />
        {leader.previousDisplayName &&
          leader.nameChangedAt &&
          Date.now() - (nameChangedMs as number) < 30 * 24 * 60 * 60 * 1000 && (
            <div className={`text-xs ${mutedClass}`}>formerly {leader.previousDisplayName}</div>
          )}
        <div className={`text-xs ${mutedClass}`}>{leader.holdingsCount || 0} characters</div>
      </div>
      <div className="text-right">
        {isGainSort ? (
          <>
            <div className={`font-bold ${(leader.weeklyGain || 0) >= 0 ? gainClass : lossClass}`}>
              {sortBy === 'weeklyGainPercent'
                ? formatGainPct(leader.weeklyGainPercent)
                : formatGainDollars(leader.weeklyGain)}
            </div>
            <div className={`text-xs ${mutedClass}`}>
              {sortBy === 'weeklyGainPercent'
                ? formatGainDollars(leader.weeklyGain)
                : formatGainPct(leader.weeklyGainPercent)}
            </div>
          </>
        ) : (
          <div className={`font-bold ${textClass}`}>{formatCurrency(leader.portfolioValue || 0)}</div>
        )}
      </div>
    </div>
  );
};

export default LeaderboardRow;
