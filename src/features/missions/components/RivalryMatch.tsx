import { Link } from 'react-router-dom';
import { CREW_MAP, RIVALRY } from '../../../crews';
import { themeClasses } from '../../../utils/theme';
import CrewPin from '../../../shared/components/CrewPin';
import { rivalryTally, type RivalryBoard } from '../hooks/useRivalryBoard';

// This week's match: each crew's share of members who finished the missions.
// Shown in the missions window and on the crew page.
export default function RivalryMatch({
  match,
  board,
  yourCrew,
}: {
  match: string[];
  board: RivalryBoard | null;
  yourCrew: string | null;
}) {
  const { textClass, mutedClass, borderClass } = themeClasses;
  return (
    <div className={`p-3 rounded-sm border ${borderClass} space-y-3`}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${mutedClass}`}>This week's rivalry</p>
      {match.map((id) => {
        const info = CREW_MAP[id];
        const t = rivalryTally(board, id);
        return (
          <div key={id}>
            <div className="flex items-center gap-2 mb-1">
              <CrewPin crew={info} className="w-5 h-5" />
              <Link to={`/crew/${id}`} className={`text-sm font-semibold hover:underline ${textClass}`}>
                {info?.name || id}
              </Link>
              {id === yourCrew && (
                <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-500">Your crew</span>
              )}
              <span className={`ml-auto text-sm font-bold ${textClass}`}>{t.pct}%</span>
            </div>
            <div className="h-2 rounded-full light:bg-slate-200 dark:bg-zinc-800">
              <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${t.pct}%` }} />
            </div>
            <p className={`text-xs ${mutedClass} mt-0.5`}>
              {t.qualified} of {t.active} members with a mission finished {RIVALRY.qualifyMissions} missions
            </p>
          </div>
        );
      })}
    </div>
  );
}
