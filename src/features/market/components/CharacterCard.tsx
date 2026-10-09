import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import CharacterMeta from './CharacterMeta';
import ReviewChangeBadge from './ReviewChangeBadge';
import { themeClasses, getRarityStagger, SPACING } from '../../../utils/theme';
import { rarityClassFor } from '../../../utils/rarity';
import { statusBadge, STATUS_MAP, statusOf } from '../../../constants/statuses';
import SimpleLineChart from '../../../shared/components/charts/SimpleLineChart';
import ShortRiskTag from '../../trading/components/ShortRiskTag';
import TradeActionModal, { type OrderFormMode } from '../../trading/components/TradeActionModal';
import PreMarketModal from '../../trading/components/PreMarketModal';
import { useSession, useMarket } from '../../../context/AppContext';

import { isPreMarketWindow, getMarketClosedState, type ReviewChange } from '../../../utils/marketHours';
import type { Character } from '../../../characters';
import type { PricePoint, ShortPosition, TradeAction } from '../../../types';
import type { LimitOrderRequest } from '../../account/hooks/useUserActions';
import type { TradeAnimation } from '../../../shared/hooks/types';

interface CharacterCardProps {
  character: Character;
  price: number;
  sentiment: string;
  holdings: number;
  shortPosition?: ShortPosition;
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  onViewChart: (character: Character, timeRange: string) => void;
  userCash?: number;
  limitOrderRequest?: LimitOrderRequest | null;
  onClearLimitOrderRequest?: () => void;
  isWatchlisted?: boolean;
  onToggleWatchlist?: (ticker: string) => void;
  tradeAnimation?: TradeAnimation | null;
  /** Set while this one ticker is paused by the circuit breaker. */
  haltInfo?: { resumeAt?: number } | null;
  onSetAlert?: (ticker: string) => void;
  reviewChange?: ReviewChange | null;
}

/**
 * The mini chart's points since `since`. With fewer than two real points it
 * draws a straight line from the price back then (or the oldest known price) to now.
 */
const chartSince = (data: PricePoint[], since: number, basePrice: number, price: number): PricePoint[] => {
  const filtered = data.filter((p) => p.timestamp >= since);
  if (filtered.length >= 2) return filtered;

  let startPrice = basePrice;
  for (let i = data.length - 1; i >= 0; i--) {
    const point = data[i]!;
    if (point.timestamp <= since) {
      startPrice = point.price;
      break;
    }
  }
  const oldest = data[0];
  if (startPrice === basePrice && oldest) startPrice = oldest.price;

  return [
    { timestamp: since, price: startPrice },
    { timestamp: Date.now(), price },
  ];
};

