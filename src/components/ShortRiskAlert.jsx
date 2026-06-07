import { useMemo } from 'react';
import { useAppContext } from '../context/AppContext';
import { getShortRisk } from '../utils/calculations';
import { formatCurrency } from '../utils/formatters';

// Small banner on the main page that warns when one or more open shorts are near
// auto force-cover. Returns null when nothing is at risk, so it can always be rendered.
const ShortRiskAlert = ({ onOpenPortfolio }) => {
  const { shorts, prices } = useAppContext();

  const atRisk = useMemo(() => (
    Object.entries(shorts || {})
      .map(([ticker, pos]) => {
        const risk = getShortRisk(pos, prices[ticker] || 0);
        return risk?.isAtRisk && risk.liquidationPrice ? { ticker, ...risk } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.equityRatio - b.equityRatio)
  ), [shorts, prices]);

  if (atRisk.length === 0) return null;

  return (
    <div className="mb-4 rounded-sm border border-orange-500 bg-orange-500/10 px-3 py-2 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-orange-500 font-semibold">⚠️ Short margin warning</span>
      <span className="text-orange-500">
        {atRisk.map((s) => `$${s.ticker} force-covers near ${formatCurrency(s.liquidationPrice)}`).join('   ·   ')}
      </span>
      {onOpenPortfolio && (
        <button onClick={onOpenPortfolio} className="text-orange-500 underline hover:no-underline font-semibold">
          Manage shorts
        </button>
      )}
    </div>
  );
};

export default ShortRiskAlert;
