import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../../firebase';
import { CREW_MAP, RIVALRY } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { formatDateTime } from '../../../utils/localTime';
import { themeClasses } from '../../../utils/theme';
import { getWeekId, missionWeekEndMs, rivalryCount, type WeeklyProgress } from '../../../utils/missionProgress';
import { useSession, useMarket } from '../../../context/AppContext';
import CrewPin from '../../../shared/components/CrewPin';

/** rivalries/{weekId}: the week's matches and the live tally. */
interface RivalryBoard {
  matches?: { crews?: string[] }[];
  crews?: Record<string, { active?: Record<string, boolean>; qualified?: Record<string, boolean> }>;
}

const sizeOf = (m: Record<string, boolean> | undefined) => Object.keys(m || {}).length;

export default function RivalryTab({ multiplier, onJoinCrew }: { multiplier: number; onJoinCrew?: () => void }) {
  const { userData } = useSession();
  const { crewStats } = useMarket();
  const { textClass, mutedClass, borderClass } = themeClasses;
  const [board, setBoard] = useState<RivalryBoard | null>(null);
  const crew = userData?.crew || null;
  const weekId = getWeekId();

  useEffect(() => {
    if (!crew) return;
    return onSnapshot(
      doc(db, 'rivalries', weekId),
      (snap) => setBoard(snap.exists() ? (snap.data() as RivalryBoard) : {}),
      () => setBoard({}),
    );
  }, [crew, weekId]);

  if (!crew) {
    return (
      <div className="p-4 rounded-sm text-center light:bg-amber-50 dark:bg-zinc-800/50">
        <p className={`${mutedClass} mb-2`}>Join a crew to compete in Rivalries.</p>
        <p className={`text-xs ${mutedClass} mb-3`}>
          Every week your crew faces another. Finish {RIVALRY.qualifyMissions} missions to earn your share.
        </p>
        {onJoinCrew && (
          <button
            onClick={onJoinCrew}
            className="px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
          >
            Choose a Crew
          </button>
        )}
      </div>
    );
  }

  const mine = rivalryCount(userData?.weeklyMissions?.[weekId] as WeeklyProgress | undefined, crew);
  const match = (board?.matches || []).map((m) => m.crews || []).find((m) => m.includes(crew));
  const wonLastWeek = (crewStats?.rivalryWinners || []).includes(crew);
  const tally = (id: string) => {
    const c = board?.crews?.[id];
    const active = sizeOf(c?.active);
    const qualified = sizeOf(c?.qualified);
    return { active, qualified, pct: active > 0 ? Math.round((qualified / active) * 100) : 0 };
  };

  return (
    <div className="space-y-3">
      {wonLastWeek && (
        <div className="px-3 py-2 rounded-sm border border-amber-500/40 bg-amber-500/10 flex items-center gap-2">
          <CrewPin crew={CREW_MAP[crew]} className="w-5 h-5" />
          <p className="text-xs font-semibold text-amber-500">Your crew won last week. Your crest glows all week.</p>
        </div>
      )}

      {match ? (
        <div className={`p-3 rounded-sm border ${borderClass} space-y-3`}>
          <p className={`text-xs font-semibold uppercase tracking-wide ${mutedClass}`}>This week</p>
          {match.map((id) => {
            const info = CREW_MAP[id];
            const t = tally(id);
            return (
              <div key={id}>
                <div className="flex items-center gap-2 mb-1">
                  <CrewPin crew={info} className="w-5 h-5" />
                  <span className={`text-sm font-semibold ${textClass}`}>{info?.name || id}</span>
                  {id === crew && (
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-blue-500">Your crew</span>
                  )}
                  <span className={`ml-auto text-sm font-bold ${textClass}`}>{t.pct}%</span>
                </div>
                <div className="h-2 rounded-full light:bg-slate-200 dark:bg-zinc-800">
                  <div className="h-full rounded-full bg-blue-500 transition-all" style={{ width: `${t.pct}%` }} />
                </div>
                <p className={`text-xs ${mutedClass} mt-0.5`}>
                  {t.qualified} of {t.active} active members finished {RIVALRY.qualifyMissions} missions
                </p>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="p-4 rounded-sm text-center light:bg-amber-50 dark:bg-zinc-800/50">
          <p className={mutedClass}>No rivalry this week. New matches start {formatDateTime(missionWeekEndMs())}.</p>
        </div>
      )}

      <div className={`p-3 rounded-sm border ${borderClass}`}>
        <div className="flex justify-between text-sm mb-1">
          <span className={`font-semibold ${textClass}`}>Your missions this week</span>
          <span className={`font-bold ${mine >= RIVALRY.qualifyMissions ? 'text-blue-500' : mutedClass}`}>
            {Math.min(mine, RIVALRY.qualifyMissions)}/{RIVALRY.qualifyMissions}
          </span>
        </div>
        <div className="h-2 rounded-full light:bg-slate-200 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-blue-500 transition-all"
            style={{ width: `${Math.min(100, (mine / RIVALRY.qualifyMissions) * 100)}%` }}
          />
        </div>
        <p className={`text-xs ${mutedClass} mt-2`}>
          Daily and weekly missions both count, and so does a winning Call. Members who finish {RIVALRY.qualifyMissions}{' '}
          get {formatCurrency(Math.round(RIVALRY.winReward * multiplier))} if the crew wins and{' '}
          {formatCurrency(Math.round(RIVALRY.loseReward * multiplier))} if it loses, paid{' '}
          {formatDateTime(missionWeekEndMs())}. The crew with the bigger share of active members who finished wins.
        </p>
      </div>
    </div>
  );
}
