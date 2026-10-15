// Wide screens: clicking a stock opens it in a panel docked where the
// dashboard sits, instead of a window over the market. Chart, your position and
// the trade buttons, and you can click (or arrow-key) straight to the next
// stock without closing anything.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import PriceChart, { TIME_RANGES } from './PriceChart';
import TradeLauncher from '../../trading/components/TradeLauncher';
import { usePriceHistory } from '../hooks/usePriceHistory';
import { useSession, useMarket } from '../../../context/AppContext';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { formatShares } from '../../../utils/tradeLimits';
import { priceAt } from '../../../utils/marketStats';
import { getMarketClosedState } from '../../../utils/marketHours';
import type { Character } from '../../../characters';
import type { PricePoint, TradeAction } from '../../../types';

const RANGES = TIME_RANGES.filter((r) => ['1d', '7d', '1m', 'all'].includes(r.key));

interface StockSidePanelProps {
  character: Character;
  onClose: () => void;
  onStep: (delta: 1 | -1) => void;
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  onToggleWatchlist?: (ticker: string) => void;
  onSetAlert?: (ticker: string) => void;
  inCompare?: boolean;
  onToggleCompare?: (ticker: string) => void;
  /** Set by a keyboard shortcut (B / S): open this order form now. */
  pendingAction?: TradeAction | null;
  onPendingHandled?: () => void;
}

