import { useState, useEffect, useMemo, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency, formatChange } from '../../../utils/formatters';
import CharacterMeta from './CharacterMeta';
import ReviewChangeBadge from './ReviewChangeBadge';
import { themeClasses, getRarityStagger } from '../../../utils/theme';
import { rarityClassFor } from '../../../utils/rarity';
import { statusBadge, STATUS_MAP, statusOf } from '../../../constants/statuses';
import SimpleLineChart from '../../../shared/components/charts/SimpleLineChart';
import ShortRiskTag from '../../trading/components/ShortRiskTag';
import CardTradeMenu from './CardTradeMenu';
import { useSession, useMarket } from '../../../context/AppContext';

import { getMarketClosedState, type ReviewChange } from '../../../utils/marketHours';
import type { Character } from '../../../characters';
import type { PricePoint, ShortPosition, TradeAction } from '../../../types';
import type { TradeAnimation } from '../../../shared/hooks/types';
import { pressable } from '../../../utils/a11y';
import PixelIcon from '../../../shared/components/PixelIcon';
import { usePhone } from '../../../shared/hooks/useMediaQuery';
import { useLongPress } from '../hooks/useLongPress';

interface CharacterCardProps {
  character: Character;
  price: number;
  sentiment: string;
  holdings: number;
  shortPosition?: ShortPosition;
  onTrade: (ticker: string, action: TradeAction, amount: number) => unknown;
  onViewChart: (character: Character, timeRange: string) => void;
  userCash?: number;
  isWatchlisted?: boolean;
  onToggleWatchlist?: (ticker: string) => void;
  tradeAnimation?: TradeAnimation | null;
  /** Set while this one ticker is paused by the circuit breaker. */
  haltInfo?: { resumeAt?: number } | null;
  onSetAlert?: (ticker: string) => void;
  reviewChange?: ReviewChange | null;
  /** Phones: press and hold the card for its quick actions. */
  onQuickActions?: (character: Character) => void;
  /** Wide screens: open in the stock window, or picked for a comparison. */
  highlight?: 'open' | 'compare' | null;
}

/**
 * The mini chart's points since `since`. With fewer than two real points it
 * draws a straight line from the price back then (or the oldest known price) to now.
 */
