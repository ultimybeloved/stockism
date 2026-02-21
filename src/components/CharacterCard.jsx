import React, { useState, useEffect, useMemo } from 'react';
import { formatCurrency, formatChange } from '../utils/formatters';
import SimpleLineChart from './charts/SimpleLineChart';
import TradeActionModal from './modals/TradeActionModal';

const CharacterCard = ({ character, price, priceChange, sentiment, holdings, shortPosition, onTrade, onViewChart, priceHistory, darkMode, userCash = 0, userData, prices, user, limitOrderRequest, onClearLimitOrderRequest }) => {
  const [showTradeMenu, setShowTradeMenu] = useState(false);
  const [tradeAction, setTradeAction] = useState(null); // 'buy', 'sell', 'short', or 'cover'
  const [shouldOpenAsLimit, setShouldOpenAsLimit] = useState(false);
  const [etfExpanded, setEtfExpanded] = useState(false);

  // Check if this card should open in limit order mode
  useEffect(() => {
    if (limitOrderRequest && limitOrderRequest.ticker === character.ticker) {
      setTradeAction(limitOrderRequest.action);
      setShouldOpenAsLimit(true);
      if (onClearLimitOrderRequest) {
        onClearLimitOrderRequest();
      }
    }
  }, [limitOrderRequest, character.ticker, onClearLimitOrderRequest]);

  const owned = holdings > 0;
  const shorted = shortPosition && shortPosition.shares > 0;
  const isETF = character.isETF;
  const colorBlindMode = userData?.colorBlindMode || false;

  // Color blind friendly helper for Buy/Sell (solid buttons)
  const getBuySellColors = (isBuy) => {
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

  const cardClass = darkMode
    ? `bg-zinc-900 border-zinc-800 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}`
    : `bg-white border-amber-200 ${owned ? 'ring-1 ring-blue-500' : ''} ${shorted ? 'ring-1 ring-orange-500' : ''}`;
  const textClass = darkMode ? 'text-zinc-100' : 'text-slate-900';
  const mutedClass = darkMode ? 'text-zinc-400' : 'text-zinc-500';

  const getSentimentColor = () => {
    const positiveColor = colorBlindMode ? 'text-teal-500' : 'text-green-500';
    const positiveColorLight = colorBlindMode ? 'text-teal-400' : 'text-green-400';
    const negativeColor = colorBlindMode ? 'text-purple-500' : 'text-red-500';
    const negativeColorLight = colorBlindMode ? 'text-purple-400' : 'text-red-400';

    switch (sentiment) {
      case 'Strong Buy': return positiveColor;
      case 'Bullish': return positiveColorLight;
      case 'Neutral': return 'text-amber-500';
      case 'Bearish': return negativeColorLight;
      case 'Strong Sell': return negativeColor;
      default: return mutedClass;
    }
  };

  // Calculate 24h chart data
  const chart24hData = useMemo(() => {
    const data = priceHistory[character.ticker] || [];
    const now = Date.now();
    const dayAgo = now - (24 * 60 * 60 * 1000);
    const filtered = data.filter(p => p.timestamp >= dayAgo);

    // If we have enough data, use it
    if (filtered.length >= 2) {
      return filtered;
    }

    // Find price from ~24h ago for synthetic chart
    let price24hAgo = character.basePrice;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].timestamp <= dayAgo) {
        price24hAgo = data[i].price;
        break;
      }
    }
    // If no history before 24h ago, use oldest available or basePrice
    if (price24hAgo === character.basePrice && data.length > 0) {
      price24hAgo = data[0].price;
    }

    return [
      { timestamp: dayAgo, price: price24hAgo },
      { timestamp: now, price: price }
    ];
  }, [priceHistory, character.ticker, character.basePrice, price]);

  // Calculate 7d chart data
  const chart7dData = useMemo(() => {
    const data = priceHistory[character.ticker] || [];
    const now = Date.now();
    const weekAgo = now - (7 * 24 * 60 * 60 * 1000);
    const filtered = data.filter(p => p.timestamp >= weekAgo);

    if (filtered.length >= 2) {
      return filtered;
    }

    // Find price from ~7d ago for synthetic chart
    let price7dAgo = character.basePrice;
    for (let i = data.length - 1; i >= 0; i--) {
      if (data[i].timestamp <= weekAgo) {
        price7dAgo = data[i].price;
        break;
      }
    }
    if (price7dAgo === character.basePrice && data.length > 0) {
      price7dAgo = data[0].price;
    }

    return [
      { timestamp: weekAgo, price: price7dAgo },
      { timestamp: now, price: price }
    ];
  }, [priceHistory, character.ticker, character.basePrice, price]);

  // Calculate 24h percentage change
  const chart24hFirstPrice = chart24hData[0]?.price || price;
  const chart24hLastPrice = chart24hData[chart24hData.length - 1]?.price || price;
  const chart24hChange = chart24hFirstPrice > 0 ? ((chart24hLastPrice - chart24hFirstPrice) / chart24hFirstPrice) * 100 : 0;

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

  // Calculate short P/L if shorted
  const shortPL = shorted ? ((shortPosition.costBasis || shortPosition.entryPrice || 0) - price) * shortPosition.shares : 0;

  return (
    <>
      <div className={`${cardClass} border rounded-sm p-4 transition-all`}>
        <div className="cursor-pointer" onClick={() => onViewChart(character, defaultChartTimeRange)}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <div className="flex items-center gap-1">
                <p className="text-orange-600 font-mono text-sm font-semibold">${character.ticker}</p>
                {isETF && <span className="text-xs bg-purple-600 text-white px-1 rounded">ETF</span>}
              </div>
              {!isETF && <p className={`text-xs ${mutedClass} mt-0.5`}>{character.name}</p>}
              {character.description && <p className={`text-xs ${mutedClass}${isETF ? ' mt-0.5' : ''}`}>{character.description}</p>}
              {isETF && character.constituents && (() => {
                const sorted = [...character.constituents].sort((a, b) => (prices?.[b] || 0) - (prices?.[a] || 0));
                const preview = sorted.slice(0, 6);
                const hasMore = sorted.length > 6;
                return (
                  <div className="flex flex-wrap gap-1 mt-1">
                    {(etfExpanded ? sorted : preview).map(t => (
                      <span key={t} className={`text-[10px] font-mono px-1 rounded ${darkMode ? 'bg-purple-900/40 text-purple-300' : 'bg-purple-100 text-purple-700'}`}>
                        {t}{etfExpanded && prices?.[t] ? ` ${formatCurrency(prices[t])}` : ''}
                      </span>
                    ))}
                    {hasMore && (
                      <button
                        onClick={(e) => { e.stopPropagation(); setEtfExpanded(!etfExpanded); }}
                        className={`text-[10px] ${mutedClass} hover:text-orange-500 cursor-pointer`}
                      >
                        {etfExpanded ? 'show less' : `+${sorted.length - 6} more`}
                      </button>
                    )}
                  </div>
                );
              })()}
            </div>
            <div className="text-right">
              <p className={`font-semibold ${textClass}`}>{formatCurrency(price)}</p>
              <p className={`text-xs font-mono ${isUp ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                {isUp ? '▲' : '▼'} {formatChange(chartChange)}
              </p>
            </div>
          </div>
          <div className="mb-2">
            <SimpleLineChart data={miniChartData} darkMode={darkMode} colorBlindMode={userData?.colorBlindMode || false} />
          </div>
        </div>

        <div className="flex justify-between items-center mb-3">
          <span className={`text-xs ${getSentimentColor()} font-semibold uppercase`}>{sentiment}</span>
          <div className="flex gap-2">
            {owned && <span className="text-xs text-blue-500 font-semibold">{holdings} long</span>}
            {shorted && (
              <span className={`text-xs font-semibold ${shortPL >= 0 ? (colorBlindMode ? 'text-teal-500' : 'text-green-500') : (colorBlindMode ? 'text-purple-500' : 'text-red-500')}`}>
                {shortPosition.shares} short ({shortPL >= 0 ? '+' : ''}{formatCurrency(shortPL)})
              </span>
            )}
          </div>
        </div>

        {!showTradeMenu ? (
          <button
            onClick={(e) => { e.stopPropagation(); setShowTradeMenu(true); }}
            className={`w-full py-1.5 text-xs font-semibold uppercase rounded-sm border ${
              darkMode ? 'border-zinc-700 text-zinc-300 hover:bg-zinc-800' : 'border-amber-200 text-zinc-600 hover:bg-amber-50'
            }`}
          >
            Trade
          </button>
        ) : (
          <div className="space-y-2" onClick={e => e.stopPropagation()}>
            {/* Action buttons */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => { setTradeAction('buy'); setShowTradeMenu(false); }}
                className={`py-2 text-xs font-semibold uppercase rounded-sm ${getBuySellColors(true).bg} ${getBuySellColors(true).bgHover} text-white`}
              >
                Buy
              </button>
              <button
                onClick={() => { setTradeAction('sell'); setShowTradeMenu(false); }}
                disabled={holdings === 0}
                className={`py-2 text-xs font-semibold uppercase rounded-sm ${getBuySellColors(false).bg} ${getBuySellColors(false).bgHover} text-white disabled:opacity-50`}
              >
                Sell
              </button>
              <button
                onClick={() => { setTradeAction('short'); setShowTradeMenu(false); }}
                className={`py-2 text-xs font-semibold uppercase rounded-sm border-2 border-orange-500 ${darkMode ? 'text-orange-400 hover:bg-orange-900/30' : 'text-orange-600 hover:bg-orange-50'}`}
              >
                Short
              </button>
              <button
                onClick={() => { setTradeAction('cover'); setShowTradeMenu(false); }}
                disabled={!shorted}
                className={`py-2 text-xs font-semibold uppercase rounded-sm border-2 border-blue-500 ${darkMode ? 'text-blue-400 hover:bg-blue-900/30' : 'text-blue-600 hover:bg-blue-50'} disabled:opacity-50`}
              >
                Cover
              </button>
            </div>
            <button
              onClick={() => setShowTradeMenu(false)}
              className={`w-full py-1 text-xs ${mutedClass} hover:text-orange-600`}
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
          userData={userData}
          prices={prices}
          onTrade={onTrade}
          onClose={() => { setTradeAction(null); setShouldOpenAsLimit(false); }}
          darkMode={darkMode}
          priceHistory={priceHistory}
          colorBlindMode={userData?.colorBlindMode || false}
          user={user}
          defaultToLimitOrder={shouldOpenAsLimit}
        />
      )}
    </>
  );
};

export default CharacterCard;
