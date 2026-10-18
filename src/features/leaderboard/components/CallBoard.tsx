import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useSession } from '../../../context/AppContext';
import { CREW_MAP } from '../../../crews';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';

/** leaderboard/calls, rebuilt by the halt that scores Calls (functions/src/missions/callResolution.ts). */
interface CallBoardRow {
  uid: string;
  displayName: string;
  crew: string | null;
  isPublic: boolean;
  calls: number;
  wins: number;
  losses: number;
  big: number;
  accuracy: number | null;
  streak: number;
  bestStreak: number;
  earned: number;
}

// The best weekly callers: most right Calls, then accuracy, then best streak.
// One document read per visit.
const CallBoard = () => {
  const { user } = useSession();
  const { textClass, mutedClass, divideClass } = themeClasses;
  const [rows, setRows] = useState<CallBoardRow[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    getDoc(doc(db, 'leaderboard', 'calls'))
      .then((snap) => setRows(snap.exists() ? (snap.data().rows as CallBoardRow[]) || [] : []))
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="text-center py-8 text-red-400">Could not load the callers board.</p>;
  if (!rows) return <p className={`text-center py-8 ${mutedClass}`}>Loading...</p>;
  if (rows.length === 0) {
    return (
      <p className={`text-center py-8 ${mutedClass}`}>
        No Calls scored yet. Make yours in Missions; the first ones are scored at the next chapter.
      </p>
    );
  }

  return (
    <div>
      <p className={`text-xs ${mutedClass} px-4 pt-3 pb-1`}>
        Ranked by right Calls, then accuracy. Pushes don&apos;t count either way. Updated each chapter.
      </p>
      <div className={`divide-y ${divideClass}`}>
        {rows.map((r, i) => {
          const crew = r.crew ? CREW_MAP[r.crew] : null;
          const mine = user?.uid === r.uid;
          return (
            <div
              key={r.uid}
              className={`px-4 py-2.5 flex items-center gap-3 ${mine ? 'light:bg-purple-50 dark:bg-purple-500/10' : ''}`}
            >
              <span className={`w-6 text-sm font-bold ${i < 3 ? 'text-purple-500' : mutedClass}`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold truncate ${textClass}`}>
                  {r.isPublic ? (
                    <Link to={`/u/${r.displayName.toLowerCase()}`} className="hover:underline">
                      {r.displayName}
                    </Link>
                  ) : (
                    r.displayName
                  )}
                  {crew && (
                    <span className="ml-1.5 text-[10px] font-semibold" style={{ color: crew.color }}>
                      {crew.name}
                    </span>
                  )}
                </p>
                <p className={`text-xs ${mutedClass}`}>
                  Best streak {r.bestStreak}
                  {r.big > 0 ? ` · ${r.big} big` : ''} · earned {formatCurrency(r.earned)}
                </p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${textClass}`}>
                  {r.wins}
                  <span className={`font-normal ${mutedClass}`}>-{r.losses}</span>
                </p>
                <p className={`text-xs ${mutedClass}`}>{r.accuracy !== null ? `${r.accuracy}%` : '-'}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default CallBoard;
