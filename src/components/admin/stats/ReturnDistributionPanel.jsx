import { useState } from 'react';
import { adminReturnDistributionFunction } from '../../../firebase';

const CUTS = [['top1', 'Top 1%'], ['top5', 'Top 5%'], ['top10', 'Top 10%'], ['top25', 'Top 25%']];

// How active players have done over 30 days with free money removed, next to the
// market over the same days. Season tiers are shares of the season board rather
// than fixed targets, so this is a health check on the field, not a threshold
// picker.
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

  const fmt = (v) => (v === null || v === undefined ? '-' : `${v > 0 ? '+' : ''}${v}%`);
  const cellClass = `px-2 py-1 text-right tabular-nums ${textClass}`;
  const share = (n, of) => (of ? `${Math.round((n / of) * 100)}%` : '-');

  const rows = report ? [{ ...report.overall, label: 'All players', id: 'overall' }, ...report.divisions] : [];

  const table = (title, { cuts, median, up, upLabel }) => (
    <div className="overflow-x-auto mt-3">
      <p className={`text-xs font-semibold ${textClass} mb-1`}>{title}</p>
      <table className="w-full text-xs">
        <thead>
          <tr className={mutedClass}>
            <th className="px-2 py-1 text-left font-semibold">Group</th>
            <th className="px-2 py-1 text-right font-semibold">Players</th>
            {CUTS.map(([key, label]) => (
              <th key={key} className="px-2 py-1 text-right font-semibold">{label}</th>
            ))}
            <th className="px-2 py-1 text-right font-semibold">Median</th>
            <th className="px-2 py-1 text-right font-semibold">{upLabel}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id} className={r.id === 'overall' ? 'font-semibold' : ''}>
              <td className={`px-2 py-1 text-left ${textClass}`}>
                {r.label}
                {r.min !== undefined && (
                  <span className={`ml-1 ${mutedClass}`}>
                    (${(r.min / 1000).toFixed(0)}k{r.max ? `-$${(r.max / 1000).toFixed(0)}k` : '+'})
                  </span>
                )}
              </td>
              <td className={cellClass}>{r.count}</td>
              {CUTS.map(([key]) => (
                <td key={key} className={cellClass}>{fmt(cuts(r)?.[key])}</td>
              ))}
              <td className={cellClass}>{fmt(median(r))}</td>
              <td className={cellClass}>{share(up(r), r.count)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const cov = report?.grantCoverage;
  const skipped = report?.skipped;

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
      <p className={`text-xs ${mutedClass}`}>
        How active players have done over their last 30 days, with free money removed, and how that
        compares with the market over the same days. A health check on the field. Season tiers don't
        use fixed targets, so nothing here needs setting.
      </p>

      {error && <p className="text-sm text-red-400 mt-2">Failed: {error}</p>}

      {report && (
        <>
          {table('Return, free money removed', {
            cuts: (r) => r.cuts, median: (r) => r.median, up: (r) => r.positive, upLabel: 'Up',
          })}
          {table('Against the market', {
            cuts: (r) => r.excessCuts, median: (r) => r.excessMedian, up: (r) => r.beatMarket, upLabel: 'Beat it',
          })}

          <p className={`text-xs ${mutedClass} mt-3`}>
            {report.totalDocs} accounts scanned. Measured {report.overall.count} whose 30 days ended in the
            last week. Skipped {skipped.staleWindow} not seen in the last week, {skipped.noSnapshot} with no
            30-day history, {skipped.belowBaseline} under ${report.minBaseline.toLocaleString()},{' '}
            {skipped.bots} bots and {skipped.banned} banned.
            {typeof report.marketLast30 === 'number' && ` The market moved ${fmt(report.marketLast30)} over the last 30 days.`}
          </p>
          {cov && (
            <p className={`text-xs mt-1 ${cov.lowerBound + cov.none > cov.exact ? 'text-amber-400' : 'text-teal-400'}`}>
              ${cov.grantedTotal.toLocaleString()} of free money removed. Exact for {cov.exact} players.
              For {cov.lowerBound} more, grant tracking starts partway through their 30 days, so a little
              free money may still count as return.
              {cov.none > 0 && ` ${cov.none} have no grant history at all.`}
            </p>
          )}
        </>
      )}
    </div>
  );
};

export default ReturnDistributionPanel;
