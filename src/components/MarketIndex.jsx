import React, { useMemo } from 'react';
import SimpleLineChart from './charts/SimpleLineChart';
import { CHARACTERS } from '../characters';

const nonETFCharacters = CHARACTERS.filter(c => !c.isETF);

const computeIndex = (prices, characters) => {
  let sum = 0;
  let count = 0;
  for (const char of characters) {
    const price = prices?.[char.ticker];
    const base = char.basePrice;
    if (base > 0) {
      sum += (price != null ? price : base) / base;
      count++;
    }
  }
  return count > 0 ? 1000 * (sum / count) : 1000;
};

const MarketIndex = ({ prices, priceHistory, darkMode, colorBlindMode }) => {
  const cardClass = darkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-amber-200';

  const currentIndex = useMemo(() => computeIndex(prices, nonETFCharacters), [prices]);

  const { change24h, changePct24h, sparklineData } = useMemo(() => {
    if (!priceHistory || Object.keys(priceHistory).length === 0) {
      return { change24h: 0, changePct24h: 0, sparklineData: [] };
    }

    const now = Date.now();
    const h24 = 24 * 60 * 60 * 1000;
    const interval = 30 * 60 * 1000; // 30 min
    const points = [];

    for (let t = now - h24; t <= now; t += interval) {
      let sum = 0;
      let count = 0;
      for (const char of nonETFCharacters) {
        const base = char.basePrice;
        if (base <= 0) continue;
        const history = priceHistory?.[char.ticker];
        if (!history || history.length === 0) {
          sum += 1;
          count++;
          continue;
        }
        // Find nearest price at or before time t
        let nearest = null;
        for (let j = history.length - 1; j >= 0; j--) {
          const ts = typeof history[j].timestamp === 'number' ? history[j].timestamp
            : history[j].timestamp?.seconds ? history[j].timestamp.seconds * 1000
            : null;
          if (ts != null && ts <= t) {
            nearest = history[j].price;
            break;
          }
        }
        sum += (nearest != null ? nearest : base) / base;
        count++;
      }
      if (count > 0) {
        points.push({ timestamp: t, price: 1000 * (sum / count) });
      }
    }

    const idx24hAgo = points.length > 0 ? points[0].price : 1000;
    const change = currentIndex - idx24hAgo;
    const pct = idx24hAgo !== 0 ? (change / idx24hAgo) * 100 : 0;

    return { change24h: change, changePct24h: pct, sparklineData: points };
  }, [priceHistory, currentIndex]);

  const fromBase = currentIndex - 1000;
  const fromBasePct = ((currentIndex - 1000) / 1000) * 100;
  const isUp = change24h >= 0;

  const upColor = colorBlindMode ? 'text-teal-400' : 'text-green-500';
  const downColor = colorBlindMode ? 'text-purple-400' : 'text-red-500';
  const changeColor = isUp ? upColor : downColor;

  const baseIsUp = fromBase >= 0;
  const baseColor = baseIsUp ? upColor : downColor;

  return (
    <div className={`${cardClass} border rounded-sm p-4 mb-4`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        {/* Left: Index info */}
        <div className="flex-1 min-w-0">
          <div className={`text-xs font-semibold tracking-wider mb-1 ${darkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
            STOCKISM MARKET INDEX
          </div>
          <div className="flex items-baseline gap-2 flex-wrap">
            <span className={`text-2xl font-bold ${darkMode ? 'text-white' : 'text-zinc-900'}`}>
              {currentIndex.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
            <span className={`text-sm font-semibold ${changeColor}`}>
              {isUp ? '\u25B2' : '\u25BC'} {isUp ? '+' : ''}{change24h.toFixed(2)} ({isUp ? '+' : ''}{changePct24h.toFixed(2)}%) 24h
            </span>
          </div>
          <div className={`text-xs mt-0.5 ${baseColor}`}>
            {baseIsUp ? '\u2191' : '\u2193'} {Math.abs(fromBasePct).toFixed(2)}% from base
          </div>
        </div>

        {/* Right: Sparkline */}
        {sparklineData.length >= 2 && (
          <div className="w-full sm:w-40 h-10 flex-shrink-0">
            <SimpleLineChart
              data={sparklineData}
              darkMode={darkMode}
              colorBlindMode={colorBlindMode}
              width={160}
              height={40}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default MarketIndex;
