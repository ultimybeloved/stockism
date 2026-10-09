import { Link } from 'react-router-dom';
import type { RefObject } from 'react';
import { useAppContext } from '../../../context/AppContext';
import { CREW_MAP } from '../../../crews';
import PinDisplay from '../../../shared/components/PinDisplay';
import { getCosmeticStyles } from '../../../utils/cosmetics';
import { getThemeClasses, getReadableCrewColor } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import { getRankEmoji, getRankStyle, formatGainPct, formatGainDollars } from '../../../utils/leaderboardRank';
import type { RankedLeader } from '../hooks/useLeaderboard';

interface LeaderboardRowProps {
  leader: RankedLeader;
  /** Global rank, or the crew rank on a crew board. */
  displayRank: number;
  isCurrentUser: boolean;
  userCrewColor: string | undefined;
  userRowRef: RefObject<HTMLDivElement>;
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
  const { darkMode, userData } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;
  const gainClass = colorBlindMode ? 'text-teal-500' : 'text-emerald-500';
  const lossClass = colorBlindMode ? 'text-purple-500' : 'text-red-500';
  const isGainSort = sortBy === 'weeklyGain' || sortBy === 'weeklyGainPercent';
  const crew = leader.crew ? CREW_MAP[leader.crew] : null;
  const { nameColor, nameClass, glowColor, backdropColor, rowClass } = getCosmeticStyles(leader.activeCosmetics);
  // Crew heads get a crew-colored pulsing aura, but a purchased
  // glow cosmetic always wins — the crown never hides paid looks.
  const crownGlow = leader.isCrewHead && crew && !leader.activeCosmetics?.rowGlow;
  const nameStyle = nameClass
    ? undefined
    : {
        color:
          nameColor ||
          (leader.isCrewHead && crew ? getReadableCrewColor(leader.crewHeadColor || crew.color, darkMode) : undefined),
      };
  // A serialized Firestore Timestamp ({_seconds}), a millisecond time, or null
  // for a player who never renamed (typeof null is 'object', hence the guard).
  const changedAt = leader.nameChangedAt;
  const nameChangedMs = changedAt && typeof changedAt === 'object' ? (changedAt._seconds || 0) * 1000 : changedAt;

  return (
    <div
      ref={isCurrentUser ? userRowRef : null}
      className={`relative p-3 flex items-center gap-3 ${rowClass} ${crownGlow ? 'cos-glow-pulse-crew' : ''} ${
        displayRank <= 3 ? (darkMode ? 'bg-zinc-900/50' : 'bg-amber-50') : ''
      } ${isCurrentUser ? 'border-l-4' : ''}`}
      style={{
        ...(isCurrentUser
          ? {
              borderLeftColor: userCrewColor,
              backgroundColor: backdropColor
                ? darkMode
                  ? `${backdropColor}18`
                  : `${backdropColor}12`
                : darkMode
                  ? `${userCrewColor}20`
                  : `${userCrewColor}15`,
              boxShadow: glowColor ? `0 0 18px ${glowColor}50` : `inset 0 0 12px ${userCrewColor}30`,
            }
          : {
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
              style={nameStyle}
            >
              {leader.displayName || 'Anonymous Trader'}
            </Link>
          ) : (
            <span className={nameClass} style={nameStyle}>
              {leader.displayName || 'Anonymous Trader'}
            </span>
          )}
          {leader.isPublic && (
            <span className="text-xs" title="Public profile">
              🌐
            </span>
          )}
          <PinDisplay userData={leader} size="sm" />
        </div>
        {leader.title && (
          <div className={`text-xs font-semibold ${darkMode ? 'text-amber-400' : 'text-amber-600'}`}>
            {leader.title.text}
          </div>
        )}
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
