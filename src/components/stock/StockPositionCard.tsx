import { useAppContext } from '../../context/AppContext';
import { formatCurrency } from '../../utils/formatters';
import { getThemeClasses } from '../../utils/theme';
import type { ReactNode } from 'react';
import type { useStockPageData } from '../../hooks/useStockPageData';

type StockPositionCardProps = Pick<
  ReturnType<typeof useStockPageData>,
  | 'positionShares'
  | 'shortPosition'
  | 'avgCost'
  | 'positionPL'
  | 'positionPLPct'
  | 'dividendRate'
  | 'weeklyDividend'
  | 'drip'
  | 'handleToggleDrip'
  | 'currentPrice'
> & { ticker: string };

// The player's long and short position in one stock, with P&L and the DRIP toggle.
// Renders nothing when they hold neither.
const StockPositionCard = ({
  ticker,
  positionShares,
  shortPosition,
  avgCost,
  positionPL,
  positionPLPct,
  dividendRate,
  weeklyDividend,
  drip,
  handleToggleDrip,
  currentPrice,
}: StockPositionCardProps) => {
  const { darkMode, userData } = useAppContext();
  const { cardClass, textClass, mutedClass } = getThemeClasses(darkMode);
  const colorBlindMode = userData?.colorBlindMode || false;
  const upColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
  const shortShares = shortPosition?.shares ?? 0;
  const shortEntry = shortPosition?.costBasis || shortPosition?.entryPrice || 0;

  if (!(positionShares > 0 || shortShares > 0)) return null;

  return (
    <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
      <h3 className={`text-sm font-semibold ${textClass} mb-3`}>Your Position</h3>
      {positionShares > 0 && (
        <div className="space-y-2 text-sm">
          {(
            [
              ['Shares held', positionShares],
              ['Avg cost', formatCurrency(avgCost)],
            ] as [string, ReactNode][]
          ).map(([l, v]) => (
            <div key={l} className="flex justify-between">
              <span className={mutedClass}>{l}</span>
              <span className={textClass}>{v}</span>
            </div>
          ))}
          <div className="flex justify-between">
            <span className={mutedClass}>Total P&L</span>
            <span className={positionPL >= 0 ? upColor : downColor}>
              {positionPL >= 0 ? '+' : ''}
              {formatCurrency(positionPL)} ({positionPLPct >= 0 ? '+' : ''}
              {positionPLPct.toFixed(2)}%)
            </span>
          </div>
          {dividendRate > 0 && weeklyDividend > 0 && (
            <div className="flex justify-between">
              <span className={mutedClass}>Weekly dividend</span>
              <span className={upColor}>~{formatCurrency(weeklyDividend)}</span>
            </div>
          )}
          {dividendRate > 0 && (
            <div className="flex justify-between items-center">
              <span className={mutedClass}>DRIP</span>
              <button
                onClick={handleToggleDrip}
                title={drip[ticker] ? 'DRIP on: click to turn off' : 'DRIP off: click to reinvest'}
                className={`text-xs px-2 py-1 rounded font-semibold transition-colors ${drip[ticker] ? 'bg-emerald-600 text-white' : darkMode ? 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600' : 'bg-zinc-200 text-zinc-500 hover:bg-zinc-300'}`}
              >
                {drip[ticker] ? 'ON' : 'OFF'}
              </button>
            </div>
          )}
        </div>
      )}
      {shortShares > 0 && (
        <div
          className={`${positionShares > 0 ? 'mt-3 pt-3 border-t ' + (darkMode ? 'border-zinc-800' : 'border-amber-200') : ''} space-y-2 text-sm`}
        >
          {(
            [
              [
                'Shares short',
                <span key="ss" className="text-orange-500">
                  {shortShares}
                </span>,
              ],
              ['Short entry', formatCurrency(shortEntry)],
            ] as [string, ReactNode][]
          ).map(([l, v]) => (
            <div key={l} className="flex justify-between">
              <span className={mutedClass}>{l}</span>
              <span className={textClass}>{v}</span>
            </div>
          ))}
          {(() => {
            const pl = (shortEntry - currentPrice) * shortShares;
            return (
              <div className="flex justify-between">
                <span className={mutedClass}>Short P&L</span>
                <span className={pl >= 0 ? upColor : downColor}>
                  {pl >= 0 ? '+' : ''}
                  {formatCurrency(pl)}
                </span>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
};

export default StockPositionCard;
