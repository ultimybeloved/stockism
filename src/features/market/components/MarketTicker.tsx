import { useMemo, useState, useEffect } from 'react';
import {
  isWeeklyHalt,
  formatCountdown,
  isMarketOpenGracePeriod,
  getWeeklyHaltPhase,
  HALT_END_MINUTE,
  GRACE_PERIOD_MINUTES,
} from '../../../utils/marketHours';
import { marketTimes, localDailyTime } from '../../../utils/localTime';
import { useSession, useMarket } from '../../../context/AppContext';

const MarketTicker = () => {
  const { userData } = useSession();
  const { prices, priceHistory, marketData } = useMarket();
  const colorBlindMode = userData?.colorBlindMode || false;
  const [haltBanner, setHaltBanner] = useState<{ text: string; tone: 'red' | 'amber' } | null>(null);
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
        setHaltBanner({
          text: `MARKET CLOSED: Chapter review · Pre-market opens in ${t}, queue orders early for the ${marketTimes().reopenTime} open`,
          tone: 'red',
        });
      } else if (p.phase === 'queue') {
        setHaltBanner({
          text: `PRE-MARKET OPEN: Orders lock in ${t} · Queue buys/sells now, they fill at the ${marketTimes().reopenTime} open`,
          tone: 'amber',
        });
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
    const entries = Object.entries(prices)
      .map(([ticker, price]) => {
        const history = priceHistory[ticker] || [];
        if (history.length === 0) return null;
        let price24hAgo = history[0]!.price;
        for (let i = history.length - 1; i >= 0; i--) {
          const point = history[i]!;
          if (point.timestamp <= dayAgo) {
            price24hAgo = point.price;
            break;
          }
        }
        const change = price24hAgo > 0 ? ((price - price24hAgo) / price24hAgo) * 100 : 0;
        return { ticker, price, change };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);

    entries.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    return entries.slice(0, 8);
  }, [prices, priceHistory]);

  // Schedule info
  const times = marketTimes();
  const scheduleText = `Weekly halt: ${times.halt} · Pre-market orders: ${times.preMarket}`;

  const preMarketTone = haltBanner?.tone === 'amber';

  return (
    <div
      className={`w-full overflow-hidden ${
        halted
          ? preMarketTone
            ? 'bg-amber-700/80 border-b border-amber-600'
            : 'bg-red-900/80 border-b border-red-700'
          : gracePeriod
            ? 'bg-amber-700/80 border-b border-amber-600'
            : 'light:bg-slate-100 light:border-b light:border-slate-200 dark:bg-zinc-800 dark:border-b dark:border-zinc-700'
      }`}
      style={{ height: '32px' }}
    >
      {halted ? (
        <div className="w-full flex items-center justify-center h-full px-2">
          <span
            className={`text-xs font-bold tracking-wide text-center truncate ${preMarketTone ? 'text-amber-100' : 'text-red-200'}`}
          >
            {haltBanner?.text || 'MARKET CLOSED'}
          </span>
        </div>
      ) : gracePeriod ? (
        <div className="w-full flex items-center justify-center h-full px-2">
          <span className="text-amber-100 text-xs font-bold tracking-wide text-center truncate">
            Market just opened. Auto-liquidations paused until {localDailyTime(HALT_END_MINUTE + GRACE_PERIOD_MINUTES)}
          </span>
        </div>
      ) : (
        <div
          className="ticker-scroll-container flex items-center h-full whitespace-nowrap ticker-scroll-active w-max"
          onMouseEnter={(e) => {
            e.currentTarget.style.animationPlayState = 'paused';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.animationPlayState = 'running';
          }}
          onClick={(e) => {
            const el = e.currentTarget;
            el.style.animationPlayState = el.style.animationPlayState === 'paused' ? 'running' : 'paused';
          }}
        >
          <>
            <span className="text-xs font-medium px-4 light:text-slate-600 dark:text-zinc-300">
              <a
                href="https://discord.gg/hpVm8nQMvY"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                💬 Join the Discord!
              </a>
              <span className="light:text-slate-300 dark:text-zinc-600"> · </span>
              {movers.map((m, i) => (
                <span key={m.ticker}>
                  {i > 0 && <span className="light:text-slate-300 dark:text-zinc-600"> · </span>}
                  <span className="light:text-slate-600 dark:text-zinc-400">{m.ticker}</span>{' '}
                  <span className="light:text-slate-700 dark:text-zinc-200">${m.price.toFixed(2)}</span>{' '}
                  <span
                    className={
                      m.change >= 0
                        ? colorBlindMode
                          ? 'text-teal-500'
                          : 'text-emerald-500'
                        : colorBlindMode
                          ? 'text-purple-500'
                          : 'text-red-500'
                    }
                  >
                    {m.change >= 0 ? '▲' : '▼'}
                    {m.change >= 0 ? '+' : ''}
                    {m.change.toFixed(1)}%
                  </span>
                </span>
              ))}
              {movers.length > 0 && <span className="light:text-slate-300 dark:text-zinc-600"> | </span>}
              <span className="light:text-slate-500 dark:text-zinc-500">{scheduleText}</span>
            </span>
            {/* Duplicate for seamless loop */}
            <span className="text-xs font-medium px-4 light:text-slate-600 dark:text-zinc-300">
              <a
                href="https://discord.gg/hpVm8nQMvY"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-indigo-400 hover:text-indigo-300 font-semibold transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                💬 Join the Discord!
              </a>
              <span className="light:text-slate-300 dark:text-zinc-600"> · </span>
              {movers.map((m, i) => (
                <span key={m.ticker}>
                  {i > 0 && <span className="light:text-slate-300 dark:text-zinc-600"> · </span>}
                  <span className="light:text-slate-600 dark:text-zinc-400">{m.ticker}</span>{' '}
                  <span className="light:text-slate-700 dark:text-zinc-200">${m.price.toFixed(2)}</span>{' '}
                  <span
                    className={
                      m.change >= 0
                        ? colorBlindMode
                          ? 'text-teal-500'
                          : 'text-emerald-500'
                        : colorBlindMode
                          ? 'text-purple-500'
                          : 'text-red-500'
                    }
                  >
                    {m.change >= 0 ? '▲' : '▼'}
                    {m.change >= 0 ? '+' : ''}
                    {m.change.toFixed(1)}%
                  </span>
                </span>
              ))}
              {movers.length > 0 && <span className="light:text-slate-300 dark:text-zinc-600"> | </span>}
              <span className="light:text-slate-500 dark:text-zinc-500">{scheduleText}</span>
            </span>
          </>
        </div>
      )}
    </div>
  );
};

export default MarketTicker;
