import { useMemo, useState, useEffect } from 'react';
import { isWeeklyHalt, formatCountdown, isMarketOpenGracePeriod, getWeeklyHaltPhase, HALT_END_MINUTE, GRACE_PERIOD_MINUTES } from '../utils/marketHours';
import { useAppContext } from '../context/AppContext';

const MarketTicker = () => {
  const { prices, priceHistory, marketData, darkMode, userData } = useAppContext();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [haltBanner, setHaltBanner] = useState(null); // { text, tone: 'red' | 'amber' }
  const [gracePeriod, setGracePeriod] = useState(isMarketOpenGracePeriod());
  const halted = isWeeklyHalt() || marketData?.marketHalted;
  const manualHalt = marketData?.marketHalted;
  const haltReason = marketData?.haltReason;

  useEffect(() => {
    const check = () => setGracePeriod(isMarketOpenGracePeriod());
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  // Update the halt banner every 15s. The Thursday halt has three phases and
  // the banner walks players through them: closed (pre-market countdown),
  // queue open (place orders now), locked (auction about to run).
  useEffect(() => {
    if (!halted) return;
    const update = () => {
      if (manualHalt) {
        setHaltBanner({ text: `MARKET CLOSED: ${haltReason || 'Emergency halt in progress'}`, tone: 'red' });
        return;
      }
      const p = getWeeklyHaltPhase();
      if (!p) return;
      const t = formatCountdown(p.msToNext);
      if (p.phase === 'closed') {
        setHaltBanner({ text: `MARKET CLOSED: Chapter review · Pre-market opens in ${t}, queue orders early for the 21:00 UTC open`, tone: 'red' });
      } else if (p.phase === 'queue') {
        setHaltBanner({ text: `PRE-MARKET OPEN: Orders lock in ${t} · Queue buys/sells now, they fill at the 21:00 UTC open`, tone: 'amber' });
      } else {
        setHaltBanner({ text: `PRE-MARKET LOCKED: Queued orders are set · Market opens in ${t}`, tone: 'red' });
      }
    };
    update();
    const interval = setInterval(update, 15000);
    return () => clearInterval(interval);
  }, [halted, manualHalt, haltReason]);

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
  const scheduleText = `Weekly halt: Thu 13:00–21:00 UTC · Pre-market orders: Thu 20:30–20:55 UTC`;

  const preMarketTone = haltBanner?.tone === 'amber';

  return (
    <div className={`w-full overflow-hidden ${halted
      ? (preMarketTone ? 'bg-amber-700/80 border-b border-amber-600' : 'bg-red-900/80 border-b border-red-700')
      : gracePeriod
        ? 'bg-amber-700/80 border-b border-amber-600'
        : darkMode ? 'bg-zinc-800 border-b border-zinc-700' : 'bg-slate-100 border-b border-slate-200'
    }`} style={{ height: '32px' }}>
      {halted ? (
        <div className="w-full flex items-center justify-center h-full px-2">
          <span className={`text-xs font-bold tracking-wide text-center truncate ${preMarketTone ? 'text-amber-100' : 'text-red-200'}`}>
            {haltBanner?.text || 'MARKET CLOSED'}
          </span>
        </div>
      ) : gracePeriod ? (
        <div className="w-full flex items-center justify-center h-full px-2">
          <span className="text-amber-100 text-xs font-bold tracking-wide text-center truncate">
            Market just opened. Auto-liquidations paused until {Math.floor((HALT_END_MINUTE + GRACE_PERIOD_MINUTES) / 60)}:{String((HALT_END_MINUTE + GRACE_PERIOD_MINUTES) % 60).padStart(2, '0')} UTC
          </span>
        </div>
      ) : (
      <div
        className="ticker-scroll-container flex items-center h-full whitespace-nowrap ticker-scroll-active w-max"
        onMouseEnter={e => { e.currentTarget.style.animationPlayState = 'paused'; }}
        onMouseLeave={e => { e.currentTarget.style.animationPlayState = 'running'; }}
        onClick={e => {
          const el = e.currentTarget;
          el.style.animationPlayState = el.style.animationPlayState === 'paused' ? 'running' : 'paused';
        }}
      >
          <>
            <span className={`text-xs font-medium px-4 ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
              <a
                href="https://discord.gg/yxw94uNrYv"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                onClick={e => e.stopPropagation()}
              >
                💬 Join the Discord!
              </a>
              <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> · </span>
              {movers.map((m, i) => (
                <span key={m.ticker}>
                  {i > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> · </span>}
                  <span className={darkMode ? 'text-zinc-400' : 'text-slate-600'}>{m.ticker}</span>
                  {' '}
                  <span className={darkMode ? 'text-zinc-200' : 'text-slate-700'}>${m.price.toFixed(2)}</span>
                  {' '}
                  <span className={m.change >= 0
                    ? (colorBlindMode ? 'text-teal-500' : 'text-emerald-500')
                    : (colorBlindMode ? 'text-purple-500' : 'text-red-500')
                  }>
                    {m.change >= 0 ? '▲' : '▼'}{m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                  </span>
                </span>
              ))}
              {movers.length > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> | </span>}
              <span className={darkMode ? 'text-zinc-500' : 'text-slate-500'}>{scheduleText}</span>
            </span>
            {/* Duplicate for seamless loop */}
            <span className={`text-xs font-medium px-4 ${darkMode ? 'text-zinc-300' : 'text-slate-600'}`}>
              <a
                href="https://discord.gg/yxw94uNrYv"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                onClick={e => e.stopPropagation()}
              >
                💬 Join the Discord!
              </a>
              <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> · </span>
              {movers.map((m, i) => (
                <span key={m.ticker}>
                  {i > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> · </span>}
                  <span className={darkMode ? 'text-zinc-400' : 'text-slate-600'}>{m.ticker}</span>
                  {' '}
                  <span className={darkMode ? 'text-zinc-200' : 'text-slate-700'}>${m.price.toFixed(2)}</span>
                  {' '}
                  <span className={m.change >= 0
                    ? (colorBlindMode ? 'text-teal-500' : 'text-emerald-500')
                    : (colorBlindMode ? 'text-purple-500' : 'text-red-500')
                  }>
                    {m.change >= 0 ? '▲' : '▼'}{m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                  </span>
                </span>
              ))}
              {movers.length > 0 && <span className={darkMode ? 'text-zinc-600' : 'text-slate-300'}> | </span>}
              <span className={darkMode ? 'text-zinc-500' : 'text-slate-500'}>{scheduleText}</span>
            </span>
          </>
      </div>
        )}
    </div>
  );
};

export default MarketTicker;
