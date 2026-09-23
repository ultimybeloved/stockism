import { SEASON_TIERS, seasonLabel, seasonRulesFor, seasonTierRule } from '../../constants/seasons';
import SeasonCoordFlags from './season/SeasonCoordFlags';

// Start / end a season and see where the current one stands. Lives in the
// Market tab because ending a season is tied to the chapter cycle.
const SeasonPanel = ({
  darkMode, textClass, mutedClass, loading,
  season, seasonName, setSeasonName, preseason, setPreseason, countThisWeek, setCountThisWeek,
  handleStartSeason, handleEndSeason, handleRunCheckpoint,
}) => {
  const active = season?.status === 'active';
  const weeks = active
    ? Math.max(1, Math.ceil((Date.now() - season.startedAt) / (7 * 24 * 60 * 60 * 1000)))
    : 0;

  const inputClass = `px-2 py-1 text-sm rounded border ${
    darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'
  }`;

  // A running season shows the rules it was started with; otherwise the ones a
  // new season would get.
  const rules = seasonRulesFor(active ? season : null);
  const rulesList = (
    <ul className="space-y-1 mb-3">
      {SEASON_TIERS.map((t) => (
        <li key={t.id} className={`text-xs ${mutedClass}`}>
          <span className="font-semibold" style={{ color: t.color }}>{t.name}</span>{' '}
          {seasonTierRule(t.id, rules)}
        </li>
      ))}
    </ul>
  );

  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
      <h3 className={`font-semibold ${textClass} mb-1`}>🏅 Season</h3>

      {active ? (
        <>
          <p className={`text-sm ${textClass}`}>
            {seasonLabel(season)} · <span className="font-semibold">{season.name}</span>
          </p>
          <p className={`text-xs ${mutedClass} mb-2`}>
            Week {weeks} · {season.playersPinned} baselines pinned · {(season.checkpointWeeks || []).length} checkpoints run
            {season.lastCheckpointAt && ` · last checkpoint ${new Date(season.lastCheckpointAt).toLocaleDateString()}`}
          </p>

          {rulesList}

          <div className="flex gap-2 flex-wrap">
            <button
              onClick={handleRunCheckpoint}
              disabled={loading}
              className="px-3 py-1 text-xs font-semibold rounded bg-slate-500 text-white hover:bg-slate-600 disabled:opacity-50"
              title="Normally runs itself every Thursday during the halt"
            >
              Run checkpoint now
            </button>
            <button
              onClick={handleEndSeason}
              disabled={loading}
              className="px-3 py-1 text-xs font-semibold rounded bg-red-600 text-white hover:bg-red-700 disabled:opacity-50"
            >
              End season
            </button>
          </div>
          <p className={`text-xs ${mutedClass} mt-2`}>
            End it during the Thursday halt the week a Finale chapter drops. Prices are frozen then,
            so the closing standings can't be sniped. Ending runs a final checkpoint, then hands out
            Platinum and Diamond.
          </p>

          <SeasonCoordFlags {...{ darkMode, textClass, mutedClass, active }} />
        </>
      ) : (
        <>
          <p className={`text-xs ${mutedClass} mb-2`}>
            {season
              ? `Last season: ${season.name} (ended ${new Date(season.endedAt).toLocaleDateString()}).`
              : 'No season has run yet.'}
          </p>

          <label className={`text-xs ${mutedClass} block mb-1`}>Arc name (becomes the title):</label>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={seasonName}
              onChange={(e) => setSeasonName(e.target.value)}
              placeholder="Gapryong Kim Arc"
              className={`flex-1 ${inputClass}`}
            />
            <button
              onClick={handleStartSeason}
              disabled={loading || !seasonName.trim()}
              className="px-3 py-1 text-xs font-semibold rounded bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50"
            >
              {preseason ? 'Start preseason' : 'Start season'}
            </button>
          </div>
          <label className={`flex items-start gap-2 text-xs ${mutedClass} mb-3`}>
            <input type="checkbox" checked={preseason} onChange={(e) => setPreseason(e.target.checked)} className="mt-0.5" />
            <span>
              Preseason (trial run). Doesn't use up a season number, so the next real one is
              still {seasonLabel({ number: (season?.number || 0) + 1 })}. Tiers earn a single
              "Preseason Gold" style title instead of the season and arc titles.
            </span>
          </label>
          <label className={`flex items-start gap-2 text-xs ${mutedClass} mb-3`}>
            <input type="checkbox" checked={countThisWeek} onChange={(e) => setCountThisWeek(e.target.checked)} className="mt-0.5" />
            <span>
              Count this week as week 1. Use this when starting after Thursday&apos;s checkpoint has
              already run. Everyone active in the last 7 days gets this week toward Bronze, and next
              Thursday&apos;s checkpoint is week 2.
            </span>
          </label>

          <p className={`text-xs ${mutedClass} mb-1`}>A new season starts with these rules:</p>
          {rulesList}
          <p className={`text-xs ${mutedClass}`}>
            Bronze is banked at each Thursday checkpoint. Silver and Gold go by where a player finishes.
            Platinum and Diamond are shares of the season board, handed out when you end the season, so
            there are no targets to set.
          </p>
        </>
      )}
    </div>
  );
};

export default SeasonPanel;
