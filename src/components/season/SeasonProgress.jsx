import { useMemo } from 'react';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { deriveSeasonWeeks, summariseSeasonWeeks, buildSeasonSeries } from '../../utils/seasonWeeks';
import { seasonRulesFor } from '../../constants/seasons';

// How the season has actually gone, week by week.
//
// Two things on screen, because they are the two things the tiers are decided
// from. The chart is your line against the market's, on one shared scale, so
// "did you beat the market" is a picture rather than a claim. The strip below it
// is one mark per week, filled where you beat the market that week — which IS
// the consistency Diamond is judged on, rendered directly. People accept a
// requirement they have watched accumulate far better than one announced at the end.
//
// Everything here is derived client-side from the raw weekly record on the
// user's own doc. No extra reads.
const SeasonProgress = ({ season, seasonWeeks, baselineValue, baselineLadder = 0, baselinePinnedAt = 0, baselineIndex }) => {
  const { darkMode, userData } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;
  const rules = seasonRulesFor(season);

  const youColor = colorBlindMode ? '#2dd4bf' : '#22c55e';
  const marketColor = darkMode ? '#a1a1aa' : '#71717a';

  // A player who joined mid-season is measured against the market from when they
  // joined. Older baselines carry no index, so the season's opening one stands in.
  const indexAtStart = baselineIndex > 0 ? baselineIndex : season?.indexAtStart;

  const { weeks, summary, series } = useMemo(() => {
    const derived = deriveSeasonWeeks(seasonWeeks, {
      seasonId: season?.id,
      baselineValue,
      baselineLadder,
      pinnedAt: baselinePinnedAt,
      indexAtStart,
    });
    return {
      weeks: derived,
      summary: summariseSeasonWeeks(derived),
      series: buildSeasonSeries(derived),
    };
  }, [seasonWeeks, season?.id, indexAtStart, baselineValue, baselineLadder, baselinePinnedAt]);

  // Before the first Thursday there is nothing to draw, and saying so beats an
  // empty box.
  if (!summary || !series) {
    return (
      <p className={`text-xs ${mutedClass} mt-3`}>
        Your week-by-week record starts at the first Thursday checkpoint.
      </p>
    );
  }

  const fmt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;
  const pct = (share) => `${Math.round(share * 100)}%`;
  const ahead = summary.excess >= 0;
  // Weeks missed count against Diamond, so the count is out of every checkpoint
  // the season has had, not just the ones on this player's record.
  const seasonCheckpoints = Math.max(summary.weeks, (season?.checkpointWeeks || []).length);
  const overLimit = summary.peakConcentration > rules.diamondMaxConcentration;

  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className={`text-xs font-semibold ${textClass}`}>You vs the market</p>
        <p className={`text-xs ${mutedClass}`}>
          <span style={{ color: youColor }}>■</span> you {fmt(summary.totalReturn)}
          {'  '}
          <span style={{ color: marketColor }}>■</span> market {fmt(summary.totalIndex)}
        </p>
      </div>

      <svg
        viewBox={`0 0 ${series.width} ${series.height}`}
        className="w-full mt-1"
        style={{ height: series.height }}
        role="img"
        aria-label={`Season return ${fmt(summary.totalReturn)} against market ${fmt(summary.totalIndex)}`}
      >
        {series.min < 0 && series.max > 0 && (
          <line
            x1="0" x2={series.width} y1={series.zeroY} y2={series.zeroY}
            stroke={darkMode ? '#3f3f46' : '#e4e4e7'} strokeWidth="1" strokeDasharray="3 3"
          />
        )}
        <polyline
          points={series.market} fill="none" stroke={marketColor}
          strokeWidth="1.5" strokeDasharray="4 3" strokeLinejoin="round"
        />
        <polyline
          points={series.you} fill="none" stroke={youColor}
          strokeWidth="2" strokeLinejoin="round" strokeLinecap="round"
        />
      </svg>

      <p className={`text-sm ${textClass} mt-1`}>
        {ahead
          ? <>You're <span className="font-semibold" style={{ color: youColor }}>{fmt(summary.excess).replace('+', '')}</span> ahead of the market this season.</>
          : <>You're <span className="font-semibold text-red-400">{Math.abs(summary.excess).toFixed(1)}%</span> behind the market this season.</>}
      </p>

      {/* One mark per week. This is the consistency record itself. */}
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <p className={`text-xs font-semibold ${textClass}`}>
            Weeks you beat the market{' '}
            <span className={`font-normal ${mutedClass}`}>(Diamond needs {pct(rules.diamondBeatShare)})</span>
          </p>
          <p className={`text-xs ${mutedClass}`}>{summary.beatCount} of {seasonCheckpoints}</p>
        </div>
        <div className="flex flex-wrap gap-1 mt-1.5">
          {weeks.map((w) => (
            <span
              key={w.week}
              title={`Week ${w.week}: you ${fmt(w.weekReturn)}, market ${fmt(w.weekIndex)}`}
              className="w-4 h-4 rounded-sm border"
              style={{
                backgroundColor: w.beat ? youColor : 'transparent',
                borderColor: w.beat ? youColor : (darkMode ? '#52525b' : '#d4d4d8'),
              }}
            />
          ))}
        </div>
      </div>

      {/* Concentration. Diamond is out for the season the first time a checkpoint
          finds more than the limit in one character. */}
      <p className={`text-xs ${mutedClass} mt-3`}>
        {overLimit
          ? <>Your biggest holding reached {pct(summary.peakConcentration)} of your invested money at a checkpoint,
            over the {pct(rules.diamondMaxConcentration)} Diamond limit. Diamond is out this season, but Platinum is
            still open.</>
          : <>Your biggest holding has peaked at {pct(summary.peakConcentration)} of your invested money. Diamond
            needs it at or under {pct(rules.diamondMaxConcentration)} at every Thursday checkpoint.</>}
      </p>
    </div>
  );
};

export default SeasonProgress;
