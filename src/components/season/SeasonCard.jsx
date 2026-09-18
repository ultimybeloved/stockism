import { Link } from 'react-router-dom';
import { useSeason } from '../../hooks/useSeason';
import SeasonProgress from './SeasonProgress';
import { getThemeClasses } from '../../utils/theme';
import { useAppContext } from '../../context/AppContext';
import { seasonTierRule, seasonLabel, SEASON_MIN_BASELINE } from '../../constants/seasons';

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
    active, season, weeks, rules, inSeason, returnPercent, returnWithLadder,
    lockedTierMeta, activeWeeks, bronzeActiveWeeks, nextTier, belowFloor,
    seasonWeeks, baselineValue, baselineIndex,
  } = useSeason();

  if (!active) return null;

  const fmtPct = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

  // What the next tier asks for, in this player's own numbers where there are any.
  const nextHint = () => {
    if (!nextTier || returnPercent === null) return null;
    switch (nextTier.id) {
      case 'bronze':
        return `Be active in ${bronzeActiveWeeks} weeks of the season. You have ${activeWeeks} so far.`;
      case 'silver':
        return returnPercent > 0
          ? 'You\'re up. Still be up at Thursday\'s checkpoint and it\'s yours.'
          : `Get back above where you started. You're at ${fmtPct(returnPercent)}.`;
      case 'gold':
        return 'Be ahead of the market at a Thursday checkpoint. The chart above shows where you stood at the last one.';
      default:
        return `${seasonTierRule(nextTier.id, rules)} Decided when the season ends. The season board shows where you'd land right now.`;
    }
  };
  const hint = nextHint();

  return (
    <div className={`p-4 rounded-sm border mb-4 ${
      darkMode ? 'bg-zinc-800/50 border-zinc-700' : 'bg-amber-50 border-amber-200'
    }`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h3 className={`font-semibold ${textClass}`}>
            🏅 {seasonLabel(season)} · {season.name}
          </h3>
          <p className={`text-xs ${mutedClass}`}>
            Week {weeks} · ends when the arc finale drops
          </p>
          {season.preseason && (
            <p className={`text-xs ${mutedClass} mt-1`}>
              A trial run before Season 1. Tiers earned here give a Preseason title.
            </p>
          )}
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
          {belowFloor
            ? `Your account was under $${SEASON_MIN_BASELINE.toLocaleString()} when this season started. Get it over $${SEASON_MIN_BASELINE.toLocaleString()} and the next Thursday checkpoint adds you, scored from there.`
            : "You're not in this season yet. Thursday's checkpoint adds you, and you're scored from there."}
        </p>
      ) : (
        <>
          <div className="flex items-baseline gap-2 mt-3">
            <span className={`text-2xl font-bold ${returnPercent >= 0 ? 'text-green-500' : 'text-red-400'}`}>
              {fmtPct(returnPercent)}
            </span>
            <span className={`text-xs ${mutedClass}`}>season return, trading only</span>
          </div>

          {/* The ladder is excluded from anything that counts. Showing what it
              would have been is honest, and quietly discourages chasing it. */}
          {returnWithLadder !== null && Math.abs(returnWithLadder - returnPercent) >= 0.1 && (
            <p className={`text-xs ${mutedClass} mt-1`}>
              With ladder winnings it would be {fmtPct(returnWithLadder)}. The ladder is a casino,
              so it doesn't count toward your season.
            </p>
          )}

          <SeasonProgress
            season={season}
            seasonWeeks={seasonWeeks}
            baselineValue={baselineValue}
            baselineIndex={baselineIndex}
          />

          {hint && (
            <p className={`text-sm ${textClass} mt-2`}>
              Next up <span className="font-semibold" style={{ color: nextTier.color }}>{nextTier.name}</span>. {hint}
            </p>
          )}

          <p className={`text-xs ${mutedClass} mt-2`}>
            Bronze, Silver and Gold are banked at Thursday checkpoints and can't be lost. Platinum and
            Diamond are handed out when the season ends.
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
