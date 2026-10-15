// Tablets and desktops: long positions as a real brokerage table. Click a
// column to sort, click a row to open its details and trade history under it.
import { Fragment } from 'react';
import PositionDetail, { type PositionActions } from './PositionDetail';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { formatShares } from '../utils/shared';
import type { PortfolioItem } from '../utils/buildPositionItems';

interface PositionsTableProps extends PositionActions {
  items: PortfolioItem[];
  totalValue: number;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSort: (key: string) => void;
  expanded: string | null;
  setExpanded: (ticker: string | null) => void;
}

const COLUMNS: { key: string | null; label: string; right?: boolean }[] = [
  { key: 'name', label: 'Stock' },
  { key: 'shares', label: 'Shares', right: true },
  { key: null, label: 'Avg cost', right: true },
  { key: 'price', label: 'Price', right: true },
  { key: 'today', label: 'Today', right: true },
  { key: 'value', label: 'Value', right: true },
  { key: 'return', label: 'Total return', right: true },
  { key: null, label: 'Weight' },
];

const PositionsTable = ({
  items,
  totalValue,
  sortKey,
  sortDir,
  onSort,
  expanded,
  setExpanded,
  ...actions
}: PositionsTableProps) => {
  const { getColorBlindColors } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const up = getColorBlindColors(true);
  const down = getColorBlindColors(false);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className={`text-left ${mutedClass} border-b light:border-amber-200 dark:border-zinc-800`}>
          <tr>
            {COLUMNS.map((c, i) => (
              <th key={i} className={`px-3 py-2 font-semibold ${c.right ? 'text-right' : ''}`}>
                {c.key ? (
                  <button
                    type="button"
                    onClick={() => onSort(c.key!)}
                    className={`uppercase text-[11px] tracking-wide ${sortKey === c.key ? 'text-orange-500' : 'hover:text-orange-500'}`}
                  >
                    {c.label}
                    {sortKey === c.key && (sortDir === 'asc' ? ' ▲' : ' ▼')}
                  </button>
                ) : (
                  <span className="uppercase text-[11px] tracking-wide">{c.label}</span>
                )}
              </th>
            ))}
            <th className="px-3 py-2" />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const open = expanded === item.ticker;
            const weight = totalValue > 0 ? (item.value / totalValue) * 100 : 0;
            return (
              <Fragment key={item.ticker}>
                <tr
                  onClick={() => setExpanded(open ? null : item.ticker)}
                  aria-expanded={open}
                  className={`cursor-pointer border-b light:border-amber-100 dark:border-zinc-800/70 light:hover:bg-amber-50 dark:hover:bg-zinc-800/50 ${
                    open ? 'light:bg-amber-50 dark:bg-zinc-800/40' : ''
                  }`}
                >
                  <td className="px-3 py-2.5">
                    <span className={`mr-1.5 text-xs ${mutedClass}`}>{open ? '▼' : '▶'}</span>
                    <span className="text-orange-500 font-mono font-semibold">${item.ticker}</span>
                    <span className={`ml-2 text-xs ${mutedClass}`}>{item.character?.name}</span>
                  </td>
                  <td className={`px-3 py-2.5 text-right ${textClass}`}>{formatShares(item.shares)}</td>
                  <td className={`px-3 py-2.5 text-right ${mutedClass}`}>{formatCurrency(item.avgCost)}</td>
                  <td className={`px-3 py-2.5 text-right ${textClass}`}>{formatCurrency(item.currentPrice)}</td>
                  <td
                    className={`px-3 py-2.5 text-right font-mono ${getColorBlindColors(item.todayReturnPercent >= 0).text}`}
                  >
                    {formatChange(item.todayReturnPercent)}
                  </td>
                  <td className={`px-3 py-2.5 text-right font-semibold ${textClass}`}>{formatCurrency(item.value)}</td>
                  <td
                    className={`px-3 py-2.5 text-right whitespace-nowrap ${getColorBlindColors(item.totalReturnDollar >= 0).text}`}
                  >
                    {item.totalReturnDollar >= 0 ? '+' : ''}
                    {formatCurrency(item.totalReturnDollar)}
                    <span className="ml-1 text-xs">({formatChange(item.totalReturnPercent)})</span>
                  </td>
                  <td className="px-3 py-2.5 w-28">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-1.5 rounded-full light:bg-zinc-200 dark:bg-zinc-800">
                        <div
                          className="h-full rounded-full bg-orange-500"
                          style={{ width: `${Math.min(100, weight)}%` }}
                        />
                      </div>
                      <span className={`text-xs w-9 text-right ${mutedClass}`}>{weight.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => actions.onOrder(item.ticker, 'buy')}
                      className={`px-2.5 py-1 text-xs font-semibold uppercase rounded-sm text-white ${up.bg}`}
                    >
                      Buy
                    </button>
                    <button
                      onClick={() => actions.onOrder(item.ticker, 'sell')}
                      className={`ml-1.5 px-2.5 py-1 text-xs font-semibold uppercase rounded-sm text-white ${down.bg}`}
                    >
                      Sell
                    </button>
                  </td>
                </tr>
                {open && (
                  <tr className="border-b light:border-amber-200 dark:border-zinc-800">
                    <td colSpan={COLUMNS.length + 1} className="px-4 py-4 light:bg-amber-50/60 dark:bg-zinc-900/60">
                      <PositionDetail item={item} weight={weight} {...actions} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

export default PositionsTable;