const StockSidePanel = ({
  character,
  onClose,
  onStep,
  onTrade,
  onToggleWatchlist,
  onSetAlert,
  pendingAction,
  onPendingHandled,
  inCompare = false,
  onToggleCompare,
}: StockSidePanelProps) => {
  const { user, userData, getColorBlindColors } = useSession();
  const { prices, marketData } = useMarket();
  const [timeRange, setTimeRange] = useState('7d');
  const [hovered, setHovered] = useState<PricePoint | null>(null);
  const [action, setAction] = useState<TradeAction | null>(null);
  const { fullHistory } = usePriceHistory(character.ticker);
  useEscapeKey(onClose, !action && !pendingAction);
  const { cardClass, textClass, mutedClass, raisedClass, ghostBtnClass } = themeClasses;

  const ticker = character.ticker;
  const price = prices[ticker] || character.basePrice;
  const range = TIME_RANGES.find((r) => r.key === timeRange)!;
  const open =
    range.hours === Infinity
      ? (fullHistory[0]?.price ?? price)
      : priceAt(fullHistory, Date.now() - range.hours * 3600000, price);
  const shown = hovered?.price ?? price;
  const change = open > 0 ? ((shown - open) / open) * 100 : 0;

  const held = userData?.holdings?.[ticker] || 0;
  const cost = userData?.costBasis?.[ticker] || 0;
  const short = userData?.shorts?.[ticker];
  const watched = (userData?.watchlist || []).includes(ticker);
  const halted = Date.now() < (marketData?.haltedTickers?.[ticker]?.resumeAt ?? 0);
  const closed = getMarketClosedState(marketData).closed;
  const canTrade = !!user && !halted && !closed;
  const current = action || pendingAction || null;

  const tradeBtn = (a: TradeAction, label: string, cls: string, enabled = true) => (
    <button
      type="button"
      disabled={!canTrade || !enabled}
      onClick={() => setAction(a)}
      className={`py-2 text-xs font-semibold uppercase rounded-sm disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );

  return (
    <aside
      className={`lg:order-2 lg:w-96 2xl:w-[30rem] lg:shrink-0 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto ${cardClass} ${raisedClass} border rounded-sm`}
      aria-label={`$${ticker} details`}
    >
      <div className="p-4 border-b light:border-amber-200 dark:border-zinc-800">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-orange-500 font-mono text-lg font-bold">${ticker}</div>
            <div className={`text-sm truncate ${mutedClass}`}>{character.name}</div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => onStep(-1)}
              className={`px-2 py-1 text-xs rounded-sm border ${ghostBtnClass}`}
              title="Previous stock (←)"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => onStep(1)}
              className={`px-2 py-1 text-xs rounded-sm border ${ghostBtnClass}`}
              title="Next stock (→)"
            >
              →
            </button>
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className={`ml-1 px-2 text-xl ${mutedClass} hover:text-orange-500`}
            >
              ×
            </button>
          </div>
        </div>
        <div className="flex items-baseline gap-2 mt-2">
          <span className={`text-2xl font-bold ${textClass}`}>{formatCurrency(shown)}</span>
          <span className={`text-sm font-semibold ${getColorBlindColors(change >= 0).text}`}>
            {change >= 0 ? '▲' : '▼'} {formatChange(change)} <span className={mutedClass}>({range.label})</span>
          </span>
        </div>
      </div>

      <div className="px-4 pt-3 flex gap-1">
        {RANGES.map((r) => (
          <button
            key={r.key}
            type="button"
            onClick={() => setTimeRange(r.key)}
            className={`px-2.5 py-1 text-xs font-semibold rounded-sm ${
              timeRange === r.key
                ? 'bg-orange-600 text-white'
                : 'light:text-zinc-600 dark:text-zinc-400 hover:text-orange-500'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="p-4">
        <PriceChart
          ticker={ticker}
          basePrice={character.basePrice}
          currentPrice={price}
          timeRange={timeRange}
          chartType="area"
          onHover={setHovered}
        />
      </div>

      {user && (
        <div className="px-4 pb-3 text-sm space-y-1">
          {held > 0.001 ? (
            <div className="flex justify-between">
              <span className={mutedClass}>You own {formatShares(held)}</span>
              {cost > 0 && (
                <span className={getColorBlindColors(price >= cost).text}>
                  {price >= cost ? '+' : ''}
                  {formatCurrency((price - cost) * held)} ({formatChange(((price - cost) / cost) * 100)})
                </span>
              )}
            </div>
          ) : (
            <div className={mutedClass}>You don't own any yet.</div>
          )}
          {(short?.shares || 0) > 0 && (
            <div className="text-orange-500">Short {formatShares(short!.shares)} shares</div>
          )}
        </div>
      )}

      {user && (
        <div className="px-4 pb-4 grid grid-cols-2 gap-2">
          {tradeBtn('buy', 'Buy (B)', `${getColorBlindColors(true).bg} text-white`)}
          {tradeBtn('sell', 'Sell (S)', `${getColorBlindColors(false).bg} text-white`, held > 0)}
          {tradeBtn('short', 'Short', 'border-2 border-orange-500 text-orange-500')}
          {tradeBtn('cover', 'Cover', 'border-2 border-blue-500 text-blue-500', (short?.shares || 0) > 0)}
        </div>
      )}

      <div className="px-4 pb-4 flex flex-wrap gap-3 text-xs">
        <Link to={`/stock/${ticker}`} className={`${mutedClass} hover:text-orange-500`}>
          Full page ↗
        </Link>
        {user && onToggleWatchlist && (
          <button
            type="button"
            onClick={() => onToggleWatchlist(ticker)}
            className={watched ? 'text-yellow-500' : `${mutedClass} hover:text-yellow-500`}
          >
            {watched ? '★ Watching' : '☆ Watch'}
          </button>
        )}
        {user && onSetAlert && (
          <button type="button" onClick={() => onSetAlert(ticker)} className={`${mutedClass} hover:text-orange-500`}>
            Price alert
          </button>
        )}
        {onToggleCompare && (
          <button
            type="button"
            onClick={() => onToggleCompare(ticker)}
            className={inCompare ? 'text-orange-500' : `${mutedClass} hover:text-orange-500`}
            title="Compare charts (C)"
          >
            {inCompare ? '✓ In comparison' : '+ Compare'}
          </button>
        )}
      </div>

      {current && canTrade && (
        <TradeLauncher
          character={character}
          action={current}
          onTrade={onTrade}
          onClose={() => {
            setAction(null);
            onPendingHandled?.();
          }}
        />
      )}
    </aside>
  );
};

export default StockSidePanel;
