import { Link } from 'react-router-dom';
import { useSeason } from '../../hooks/useSeason';
import { getThemeClasses } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';

// The season at a glance: what you're on, what's next, and how far off it is.
// This is the piece that gives a player a reason to open the site on a Tuesday,
// so it lives on the home page rather than behind a tab.
//
// No countdown by design — a season ends when the arc's Finale chapter lands and
// nobody knows that in advance.
const SeasonCard = () => {
  const { darkMode } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const {
    active, season, weeks, inSeason, returnPercent,
    lockedTier, lockedTierMeta, activeWeeks, bronzeActiveWeeks, nextTier, nextTarget,
  } = useSeason();

  if (!active) return null;

  const fmtPct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const toNext = (nextTarget !== null && returnPercent !== null)
    ? nextTarget - returnPercent : null;

  return (
    <div className={`p-4 rounded-sm border mb-4 ${
      darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className={`font-semibold ${textClass}`}>
            🏅 Season {season.number} · {season.name}
          </h3>
          <p className={`text-xs ${mutedClass}`}>
            Week {weeks} · ends when the arc finale drops
          </p>
        </div>
        {lockedTierMeta && (
          <span
            className="px-2 py-1 rounded-sm text-xs font-bold"
            style={{ backgroundColor: `${lockedTierMeta.color}22`, color: lockedTierMeta.color }}
          >
            {lockedTierMeta.name} secured
          </span>
        )}
      </div>

      {!inSeason ? (
        <p className={`text-sm ${mutedClass} mt-3`}>
          You joined after this season started, so you'll be scored from the next one.
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-3">
            <span className={`text-2xl font-bold ${returnPercent >= 0 ? 'text-green-500' : 'text-red-400'}`}>
              {fmtPct(returnPercent)}
            </span>
            <span className={`text-xs ${mutedClass}`}>season return, trading only</span>
          </div>

          {nextTier && toNext !== null && (
            <p className={`text-sm ${textClass} mt-2`}>
              {toNext > 0
                ? <>Next up <span className="font-semibold" style={{ color: nextTier.color }}>{nextTier.name}</span> at {fmtPct(nextTarget)} — {fmtPct(toNext).replace('+', '')} to go.</>
                : <>You're above <span className="font-semibold" style={{ color: nextTier.color }}>{nextTier.name}</span>. Hold it until Thursday and it's yours.</>}
            </p>
          )}

          {!lockedTier && (
            <p className={`text-xs ${mutedClass} mt-2`}>
              Bronze needs {bronzeActiveWeeks} active weeks — you have {activeWeeks}. Just showing
              up earns it, whatever the market does.
            </p>
          )}

          <p className={`text-xs ${mutedClass} mt-2`}>
            Tiers are banked each Thursday. Once earned, a tier can't be lost.
          </p>
        </>
      )}

      <Link to="/leaderboard?board=season" className="inline-block mt-3 text-xs font-semibold text-orange-500 hover:underline">
        See the season board →
      </Link>
    </div>
  );
};

export default SeasonCard;
