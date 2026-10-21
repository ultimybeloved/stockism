import { useRef, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { useMarket, useSession, useTheme } from '../../../context/AppContext';
import { CREWS, CREW_MAP } from '../../../crews';
import { CREW_HEAD_PIN, PIXELATED, crewPinSrc, pixelatedIfSvg } from '../../../constants/crests';
import { getReadableCrewColor, themeClasses } from '../../../utils/theme';
import LeaderboardRow from '../../leaderboard/components/LeaderboardRow';
import CrewStocks from '../components/CrewStocks';
import { useCrewPlayers } from '../hooks/useCrewPlayers';

interface CrewHead {
  uid?: string;
  displayName?: string | null;
  /** Weeks running; written from 2026-10-22's rankings on. */
  weeks?: number;
}

// Players shown before "Show all", so the fund isn't buried on phones.
const PREVIEW_ROWS = 10;

// /crew/:crewId: one crew's page. Its head, its players by net worth, and its
// fund and characters. Any crew's page is open to anyone.
const CrewPage = () => {
  const { crewId = '' } = useParams();
  const crew = CREW_MAP[crewId.toUpperCase()];
  const { user, userData } = useSession();
  const { crewStats } = useMarket();
  const { darkMode } = useTheme();
  const { players, loading, failed } = useCrewPlayers(crew?.id ?? null);
  const userRowRef = useRef<HTMLDivElement | null>(null);
  const [showAll, setShowAll] = useState(false);
  const { cardClass, textClass, mutedClass, borderClass } = themeClasses;

  if (!crew) return <Navigate to="/leaderboard" replace />;
  if (crewId !== crew.id) return <Navigate to={`/crew/${crew.id}`} replace />;

  const color = getReadableCrewColor(crew.color, darkMode);
  const heads = (crewStats?.heads as Record<string, CrewHead> | undefined) || {};
  const head = heads[crew.id];
  const memberCount = (crewStats?.memberCounts as Record<string, number> | undefined)?.[crew.id];
  const activeCount = crewStats?.activeCounts?.[crew.id];
  const mine = userData?.crew === crew.id;

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-4">
      {/* Hero */}
      <div
        className={`${cardClass} border rounded-sm p-5 flex items-center gap-5`}
        style={{ borderTop: `4px solid ${color}` }}
      >
        <img src={crew.icon} alt="" className="w-20 h-20 object-contain shrink-0" />
        <div className="min-w-0">
          <h1 className="text-2xl font-bold" style={{ color }}>
            {crew.name}
          </h1>
          <p className={`text-sm ${mutedClass}`}>
            {memberCount != null && `${memberCount.toLocaleString()} players`}
            {activeCount != null && ` · ${activeCount.toLocaleString()} active last week`}
          </p>
          {mine && (
            <span
              className="inline-block mt-2 text-xs font-semibold px-2 py-0.5 rounded-sm border"
              style={{ color, borderColor: color }}
            >
              Your crew
            </span>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4 min-w-0">
          {/* Crew head */}
          <div className={`${cardClass} border rounded-sm p-4 flex items-center gap-3`}>
            <img src={CREW_HEAD_PIN} alt="" className="w-8 h-8 shrink-0" style={PIXELATED} />
            {head?.displayName ? (
              <div className="min-w-0">
                <div className={`text-xs uppercase tracking-wide ${mutedClass}`}>Crew head</div>
                <Link
                  to={`/u/${head.displayName.toLowerCase()}`}
                  className="font-bold hover:underline"
                  style={{ color }}
                >
                  {head.displayName}
                </Link>
                <span className={`text-sm ${mutedClass}`}>
                  {head.weeks ? ` · ${head.weeks} ${head.weeks === 1 ? 'week' : 'weeks'} running` : ''}
                </span>
              </div>
            ) : (
              <p className={`text-sm ${mutedClass}`}>No crew head this week.</p>
            )}
          </div>

          {/* Players */}
          <div className={`${cardClass} border rounded-sm overflow-hidden`}>
            <div className={`px-4 py-3 border-b ${borderClass} flex justify-between items-baseline`}>
              <h2 className={`font-bold ${textClass}`}>Players</h2>
              <span className={`text-xs ${mutedClass}`}>by net worth</span>
            </div>
            {loading ? (
              <p className={`p-4 text-sm ${mutedClass}`}>Loading...</p>
            ) : failed ? (
              <p className={`p-4 text-sm ${mutedClass}`}>Couldn't load the players. Try again in a minute.</p>
            ) : players.length === 0 ? (
              <p className={`p-4 text-sm ${mutedClass}`}>Nobody in this crew yet.</p>
            ) : (
              <div className="p-2 space-y-1">
                {(showAll ? players : players.slice(0, PREVIEW_ROWS)).map((p) => (
                  <LeaderboardRow
                    key={p.id}
                    leader={p}
                    displayRank={p.crewRank}
                    isCurrentUser={!!user && p.id === user.uid}
                    userRowRef={userRowRef}
                    sortBy="value"
                  />
                ))}
                {!showAll && players.length > PREVIEW_ROWS && (
                  <button
                    onClick={() => setShowAll(true)}
                    className="w-full py-2 text-sm font-semibold text-orange-500 hover:underline"
                  >
                    Show all {players.length}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <CrewStocks crew={crew} />
      </div>

      {/* Other crews */}
      <div className="flex flex-wrap justify-center gap-2 pt-2">
        {Object.values(CREWS).map((c) => {
          const src = crewPinSrc(c);
          return (
            <Link
              key={c.id}
              to={`/crew/${c.id}`}
              title={c.name}
              className={`p-1.5 rounded-sm border ${c.id === crew.id ? '' : 'border-transparent opacity-70 hover:opacity-100'}`}
              style={c.id === crew.id ? { borderColor: color } : undefined}
            >
              {src && <img src={src} alt={c.name} className="w-8 h-8 object-contain" style={pixelatedIfSvg(src)} />}
            </Link>
          );
        })}
      </div>
    </div>
  );
};

export default CrewPage;
