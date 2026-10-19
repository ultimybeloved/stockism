import { useEffect, useState, type ReactNode } from 'react';
import { CREW_MAP } from '../../../crews';
import CrewPin from '../../../shared/components/CrewPin';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatGainDollars } from '../../../utils/leaderboardRank';
import { loadBoard, type RankedLeader } from '../hooks/boardCache';
import RankMove from './RankMove';

const Panel = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => {
  const { cardClass, raisedClass, mutedClass } = themeClasses;
  return (
    <div className={`${cardClass} ${raisedClass} border rounded-sm`}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <p className={`text-[11px] font-semibold uppercase tracking-wide ${mutedClass}`}>{title}</p>
        {action}
      </div>
      <div className="pb-2">{children}</div>
    </div>
  );
};

const MiniRow = ({ place, leader, right }: { place: number; leader: RankedLeader; right: ReactNode }) => {
  const { textClass, mutedClass } = themeClasses;
  const crew = leader.crew ? CREW_MAP[leader.crew] : null;
  return (
    <div className="flex items-center gap-2 px-4 py-1.5 text-sm">
      <span className={`w-5 text-xs font-bold tabular-nums ${mutedClass}`}>{place}</span>
      {crew ? <CrewPin crew={crew} className="w-4 h-4 shrink-0" /> : <span className="w-4 h-4 shrink-0" />}
      <span className={`flex-1 min-w-0 truncate font-medium ${textClass}`}>{leader.displayName || 'Anonymous'}</span>
      {right}
    </div>
  );
};

/** This week's top dollar gainers. Shares the board cache, so opening Top
 * Gainers afterwards costs nothing. */
export const TopGainersPanel = ({ onOpen }: { onOpen: () => void }) => {
  const { user, userData } = useSession();
  const [rows, setRows] = useState<RankedLeader[] | null>(null);
  const gainClass = userData?.colorBlindMode ? 'text-teal-500' : 'text-emerald-500';

  useEffect(() => {
    let live = true;
    loadBoard('weeklyGain', null, user?.uid ?? null)
      .then((b) => live && setRows(b.leaders.filter((l) => (l.weeklyGain || 0) > 0).slice(0, 5)))
      .catch(() => live && setRows([]));
    return () => {
      live = false;
    };
  }, [user]);

  if (rows && rows.length === 0) return null;
  return (
    <Panel
      title="Top gainers this week"
      action={
        <button type="button" onClick={onOpen} className="text-xs font-semibold text-orange-500 hover:text-orange-400">
          See all
        </button>
      }
    >
      {rows === null ? (
        <p className={`px-4 py-2 text-sm ${themeClasses.mutedClass}`}>Loading...</p>
      ) : (
        rows.map((l, i) => (
          <MiniRow
            key={l.id}
            place={i + 1}
            leader={l}
            right={
              <span className={`text-xs font-bold tabular-nums ${gainClass}`}>{formatGainDollars(l.weeklyGain)}</span>
            }
          />
        ))
      )}
    </Panel>
  );
};

/** The biggest climbers on the open net-worth board since yesterday. */
export const ClimbersPanel = ({ leaders }: { leaders: RankedLeader[] }) => {
  const climbers = leaders
    .filter((l) => (l.rankChange || 0) > 0)
    .sort((a, b) => (b.rankChange || 0) - (a.rankChange || 0))
    .slice(0, 5);
  if (climbers.length === 0) return null;
  return (
    <Panel title="Biggest climbers today">
      {climbers.map((l) => (
        <MiniRow key={l.id} place={l.rank} leader={l} right={<RankMove change={l.rankChange} className="text-xs" />} />
      ))}
    </Panel>
  );
};
