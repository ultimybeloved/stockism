// Where the money sits: one bar split by stock (biggest six, then the rest),
// short collateral and cash, with a legend.
import { themeClasses } from '../../../utils/theme';
import { formatCurrency } from '../../../utils/formatters';
import type { PortfolioItem } from '../utils/buildPositionItems';

const COLORS = ['#f97316', '#3b82f6', '#a855f7', '#14b8a6', '#eab308', '#ec4899'];
const OTHER = '#71717a';
const SHORTS = '#fb923c';
const CASH = '#22c55e';

interface AllocationBarProps {
  items: PortfolioItem[];
  cash: number;
  shortCollateral: number;
}

const AllocationBar = ({ items, cash, shortCollateral }: AllocationBarProps) => {
  const { textClass, mutedClass } = themeClasses;
  const top = items.slice(0, COLORS.length);
  const rest = items.slice(COLORS.length).reduce((s, i) => s + i.value, 0);
  const parts = [
    ...top.map((i, n) => ({ key: i.ticker, label: `$${i.ticker}`, value: i.value, color: COLORS[n]! })),
    ...(rest > 0 ? [{ key: 'other', label: `${items.length - top.length} more`, value: rest, color: OTHER }] : []),
    ...(shortCollateral > 0 ? [{ key: 'shorts', label: 'Shorts', value: shortCollateral, color: SHORTS }] : []),
    ...(cash > 0 ? [{ key: 'cash', label: 'Cash', value: cash, color: CASH }] : []),
  ];
  const sum = parts.reduce((s, p) => s + p.value, 0);
  if (sum <= 0) return null;

  return (
    <div>
      <div className={`text-[11px] uppercase font-semibold mb-1.5 ${mutedClass}`}>Allocation</div>
      <div className="flex h-3 rounded-full overflow-hidden" role="img" aria-label="Allocation">
        {parts.map((p) => (
          <div
            key={p.key}
            style={{ width: `${(p.value / sum) * 100}%`, background: p.color }}
            title={`${p.label}: ${formatCurrency(p.value)}`}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {parts.map((p) => (
          <span key={p.key} className="flex items-center gap-1.5 text-xs">
            <span className="w-2.5 h-2.5 rounded-sm" style={{ background: p.color }} />
            <span className={textClass}>{p.label}</span>
            <span className={mutedClass}>{((p.value / sum) * 100).toFixed(0)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
};

export default AllocationBar;
