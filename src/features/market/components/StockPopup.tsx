// Wide screens: clicking a stock opens a big window over the market with the
// chart, the period's open / high / low, your position and the trade buttons.
// Arrow keys (or the ← → buttons) step to the next stock without closing it.
// Phones keep the simpler chart window.
import { useState } from 'react';
import { Link } from 'react-router-dom';
import PriceChart, { TIME_RANGES } from './PriceChart';
import TradeLauncher from '../../trading/components/TradeLauncher';
import { usePriceHistory } from '../hooks/usePriceHistory';
import { useSession, useMarket } from '../../../context/AppContext';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import { themeClasses } from '../../../utils/theme';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import { formatShares } from '../../../utils/tradeLimits';
import { priceAt } from '../../../utils/marketStats';
import { getMarketClosedState } from '../../../utils/marketHours';
import { getWatchlists } from '../utils/watchlists';
import type { Character } from '../../../characters';
import type { PricePoint, TradeAction } from '../../../types';
import SegmentedSwitch from '../../../shared/components/SegmentedSwitch';

interface StockPopupProps {
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

const StockPopup = ({
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
}: StockPopupProps) => {
  const { user, userData, getColorBlindColors } = useSession();
  const { prices, marketData } = useMarket();
  const [timeRange, setTimeRange] = useState('7d');
  const [hovered, setHovered] = useState<PricePoint | null>(null);
  const [action, setAction] = useState<TradeAction | null>(null);
  const { fullHistory } = usePriceHistory(character.ticker);
  const dialogRef = useModalFocus();
  useEscapeKey(onClose, !action && !pendingAction);
  const { textClass, mutedClass, ghostBtnClass, overlayClass, modalShellClass, cardEdgeClass, bgClass } = themeClasses;

  const ticker = character.ticker;
  const price = prices[ticker] || character.basePrice;
  const range = TIME_RANGES.find((r) => r.key === timeRange)!;
  const cutoff = range.hours === Infinity ? 0 : Date.now() - range.hours * 3600000;
  const open = range.hours === Infinity ? (fullHistory[0]?.price ?? price) : priceAt(fullHistory, cutoff, price);
  const inRange = fullHistory.filter((p) => p.timestamp >= cutoff).map((p) => p.price);
  const high = Math.max(price, ...inRange);
  const low = Math.min(price, ...inRange);
  const shown = hovered?.price ?? price;
  const change = open > 0 ? ((shown - open) / open) * 100 : 0;

  const held = userData?.holdings?.[ticker] || 0;
  const cost = userData?.costBasis?.[ticker] || 0;
  const short = userData?.shorts?.[ticker];
  const watched = (userData?.watchlist || []).includes(ticker);
  const manyLists = getWatchlists(userData).length > 1;
  const halted = Date.now() < (marketData?.haltedTickers?.[ticker]?.resumeAt ?? 0);
  const closed = getMarketClosedState(marketData).closed;
  const canTrade = !!user && !halted && !closed;
  const current = action || pendingAction || null;

  const tradeBtn = (a: TradeAction, label: string, cls: string, enabled = true) => (
    <button
      type="button"
      disabled={!canTrade || !enabled}
      onClick={() => setAction(a)}
      className={`py-2.5 text-sm font-semibold uppercase rounded-sm disabled:opacity-40 ${cls}`}
    >
      {label}
    </button>
  );

  const stat = (label: string, value: string, cls = textClass) => (
    <div>
      <div className={`text-xs uppercase ${mutedClass}`}>{label}</div>
      <div className={`font-semibold ${cls}`}>{value}</div>
    </div>
  );

  return (
    <>
      <div className={`${overlayClass} z-50`} onClick={onClose}>
        <div
          ref={dialogRef}
          className={`${modalShellClass} max-w-5xl max-h-[92vh] overflow-y-auto`}
          onClick={(e) => e.stopPropagation()}
          aria-label={`$${ticker} details`}
          data-keep-shortcuts
        >
          <div className={`p-5 border-b ${cardEdgeClass} flex items-start justify-between gap-4`}>
            <div className="min-w-0">
              <div className="flex items-baseline gap-3">
                <h2 className="text-orange-500 font-mono text-2xl font-bold">${ticker}</h2>
                <span className={`text-base truncate ${mutedClass}`}>{character.name}</span>
              </div>
              <div className="flex items-baseline gap-3 mt-1">
                <span className={`text-3xl font-bold ${textClass}`}>{formatCurrency(shown)}</span>
                <span className={`text-base font-semibold ${getColorBlindColors(change >= 0).text}`}>
                  {change >= 0 ? '▲' : '▼'} {formatChange(change)} <span className={mutedClass}>({range.label})</span>
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <button
                type="button"
                onClick={() => onStep(-1)}
                className={`px-3 py-1.5 text-sm rounded-sm border ${ghostBtnClass}`}
                title="Previous stock (←)"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => onStep(1)}
                className={`px-3 py-1.5 text-sm rounded-sm border ${ghostBtnClass}`}
                title="Next stock (→)"
              >
                →
              </button>
              <button
                type="button"
                aria-label="Close"
                onClick={onClose}
                className={`ml-2 px-2 text-2xl ${mutedClass} hover:text-orange-500`}
              >
                ×
              </button>
            </div>
          </div>

          <div className="grid lg:grid-cols-[1fr_17rem]">
            <div className={`min-w-0 ${bgClass}`}>
              <div className="px-5 pt-4">
                <SegmentedSwitch
                  label="Time range"
                  size="md"
                  options={TIME_RANGES.map((r) => [r.key, r.label] as const)}
                  value={timeRange}
                  onChange={setTimeRange}
                />
              </div>
              <div className="p-5">
                <PriceChart
                  ticker={ticker}
                  basePrice={character.basePrice}
                  currentPrice={price}
                  timeRange={timeRange}
                  chartType="area"
                  onHover={setHovered}
                />
              </div>
              <div className={`px-5 pb-5 grid grid-cols-4 gap-4 text-center`}>
                {stat('Open', formatCurrency(open))}
                {stat('High', formatCurrency(high), getColorBlindColors(true).text)}
                {stat('Low', formatCurrency(low), getColorBlindColors(false).text)}
                {stat('Now', formatCurrency(price))}
              </div>
            </div>

            <div className={`p-5 lg:border-l ${cardEdgeClass} flex flex-col gap-4`}>
              {user ? (
                <div className="text-sm space-y-1">
                  <div className={`text-xs uppercase font-semibold ${mutedClass}`}>Your position</div>
                  {held > 0.001 ? (
                    <>
                      <div className={`text-lg font-bold ${textClass}`}>{formatShares(held)} shares</div>
                      <div className={mutedClass}>Worth {formatCurrency(held * price)}</div>
                      {cost > 0 && (
                        <div className={getColorBlindColors(price >= cost).text}>
                          {price >= cost ? '+' : ''}
                          {formatCurrency((price - cost) * held)} ({formatChange(((price - cost) / cost) * 100)})
                        </div>
                      )}
                    </>
                  ) : (
                    <div className={mutedClass}>You don't own any yet.</div>
                  )}
                  {(short?.shares || 0) > 0 && (
                    <div className="text-orange-500">Short {formatShares(short!.shares)} shares</div>
                  )}
                </div>
              ) : (
                <div className={`text-sm ${mutedClass}`}>Sign in to trade.</div>
              )}

              {user && (
                <div className="grid grid-cols-2 gap-2">
                  {tradeBtn('buy', 'Buy (B)', `${getColorBlindColors(true).bg} text-white`)}
                  {tradeBtn('sell', 'Sell (S)', `${getColorBlindColors(false).bg} text-white`, held > 0)}
                  {tradeBtn('short', 'Short', 'border-2 border-orange-500 text-orange-500')}
                  {tradeBtn('cover', 'Cover', 'border-2 border-blue-500 text-blue-500', (short?.shares || 0) > 0)}
                </div>
              )}

              <div className="flex flex-col items-start gap-2 text-sm">
                <Link to={`/stock/${ticker}`} onClick={onClose} className={`${mutedClass} hover:text-orange-500`}>
                  Full page ↗
                </Link>
                {user && onToggleWatchlist && (
                  <button
                    type="button"
                    onClick={() => onToggleWatchlist(ticker)}
                    className={watched ? 'text-yellow-500' : `${mutedClass} hover:text-yellow-500`}
                  >
                    {manyLists ? `${watched ? '★' : '☆'} Save to list` : watched ? '★ Watching' : '☆ Watch'}
                  </button>
                )}
                {user && onSetAlert && (
                  <button
                    type="button"
                    onClick={() => onSetAlert(ticker)}
                    className={`${mutedClass} hover:text-orange-500`}
                  >
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
            </div>
          </div>
        </div>
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
    </>
  );
};

export default StockPopup;
