import type { ReactNode } from 'react';
import { useTheme } from '../../../context/AppContext';
import { themeClasses, getReadableCrewColor } from '../../../utils/theme';
import type { Standing } from '../hooks/useYourStanding';
import RankMove from './RankMove';

interface YourRankProps {
  standing: Standing | null;
  name: string;
  /** The figure the open board is sorted by, already formatted. */
  value: ReactNode;
  crewColor: string;
}

/** Desktop: the player's place, always in view in the right column. */
export const YourRankCard = ({
  standing,
  name,
  value,
  crewColor,
  note,
}: YourRankProps & {
  /** Shown instead of a rank: signed out, another crew's board, not ranked yet. */
  note: string | null;
}) => {
  const { cardClass, raisedClass, textClass, mutedClass } = themeClasses;
  const { darkMode } = useTheme();
  return (
    <div
      className={`${cardClass} ${raisedClass} border border-t-[3px] rounded-sm p-4`}
      style={{ borderTopColor: crewColor }}
    >
      <p className={`text-[11px] font-semibold uppercase tracking-wide ${mutedClass}`}>Your rank</p>
      {standing ? (
        <>
          <div className="flex items-baseline gap-2 mt-1">
            <span
              className="text-3xl font-bold tabular-nums"
              style={{ color: getReadableCrewColor(crewColor, darkMode) }}
            >
              #{standing.rank.toLocaleString()}
            </span>
            <RankMove change={standing.rankChange} className="text-xs" />
          </div>
          <p className={`text-sm font-semibold truncate ${textClass}`}>{name}</p>
          <p className={`text-sm font-bold tabular-nums ${textClass}`}>{value}</p>
          {standing.gapText && <p className={`text-xs mt-2 ${mutedClass}`}>{standing.gapText}</p>}
        </>
      ) : (
        <p className={`text-sm mt-1 ${mutedClass}`}>{note ?? 'Loading...'}</p>
      )}
    </div>
  );
};

/** Phones and tablets: a bar on the card's edge while the player's row is out of view. */
export const YourRankBar = ({ standing, name, value, crewColor, edge }: YourRankProps & { edge: 'top' | 'bottom' }) => {
  const { textClass, mutedClass } = themeClasses;
  const { darkMode } = useTheme();
  if (!standing) return null;
  return (
    <div
      className={`shrink-0 px-4 py-2.5 flex justify-between items-center gap-3 light:bg-white dark:bg-zinc-900 ${edge === 'top' ? 'border-b' : 'border-t'}`}
      style={{ borderColor: crewColor, boxShadow: `0 ${edge === 'top' ? 2 : -2}px 10px ${crewColor}40` }}
    >
      <div className="min-w-0">
        <p className={`text-sm font-semibold truncate ${textClass}`}>
          <span style={{ color: getReadableCrewColor(crewColor, darkMode) }}>#{standing.rank.toLocaleString()}</span>{' '}
          {name} <RankMove change={standing.rankChange} />
        </p>
        {standing.gapText && <p className={`text-[11px] ${mutedClass}`}>{standing.gapText}</p>}
      </div>
      <div className={`text-sm font-bold shrink-0 tabular-nums ${textClass}`}>{value}</div>
    </div>
  );
};
