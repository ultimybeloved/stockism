import React, { useMemo, useState, useEffect } from 'react';
import { isWeeklyHalt, getHaltTimeRemaining, getNextHaltStart, formatCountdown } from '../utils/marketHours';

const MarketTicker = ({ prices, priceHistory, marketData, darkMode }) => {
  const [countdown, setCountdown] = useState('');
  const halted = isWeeklyHalt() || marketData?.marketHalted;
  const manualHalt = marketData?.marketHalted;

  // Update countdown every 30s during halt
  useEffect(() => {
    if (!halted) return;
    const update = () => {
      if (manualHalt) {
        setCountdown('');
      } else {
        setCountdown(formatCountdown(getHaltTimeRemaining()));
      }
    };
    update();
    const interval = setInterval(update, 30000);
    return () => clearInterval(interval);
  }, [halted, manualHalt]);

  // Compute top movers
  const movers = useMemo(() => {
    if (!prices || !priceHistory) return [];
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    const entries = Object.entries(prices).map(([ticker, price]) => {
      const history = priceHistory[ticker] || [];
      if (history.length === 0) return null;
      let price24hAgo = history[0].price;
      for (let i = history.length - 1; i >= 0; i--) {
        if (history[i].timestamp <= dayAgo) {
          price24hAgo = history[i].price;
          break;
        }
      }
      const change = price24hAgo > 0 ? ((price - price24hAgo) / price24hAgo) * 100 : 0;
      return { ticker, price, change };
    }).filter(Boolean);

    entries.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return entries.slice(0, 8);
  }, [prices, priceHistory]);

  // Schedule info
  const nextHalt = getNextHaltStart();
  const scheduleText = `Weekly halt: Thu 13:00–21:00 UTC`;

  const haltReason = marketData?.haltReason;

  const haltContent = manualHalt
    ? `MARKET CLOSED — ${haltReason || 'Emergency halt in progress'}`
    : `MARKET CLOSED — Chapter review in progress | Reopens in ${countdown}`;

  const normalContent = movers.length > 0
    ? movers.map(m => {
        const arrow = m.change >= 0 ? '▲' : '▼';
        const sign = m.change >= 0 ? '+' : '';
        return `${m.ticker} $${m.price.toFixed(2)} ${arrow}${sign}${m.change.toFixed(1)}%`;
      }).join('   ·   ') + `   |   ${scheduleText}`
    : scheduleText;

  const content = halted ? haltContent : normalContent;

  return (
    <div className={`w-full overflow-hidden sticky top-16 z-30 ${halted
      ? 'bg-red-900/80 border-b border-red-700'
      : darkMode ? 'bg-zinc-800 border-b border-zinc-700' : 'bg-slate-100 border-b border-slate-200'
    }`} style={{ height: '32px' }}>
      <div
        className="ticker-scroll-container flex items-center h-full whitespace-nowrap"
        style={{
          animation: halted ? 'none' : 'ticker-scroll 30s linear infinite',
        }}
        onMouseEnter={e => { if (!halted) e.currentTarget.style.animationPlayState = 'paused'; }}
        onMouseLeave={e => { if (!halted) e.currentTarget.style.animationPlayState = 'running'; }}
      >
        {halted ? (
          <div className="w-full flex items-center justify-center px-4">
            <span className="text-red-200 text-xs font-bold tracking-wide">
              {content}
            </span>
          </div>
        ) : (
          <>
            <span className={`text-xs font-medium px-4 ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
              {movers.map((m, i) => (
                <span key={m.ticker}>
                  {i > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> · </span>}
                  <span className={darkMode ? 'text-zinc-400' : 'text-slate-500'}>{m.ticker}</span>
                  {' '}
                  <span className={darkMode ? 'text-zinc-200' : 'text-slate-700'}>${m.price.toFixed(2)}</span>
                  {' '}
                  <span className={m.change >= 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
                  }>
                    {m.change >= 0 ? '▲' : '▼'}{m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                  </span>
                </span>
              ))}
              {movers.length > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> | </span>}
              <span className={darkMode ? 'text-zinc-500' : 'text-slate-400'}>{scheduleText}</span>
            </span>
            {/* Duplicate for seamless loop */}
            <span className={`text-xs font-medium px-4 ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
              {movers.map((m, i) => (
                <span key={m.ticker}>
                  {i > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> · </span>}
                  <span className={darkMode ? 'text-zinc-400' : 'text-slate-500'}>{m.ticker}</span>
                  {' '}
                  <span className={darkMode ? 'text-zinc-200' : 'text-slate-700'}>${m.price.toFixed(2)}</span>
                  {' '}
                  <span className={m.change >= 0
                    ? 'text-emerald-500'
                    : 'text-red-500'
                  }>
                    {m.change >= 0 ? '▲' : '▼'}{m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                  </span>
                </span>
              ))}
              {movers.length > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> | </span>}
              <span className={darkMode ? 'text-zinc-500' : 'text-slate-400'}>{scheduleText}</span>
            </span>
          </>
        )}
      </div>
    </div>
  );
};

export default MarketTicker;
