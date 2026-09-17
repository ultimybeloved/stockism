import { useState } from 'react';
import { adminSeasonDryRunReportFunction, triggerSeasonDryRunFunction } from '../../../firebase';
import { SEASON_TIER_MAP } from '../../../constants/seasons';

// The season rehearsal. A snapshot is taken every Thursday while no season is
// running, and this scores those snapshots with the real tier rules, so the
// tiers can be watched against live data before season 1 starts for real.
// Nothing here changes a player's account.
const SeasonDryRunPanel = ({ darkMode, textClass, mutedClass }) => {
  const [report, setReport] = useState(null);
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const call = async (what, fn) => {
    setBusy(what);
    setError(null);
    try {
      const { data } = await fn();
      if (what === 'report') setReport(data);
      else if (data.ran === false) setError(`Snapshot skipped: ${data.reason}.`);
      else {
        const { data: fresh } = await adminSeasonDryRunReportFunction({});
        setReport(fresh);
      }
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
    setBusy(null);
  };

  const pct = (v) => `${v > 0 ? '+' : ''}${v}%`;
  const btn = 'px-3 py-1 text-xs font-semibold rounded text-white disabled:opacity-50';

  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
      <div className="flex justify-between items-start gap-2 mb-1">
        <h3 className={`font-semibold ${textClass}`}>🎭 Season Dry Run</h3>
        <div className="flex gap-2">
          <button
            onClick={() => call('report', () => adminSeasonDryRunReportFunction({}))}
            disabled={!!busy}
            className={`${btn} bg-cyan-600 hover:bg-cyan-700`}
          >
            {busy === 'report' ? 'Loading...' : 'Show report'}
          </button>
          <button
            onClick={() => call('snapshot', () => triggerSeasonDryRunFunction({}))}
            disabled={!!busy}
            className={`${btn} bg-slate-500 hover:bg-slate-600`}
            title="Normally runs itself every Thursday at 14:05 UTC"
          >
            {busy === 'snapshot' ? 'Taking...' : 'Take snapshot now'}
          </button>
        </div>
      </div>
      <p className={`text-xs ${mutedClass}`}>
        A snapshot of every active player is taken each Thursday while no season is running. This
        scores those snapshots with the real tier rules, so you can see where tiers would land
        before starting season 1. It never touches a player's account and hands out nothing.
      </p>

      {error && <p className="text-sm text-red-400 mt-2">{error}</p>}

      {report && (report.weeks < 1 ? (
        <p className={`text-sm ${mutedClass} mt-3`}>
          {report.reports === 1
            ? 'One snapshot so far. The next one gives the first scored week.'
            : 'No snapshots yet. Take one now, or wait for Thursday.'}
        </p>
      ) : (
        <>
          <p className={`text-xs ${mutedClass} mt-3`}>
            {report.weeks} scored {report.weeks === 1 ? 'week' : 'weeks'} from {report.from} to {report.to} ·{' '}
            {report.players} players · market {pct(report.marketPercent)} ·{' '}
            {report.slots.platinum} Platinum and {report.slots.diamond} Diamond {report.slots.diamond === 1 ? 'place' : 'places'}
            {report.belowFloor > 0 && ` · ${report.belowFloor} under the $1,000 floor`}
          </p>

          <div className="flex gap-3 flex-wrap mt-2">
            {['diamond', 'platinum', 'gold', 'silver', 'bronze'].map((id) => (
              <span key={id} className="text-xs font-semibold" style={{ color: SEASON_TIER_MAP[id].color }}>
                {SEASON_TIER_MAP[id].name} {report.tierCounts[id] || 0}
              </span>
            ))}
          </div>

          <div className="overflow-x-auto mt-3">
            <table className="w-full text-xs">
              <thead>
                <tr className={mutedClass}>
                  <th className="px-2 py-1 text-left font-semibold">Player</th>
                  <th className="px-2 py-1 text-right font-semibold">Return</th>
                  <th className="px-2 py-1 text-right font-semibold">vs market</th>
                  <th className="px-2 py-1 text-right font-semibold">Weeks beaten</th>
                  <th className="px-2 py-1 text-right font-semibold">Biggest holding</th>
                  <th className="px-2 py-1 text-right font-semibold">Would get</th>
                </tr>
              </thead>
              <tbody>
                {report.scored.map((p) => (
                  <tr key={p.uid}>
                    <td className={`px-2 py-1 text-left ${textClass}`}>{p.name}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${textClass}`}>{pct(p.returnPercent)}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${p.excess >= 0 ? 'text-teal-400' : 'text-red-400'}`}>
                      {pct(p.excess)}
                    </td>
                    <td className={`px-2 py-1 text-right tabular-nums ${textClass}`}>{p.beatWeeks} of {p.weeks}</td>
                    <td className={`px-2 py-1 text-right tabular-nums ${textClass}`}>
                      {Math.round(p.peakConcentration * 100)}%
                    </td>
                    <td className="px-2 py-1 text-right font-semibold"
                      style={{ color: p.tier ? SEASON_TIER_MAP[p.tier].color : undefined }}>
                      {p.tier ? SEASON_TIER_MAP[p.tier].name : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ))}
    </div>
  );
};

export default SeasonDryRunPanel;
