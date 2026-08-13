import { useState } from 'react';
import { adminReturnDistributionFunction } from '../../../firebase';

// Answers "what return puts a player in the top N%", overall and per proposed
// season division. This is the measurement the season tier thresholds get set
// from — without it every threshold is a guess.
const ReturnDistributionPanel = ({ darkMode, textClass, mutedClass }) => {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const run = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await adminReturnDistributionFunction({});
      setReport(data);
    } catch (err) {
      console.error(err);
      setError(err.message);
    }
    setLoading(false);
  };

  const fmt = (v) => (v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v}%`);
  const cellClass = `px-2 py-1 text-right tabular-nums ${textClass}`;

  const rows = report ? [{ ...report.overall, label: 'All players', id: 'overall' }, ...report.divisions] : [];

  return (
    <div className={`p-3 rounded-sm ${darkMode ? 'bg-slate-700/50' : 'bg-slate-100'}`}>
      <div className="flex justify-between items-start gap-2 mb-1">
        <h3 className={`font-semibold ${textClass}`}>📐 30-Day Return Distribution</h3>
        <button
          onClick={run}
          disabled={loading}
          className="px-3 py-1 text-xs font-semibold rounded bg-cyan-600 text-white hover:bg-cyan-700 disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Run'}
        </button>
      </div>
      <p className={`text-xs ${mutedClass} mb-3`}>
        What return it takes to finish in the top N% of players. Use this to set season tier
        thresholds instead of guessing at them.
      </p>

      {error && <p className="text-sm text-red-400">Failed: {error}</p>}

      {report && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className={mutedClass}>
                  <th className="px-2 py-1 text-left font-semibold">Group</th>
                  <th className="px-2 py-1 text-right font-semibold">Players</th>
                  <th className="px-2 py-1 text-right font-semibold">Top 1%</th>
                  <th className="px-2 py-1 text-right font-semibold">Top 3%</th>
                  <th className="px-2 py-1 text-right font-semibold">Top 5%</th>
                  <th className="px-2 py-1 text-right font-semibold">Top 10%</th>
                  <th className="px-2 py-1 text-right font-semibold">Top 25%</th>
                  <th className="px-2 py-1 text-right font-semibold">Median</th>
                  <th className="px-2 py-1 text-right font-semibold">Up</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.id === 'overall' ? 'font-semibold' : ''}>
                    <td className={`px-2 py-1 text-left ${textClass}`}>
                      {r.label}
                      {r.min !== undefined && (
                        <span className={`ml-1 ${mutedClass}`}>
                          (${(r.min / 1000).toFixed(0)}k{r.max ? `–$${(r.max / 1000).toFixed(0)}k` : '+'})
                        </span>
                      )}
                    </td>
                    <td className={cellClass}>{r.count}</td>
                    <td className={cellClass}>{fmt(r.cuts?.top1)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-teal-400">{fmt(r.cuts?.top3)}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-teal-400">{fmt(r.cuts?.top5)}</td>
                    <td className={cellClass}>{fmt(r.cuts?.top10)}</td>
                    <td className={cellClass}>{fmt(r.cuts?.top25)}</td>
                    <td className={cellClass}>{fmt(r.median)}</td>
                    <td className={cellClass}>{r.count ? `${Math.round((r.positive / r.count) * 100)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className={`text-xs ${mutedClass} mt-2`}>
            {report.totalDocs} accounts scanned · skipped {report.skipped.bots} bots,{' '}
            {report.skipped.noSnapshot} without 30-day history, {report.skipped.belowBaseline} under $
            {report.minBaseline.toLocaleString()}.
          </p>
          {(() => {
            const cov = report.grantCoverage;
            if (!cov) return null;
            const share = cov.playersMeasured
              ? Math.round((cov.playersWithGrantData / cov.playersMeasured) * 100)
              : 0;
            const ready = share >= 80;
            return (
              <p className={`text-xs mt-1 ${ready ? 'text-teal-400' : 'text-amber-400'}`}>
                {ready
                  ? `Free money is being netted out for ${share}% of measured players ($${cov.grantedTotal.toLocaleString()} excluded). These numbers are usable for setting thresholds.`
                  : `Only ${share}% of measured players have grant data yet ($${cov.grantedTotal.toLocaleString()} excluded so far), so these still read high. Grant tracking needs ~30 days of history to cover the full window — check back before setting thresholds.`}
              </p>
            );
          })()}
        </>
      )}
    </div>
  );
};

export default ReturnDistributionPanel;