const chartSince = (data: PricePoint[], since: number, basePrice: number, price: number): PricePoint[] => {
  const filtered = data.filter((p) => p.timestamp >= since);
  if (filtered.length >= 2) {
    // Open the line at the price when the period began, so the card's % includes
    // the period's first trade.
    const opening = data.findLast((p) => p.timestamp < since);
    return opening ? [{ ...opening, timestamp: since }, ...filtered] : filtered;
  }

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
  isWatchlisted,
  onToggleWatchlist,
  tradeAnimation,
  haltInfo,
  onSetAlert,
  reviewChange,
  onQuickActions,
  highlight = null,
}: CharacterCardProps) => {
  const { user, userData } = useSession();
  const { priceHistory, marketData, rarityTiers } = useMarket();
  const phone = usePhone();

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

  const { cardClass: themeCardClass, textClass, mutedClass, raisedClass } = themeClasses;
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
  const changeColor = isUp
    ? colorBlindMode
      ? 'text-teal-500'
      : 'text-green-500'
    : colorBlindMode
      ? 'text-purple-500'
      : 'text-red-500';
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

  const openChart = () => onViewChart(character, defaultChartTimeRange);
  const press = useLongPress(openChart, phone && onQuickActions ? () => onQuickActions(character) : undefined);

  return (
    <>
      <div
        data-tour="card"
        style={rarityStyle}
        className={`${cardClass} border rounded-sm p-4 transition-all relative flex flex-col ${frameClass} ${
          highlight === 'open' ? 'ring-2 ring-orange-500' : highlight === 'compare' ? 'ring-2 ring-blue-500' : ''
        } ${
          tradeAnimation
            ? tradeAnimation.big
              ? 'animate-trade-gold'
              : tradeAnimation.action === 'buy' || tradeAnimation.action === 'cover'
                ? 'animate-trade-buy'
                : 'animate-trade-sell'
            : ''
        }`}
      >
        {isHalted && (
          <div className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none">
            <div className="bg-red-600/90 text-white px-3 py-1.5 rounded-sm text-xs font-bold uppercase tracking-wider shadow-lg">
              HALTED {haltCountdown && `(${haltCountdown})`}
            </div>
          </div>
        )}
        <div className="cursor-pointer select-none" {...pressable(openChart)} {...press}>
          {reviewChange && <ReviewChangeBadge change={reviewChange} currentPrice={price} />}
          <div className="flex justify-between items-baseline gap-2">
            <div className="flex items-center gap-1 min-w-0">
              <p className="text-orange-500 font-mono text-[15px] font-semibold">${character.ticker}</p>
              {isETF && <span className="text-[10px] bg-purple-600 text-white px-1 rounded">ETF</span>}
              {!isETF && statusBadge(character) && (
                <span title={STATUS_MAP[statusOf(character)]?.hint}>
                  <PixelIcon name={statusBadge(character)} className="w-3.5 h-3.5" />
                </span>
              )}
            </div>
            <p className={`text-lg font-semibold tabular-nums ${textClass}`}>{formatCurrency(price)}</p>
          </div>
          <div className="flex justify-between items-baseline gap-2">
            <p className={`text-xs truncate ${mutedClass}`}>{character.name}</p>
            <p className={`shrink-0 text-xs font-mono ${changeColor}`}>
              {isUp ? '▲' : '▼'} {formatChange(chartChange)}
            </p>
          </div>
          {/* Phones: two cards a row leaves no room for crew chips. */}
          <div className="max-md:hidden">
            <CharacterMeta character={character} />
          </div>
          <div className="my-3">
            <SimpleLineChart
              data={miniChartData}
              colorBlindMode={colorBlindMode}
              width={260}
              height={44}
              className="h-11"
              stretch
            />
          </div>
        </div>

        <div className="mt-auto">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mb-2">
            <span className={`text-[10px] ${getSentimentColor()} font-semibold uppercase`}>{sentiment}</span>
            {owned && <span className="text-[11px] text-blue-500 font-semibold">{holdings} long</span>}
            <ShortRiskTag
              shortPosition={shortPosition}
              ticker={character.ticker}
              price={price}
              colorBlindMode={colorBlindMode}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onToggleWatchlist && user && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWatchlist(character.ticker);
                }}
                className={`text-lg leading-none transition-colors ${isWatchlisted ? 'text-yellow-400' : mutedClass + ' hover:text-yellow-400 opacity-50 hover:opacity-100'}`}
                title={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
                aria-label={isWatchlisted ? 'Remove from watchlist' : 'Add to watchlist'}
              >
                {isWatchlisted ? '★' : '☆'}
              </button>
            )}
            {user && onSetAlert && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onSetAlert(character.ticker);
                }}
                className="transition-opacity opacity-50 hover:opacity-100"
                title="Set price alert"
                aria-label="Set price alert"
              >
                <PixelIcon name="bell" className="w-4 h-4 block" />
              </button>
            )}
            {/* Phones open Details from press and hold. */}
            <Link
              to={`/stock/${character.ticker}`}
              onClick={(e) => e.stopPropagation()}
              className={`max-md:hidden text-[11px] ${mutedClass} hover:text-orange-500`}
            >
              Details ↗
            </Link>
            <div className="ml-auto">
              <CardTradeMenu
                character={character}
                price={price}
                holdings={holdings}
                shortPosition={shortPosition}
                userCash={userCash}
                onTrade={onTrade}
                haltInfo={haltInfo}
                blocked={isHalted || marketClosed}
                label={isHalted ? 'Halted' : marketState.label}
              />
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default CharacterCard;
