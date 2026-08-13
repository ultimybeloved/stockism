import { SEASON_TIER_MAP, seasonTierTarget } from '../../constants/seasons';

// Start / end a season and see where the current one stands. Lives in the
// Market tab because ending a season is tied to the chapter cycle.
const SeasonPanel = ({
  darkMode, textClass, mutedClass, loading,
  season, seasonName, setSeasonName, thresholds, setThresholds,
  handleStartSeason, handleEndSeason, handleRunCheckpoint,
}) => {
  const active = season?.status === 'active';
  const weeks = active
    ? Math.max(1, Math.ceil((Date.now() - season.startedAt) / (7 * 24 * 60 * 60 * 1000)))
    : 0;

  const inputClass = `px-2 py-1 text-sm rounded border ${
    darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'
  }`;

  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
      <h3 className={`font-semibold ${textClass} mb-1`}>🏅 Season</h3>

      {active ? (
        <>
          <p className={`text-sm ${textClass}`}>
            Season {season.number} · <span className="font-semibold">{season.name}</span>
          </p>
          <p className={`text-xs ${mutedClass} mb-2`}>
            Week {weeks} · {season.playersPinned} baselines pinned
            {season.lastCheckpointAt && ` · last checkpoint ${new Date(season.lastCheckpointAt).toLocaleDateString()}`}
          </p>

          <div className={`text-xs ${mutedClass} mb-3`}>
            Targets right now:{' '}
            {['silver', 'gold', 'platinum', 'diamond'].map((id) => {
              const rate = (season.thresholds || {})[id];
              if (rate === undefined) return null;
              return (
                <span key={id} className="mr-2 font-semibold" style={{ color: SEASON_TIER_MAP[id].color }}>
                  {SEASON_TIER_MAP[id].name} +{seasonTierTarget(rate, weeks).toFixed(1)}%
                </span>
              );
            })}
          </div>

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
            End it during the Thursday halt the week a Finale chapter drops. Prices are frozen
            then, so the closing standings can't be sniped.
          </p>
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
              Start season
            </button>
          </div>

          <label className={`text-xs ${mutedClass} block mb-1`}>
            Weekly rate per tier (%/week, compounded). Set these from Stats → Return Distribution:
          </label>
          <div className="flex gap-2 flex-wrap">
            {['silver', 'gold', 'platinum', 'diamond'].map((id) => (
              <div key={id} className="flex items-center gap-1">
                <span className="text-xs font-semibold" style={{ color: SEASON_TIER_MAP[id].color }}>
                  {SEASON_TIER_MAP[id].name}
                </span>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={thresholds[id] ?? ''}
                  onChange={(e) => setThresholds({ ...thresholds, [id]: Number(e.target.value) })}
                  className={`w-16 ${inputClass}`}
                />
              </div>
            ))}
          </div>
          <p className={`text-xs ${mutedClass} mt-2`}>
            These are placeholders until the return-distribution readout has ~30 days of grant
            data. Aim for roughly 3-5% of players reaching Diamond.
          </p>
        </>
      )}
    </div>
  );
};

export default SeasonPanel;
