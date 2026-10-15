// One long position opened up: its numbers, the dividend it earns (with the
// DRIP switch), the order buttons, and the player's trade history in it.
// Shown under its row in the desktop table and in a bottom sheet on phones.
import { Link } from 'react-router-dom';
import StockHistory from './StockHistory';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { DIVIDEND_TIER_META, formatShares } from '../utils/shared';
import type { PortfolioItem } from '../utils/buildPositionItems';
import type { TradeAction } from '../../../types';

export interface PositionActions {
  onOrder: (ticker: string, action: TradeAction) => void;
  onSellAll: (ticker: string, shares: number) => void;
  onLimitSell?: (ticker: string, side: 'sell', kind?: 'stopLoss') => void;
  drip?: Record<string, boolean>;
  onToggleDrip?: (ticker: string) => void;
}

interface PositionDetailProps extends PositionActions {
  item: PortfolioItem;
  weight: number;
}

const PositionDetail = ({
  item,
  weight,
  onOrder,
  onSellAll,
  onLimitSell,
  drip = {},
  onToggleDrip,
}: PositionDetailProps) => {
  const { getColorBlindColors } = useSession();
  const { textClass, mutedClass, ghostBtnClass } = themeClasses;
  const up = getColorBlindColors(true);
  const down = getColorBlindColors(false);

  const stat = (label: string, value: string, cls = textClass) => (
    <div className="p-2 rounded-sm light:bg-white dark:bg-zinc-800/70">
      <div className={`text-[11px] uppercase ${mutedClass}`}>{label}</div>
      <div className={`text-sm font-semibold ${cls}`}>{value}</div>
    </div>
  );
  const btn = `px-3 py-2 md:py-1.5 text-xs font-semibold uppercase rounded-sm`;

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {stat('Shares', formatShares(item.shares))}
          {stat('Avg cost', formatCurrency(item.avgCost))}
          {stat('Price', formatCurrency(item.currentPrice))}
          {stat('Paid', formatCurrency(item.totalCost))}
          {stat(
            'Today',
            `${item.todayReturnDollar >= 0 ? '+' : ''}${formatCurrency(item.todayReturnDollar)}`,
            getColorBlindColors(item.todayReturnDollar >= 0).text,
          )}
          {stat(
            'Total return',
            `${formatChange(item.totalReturnPercent)}`,
            getColorBlindColors(item.totalReturnDollar >= 0).text,
          )}
        </div>

        <div>
          <div className={`text-[11px] uppercase mb-1 ${mutedClass}`}>{weight.toFixed(1)}% of your stocks</div>
          <div className="h-1.5 rounded-full light:bg-zinc-200 dark:bg-zinc-800">
            <div className="h-full rounded-full bg-orange-500" style={{ width: `${Math.min(100, weight)}%` }} />
          </div>
        </div>

        {item.tierRate > 0 && (
          <div className="p-2 rounded-sm border flex items-start justify-between gap-2 light:border-amber-200 dark:border-zinc-800">
            <div className="text-xs">
              <div className={DIVIDEND_TIER_META[item.tier]?.color}>
                {DIVIDEND_TIER_META[item.tier]?.label} dividend: {(item.tierRate * 100).toFixed(2)}% a week
              </div>
              <div className={mutedClass}>
                {formatShares(item.eligibleShares)} of {formatShares(item.shares)} shares earning
                {item.weeklyDividend > 0 && (
                  <span className={up.text}> · ~{formatCurrency(item.weeklyDividend)} / week</span>
                )}
              </div>
              {item.eligibleShares < item.shares && item.soonestReadyMs && (
                <div className={mutedClass}>
                  More start earning in {Math.ceil((item.soonestReadyMs - Date.now()) / 86_400_000)} day(s)
                </div>
              )}
            </div>
            {onToggleDrip && (
              <button
                onClick={() => onToggleDrip(item.ticker)}
                title={
                  drip[item.ticker]
                    ? 'Dividends buy more shares. Click to take cash.'
                    : 'Dividends pay cash. Click to reinvest.'
                }
                className={`shrink-0 text-xs px-2 py-1 rounded-sm font-semibold ${
                  drip[item.ticker]
                    ? 'bg-emerald-600 text-white'
                    : 'light:bg-zinc-200 light:text-zinc-500 dark:bg-zinc-700 dark:text-zinc-300'
                }`}
              >
                Reinvest {drip[item.ticker] ? 'on' : 'off'}
              </button>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <button onClick={() => onOrder(item.ticker, 'buy')} className={`${btn} ${up.bg} text-white`}>
            Buy more
          </button>
          <button onClick={() => onOrder(item.ticker, 'sell')} className={`${btn} ${down.bg} text-white`}>
            Sell
          </button>
          <button onClick={() => onSellAll(item.ticker, item.shares)} className={`${btn} border ${ghostBtnClass}`}>
            Sell all
          </button>
          {onLimitSell && (
            <>
              <button onClick={() => onLimitSell(item.ticker, 'sell')} className={`${btn} border ${ghostBtnClass}`}>
                Limit sell
              </button>
              <button
                onClick={() => onLimitSell(item.ticker, 'sell', 'stopLoss')}
                className={`${btn} border ${ghostBtnClass}`}
              >
                Stop loss
              </button>
            </>
          )}
          <Link to={`/stock/${item.ticker}`} className={`${btn} ${mutedClass} hover:text-orange-500`}>
            Stock page ↗
          </Link>
        </div>
      </div>

      <StockHistory ticker={item.ticker} />
    </div>
  );
};

export default PositionDetail;