const CharacterCard = ({
  character,
  price,
  sentiment,
  holdings,
  shortPosition,
  onTrade,
  onViewChart,
  userCash = 0,
  limitOrderRequest,
  onClearLimitOrderRequest,
  isWatchlisted,
  onToggleWatchlist,
  tradeAnimation,
  haltInfo,
  onSetAlert,
  reviewChange,
}: CharacterCardProps) => {
  const { user, userData } = useSession();
  const { priceHistory, marketData, rarityTiers } = useMarket();
  const [showTradeMenu, setShowTradeMenu] = useState(false);
  const [tradeAction, setTradeAction] = useState<TradeAction | null>(null);
  const [shouldOpenAsLimit, setShouldOpenAsLimit] = useState<OrderFormMode>(false);
  const [showPreMarket, setShowPreMarket] = useState(false);
  const [preMarketAction, setPreMarketAction] = useState<'buy' | 'sell'>('buy');

  // Check if this card should open in limit order or stop loss mode
  useEffect(() => {
    if (limitOrderRequest && limitOrderRequest.ticker === character.ticker) {
      setTradeAction(limitOrderRequest.action as TradeAction);
      setShouldOpenAsLimit((limitOrderRequest.mode as OrderFormMode) || 'limit');
      if (onClearLimitOrderRequest) {
        onClearLimitOrderRequest();
      }
    }
  }, [limitOrderRequest, character.ticker, onClearLimitOrderRequest]);

  const [haltCountdown, setHaltCountdown] = useState('');

  const owned = holdings > 0.001;
  const shorted = !!shortPosition && shortPosition.shares > 0;
  const isETF = character.isETF;
  const colorBlindMode = userData?.colorBlindMode || false;
  const resumeAt = haltInfo?.resumeAt ?? 0;
  const isHalted = Date.now() < resumeAt;
  const marketState = getMarketClosedState(marketData);
  const marketClosed = marketState.closed; // weekly review or admin halt (market-wide, not per-ticker)

  // Halt countdown timer
  useEffect(() => {
    if (!isHalted) {
      setHaltCountdown('');
      return;
    }
    const tick = () => {
      const remaining = resumeAt - Date.now();
      if (remaining <= 0) {
        setHaltCountdown('');
        return;
      }
      const mins = Math.floor(remaining / 60000);
      const secs = Math.floor((remaining % 60000) / 1000);
      setHaltCountdown(`${mins}:${secs.toString().padStart(2, '0')}`);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [isHalted, resumeAt]);

  // Color blind friendly helper for Buy/Sell (solid buttons)
  const getBuySellColors = (isBuy: boolean) => {
    if (colorBlindMode) {
      return isBuy
        ? { bg: 'bg-teal-600', bgHover: 'hover:bg-teal-700' }
        : { bg: 'bg-purple-600', bgHover: 'hover:bg-purple-700' };
    } else {
      return isBuy
        ? { bg: 'bg-green-600', bgHover: 'hover:bg-green-700' }
        : { bg: 'bg-red-600', bgHover: 'hover:bg-red-700' };
    }
  };

  const { cardClass: themeCardClass, textClass, mutedClass, ghostBtnClass, raisedClass } = themeClasses;
  const cardClass = `${themeCardClass} ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}`;

  const getSentimentColor = () => {
    const positiveColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
    const positiveColorLight = colorBlindMode ? 'text-teal-400' : 'text-green-400';
    const negativeColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
    const negativeColorLight = colorBlindMode ? 'text-purple-400' : 'text-red-400';

    switch (sentiment) {
      case 'Strong Buy':
        return positiveColor;
      case 'Bullish':
        return positiveColorLight;
      case 'Neutral':
        return 'text-amber-500';
      case 'Bearish':
        return negativeColorLight;
      case 'Strong Sell':
        return negativeColor;
      default:
        return mutedClass;
    }
  };

  const chart24hData = useMemo(
    () =>
      chartSince(priceHistory[character.ticker] || [], Date.now() - 24 * 60 * 60 * 1000, character.basePrice, price),
    [priceHistory, character.ticker, character.basePrice, price],
  );
  const chart7dData = useMemo(
    () =>
      chartSince(
        priceHistory[character.ticker] || [],
        Date.now() - 7 * 24 * 60 * 60 * 1000,
        character.basePrice,
        price,
      ),
    [priceHistory, character.ticker, character.basePrice, price],
  );

  // Calculate 24h percentage change
  const chart24hFirstPrice = chart24hData[0]?.price || price;
  const chart24hLastPrice = chart24hData[chart24hData.length - 1]?.price || price;
  const chart24hChange =
    chart24hFirstPrice > 0 ? ((chart24hLastPrice - chart24hFirstPrice) / chart24hFirstPrice) * 100 : 0;

  // Calculate 7d percentage change
  const chart7dFirstPrice = chart7dData[0]?.price || price;
  const chart7dLastPrice = chart7dData[chart7dData.length - 1]?.price || price;
  const chart7dChange = chart7dFirstPrice > 0 ? ((chart7dLastPrice - chart7dFirstPrice) / chart7dFirstPrice) * 100 : 0;

  // Determine if we should use 7d data instead of 24h
  const use7dChart = chart24hData.length <= 2 || Math.abs(chart24hChange) < 0.01;

  // Use the appropriate data for display
  const miniChartData = use7dChart ? chart7dData : chart24hData;
  const chartChange = use7dChart ? chart7dChange : chart24hChange;
  const isUp = chartChange >= 0;
  const defaultChartTimeRange = use7dChart ? '7d' : '1d';

  // Card rarity tier by market standing (ETFs have no tier). See utils/rarity.js —
  // the ranking is computed once in App and shared via context. Tiered cards get
  // their frame + depth from .rarity-* in index.css; untiered (ETF) cards fall
  // back to the standard elevation token so they don't look flat next to them.
  const rarityTier = isETF ? undefined : rarityTiers?.[character.ticker];
  const frameClass = rarityClassFor(rarityTier) || raisedClass;
  // Legendary frames tick every few seconds; offset each card by ticker so
  // multiple legendaries on screen never tick together.
  const rarityStyle =
    rarityTier === 'legendary'
      ? ({ '--rarity-stagger': getRarityStagger(character.ticker) } as CSSProperties)
      : undefined;

  return (
    <>
      <div
        style={rarityStyle}
        className={`${cardClass} border rounded-sm ${SPACING.cardPad} transition-all relative ${frameClass} ${
          tradeAnimation
            ? tradeAnimation.big
              ? 'animate-trade-gold'
              : tradeAnimation.action === 'buy' || tradeAnimation.action === 'cover'
                ? 'animate-trade-buy'
                : 'animate-trade-sell'
            : ''
        }`}
      >
        {onToggleWatchlist && user && (
          <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
            {onSetAlert && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetAlert(character.ticker);
                }}
                className={`text-sm leading-none transition-colors ${mutedClass} hover:text-orange-500 opacity-40 hover:opacity-100`}
                title="Set price alert"
              >
                🔔
              </button>
            )}
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleWatchlist(character.ticker);
              }}
              className={`text-lg leading-none transition-colors ${isWatchlisted ? 'text-yellow-400' : mutedClass + ' hover:text-yellow-400 opacity-40 hover:opacity-100'}`}
              title={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
            >
              {isWatchlisted ? '\u2605' : '\u2606'}
            </button>
          </div>
        )}
        {isHalted && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="bg-red-600/90 text-white px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider shadow-lg">
              HALTED {haltCountdown && `(${haltCountdown})`}
            </div>
          </div>
        )}
        <div className="cursor-pointer" onClick={() => onViewChart(character, defaultChartTimeRange)}>
          {reviewChange && <ReviewChangeBadge change={reviewChange} currentPrice={price} />}
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="flex items-center gap-1">
                <p className="text-orange-500 font-mono text-sm font-semibold">${character.ticker}</p>
                {isETF && <span className="text-xs bg-purple-600 text-white px-1 rounded">ETF</span>}
                {!isETF && statusBadge(character) && (
                  <span className="text-xs" title={STATUS_MAP[statusOf(character)]?.hint}>
                    {statusBadge(character)}
                  </span>
                )}
              </div>
              {!isETF && <p className={`text-xs ${mutedClass} mt-0.5`}>{character.name}</p>}
              <CharacterMeta character={character} />
            </div>
            <div className="text-right">
              <p className={`font-semibold ${textClass}`}>{formatCurrency(price)}</p>
              <p
                className={`text-xs font-mono ${isUp ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : colorBlindMode ? 'text-purple-500' : 'text-red-500'}`}
              >
                {isUp ? '▲' : '▼'} {formatChange(chartChange)}
              </p>
            </div>
          </div>
          <div className="mb-2">
            <SimpleLineChart data={miniChartData} colorBlindMode={colorBlindMode} />
          </div>
        </div>

        <div className="flex justify-between items-center mb-3">
          <div className="flex items-center gap-2">
            <span className={`text-xs ${getSentimentColor()} font-semibold uppercase`}>{sentiment}</span>
            <Link
              to={`/stock/${character.ticker}`}
              onClick={(e) => e.stopPropagation()}
              className={`text-[10px] ${mutedClass} hover:text-orange-500`}
            >
              Details ↗
            </Link>
          </div>
          <div className="flex gap-2">
            {owned && <span className="text-xs text-blue-500 font-semibold">{holdings} long</span>}
            <ShortRiskTag
              shortPosition={shortPosition}
              ticker={character.ticker}
              price={price}
              colorBlindMode={colorBlindMode}
            />
          </div>
        </div>

        {!showTradeMenu ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!isHalted && !marketClosed) setShowTradeMenu(true);
            }}
            disabled={isHalted || marketClosed}
            className={`w-full py-1.5 text-xs font-semibold uppercase rounded-sm border ${
              isHalted || marketClosed ? 'border-red-500/30 text-red-400 opacity-50 cursor-not-allowed' : ghostBtnClass
            }`}
          >
            {isHalted ? 'Trading Halted' : marketState.label}
          </button>
        ) : (
          <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => {
                  setShowTradeMenu(false);
                  if (isPreMarketWindow()) {
                    setPreMarketAction('buy');
                    setShowPreMarket(true);
                  } else setTradeAction('buy');
                }}
                className={`py-2 text-xs font-semibold uppercase rounded-sm ${getBuySellColors(true).bg} ${getBuySellColors(true).bgHover} text-white`}
              >
                Buy
              </button>
              <button
                onClick={() => {
                  setShowTradeMenu(false);
                  if (isPreMarketWindow()) {
                    setPreMarketAction('sell');
                    setShowPreMarket(true);
                  } else setTradeAction('sell');
                }}
                disabled={holdings === 0}
                className={`py-2 text-xs font-semibold uppercase rounded-sm ${getBuySellColors(false).bg} ${getBuySellColors(false).bgHover} text-white disabled:opacity-50`}
              >
                Sell
              </button>
              <button
                onClick={() => {
                  setTradeAction('short');
                  setShowTradeMenu(false);
                }}
                className="py-2 text-xs font-semibold uppercase rounded-sm border-2 border-orange-500 light:text-orange-500 light:hover:bg-orange-50 dark:text-orange-400 dark:hover:bg-orange-900/30"
              >
                Short
              </button>
              <button
                onClick={() => {
                  setTradeAction('cover');
                  setShowTradeMenu(false);
                }}
                disabled={!shorted}
                className="py-2 text-xs font-semibold uppercase rounded-sm border-2 border-blue-500 light:text-blue-600 light:hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/30 disabled:opacity-50"
              >
                Cover
              </button>
            </div>
            <button
              onClick={() => setShowTradeMenu(false)}
              className={`w-full py-1 text-xs ${mutedClass} hover:text-orange-500`}
            >
              Cancel
            </button>
          </div>
        )}
      </div>

      {/* Trade Action Modal */}
      {tradeAction && (
        <TradeActionModal
          character={character}
          action={tradeAction}
          price={price}
          holdings={holdings}
          shortPosition={shortPosition}
          userCash={userCash}
          onTrade={onTrade}
          onClose={() => {
            setTradeAction(null);
            setShouldOpenAsLimit(false);
          }}
          defaultToLimitOrder={shouldOpenAsLimit}
          haltInfo={haltInfo}
        />
      )}

      {/* Pre-Market Opening Auction Modal */}
      {showPreMarket && (
        <PreMarketModal
          character={character}
          price={price}
          holdings={holdings}
          userCash={userCash}
          initialAction={preMarketAction}
          onClose={() => setShowPreMarket(false)}
        />
      )}
    </>
  );
};

export default CharacterCard;
