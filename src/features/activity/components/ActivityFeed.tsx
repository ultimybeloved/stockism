import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../../../context/AppContext';
import { themeClasses } from '../../../utils/theme';
import { CHARACTER_MAP } from '../../../characters';
import { useMarketActivity, type ActivityEntry } from '../hooks/useMarketActivity';
import '../activity.css';

const tint = { background: 'color-mix(in srgb, currentColor 14%, transparent)' };

/** Re-render once a minute so the rough ages move. */
function useMinute() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const age = (at: number, now: number) => {
  const m = Math.max(1, Math.round((now - at) / 60000 / 5) * 5);
  return m >= 60 ? `${Math.floor(m / 60)}h ago` : `${m}m ago`;
};

function Row({ e, now, onOpen }: { e: ActivityEntry; now: number; onOpen: (t: string) => void }) {
  const { getColorBlindColors } = useSession();
  const color = getColorBlindColors(e.side === 'buy').text;
  const name = CHARACTER_MAP[e.ticker]?.name;
  return (
    <li className="act-enter">
      <button
        onClick={() => onOpen(e.ticker)}
        className={`act-row act-sheen ${color} w-full flex items-center gap-2.5 px-3 py-2 text-left rounded-sm transition-colors light:hover:bg-amber-50 dark:hover:bg-zinc-800/60`}
      >
        <span className="act-pop shrink-0 w-6 h-6 rounded-sm grid place-items-center text-xs font-bold" style={tint}>
          {e.side === 'buy' ? '▲' : '▼'}
        </span>
        <span className="min-w-0 flex-1 truncate text-sm light:text-zinc-700 dark:text-zinc-300">
          Someone {e.side === 'buy' ? 'bought' : 'sold'}{' '}
          <span className="font-semibold light:text-zinc-900 dark:text-zinc-100">${e.ticker}</span>
          {name && <span className={`ml-1.5 text-xs ${themeClasses.mutedClass}`}>{name}</span>}
        </span>
        {e.count > 1 && (
          <span
            key={e.bump}
            className={`act-bump shrink-0 px-1.5 rounded-sm text-xs font-bold tabular-nums ${color}`}
            style={tint}
          >
            ×{e.count}
          </span>
        )}
        <span className={`shrink-0 w-12 text-right text-xs tabular-nums ${themeClasses.mutedClass}`}>
          {age(e.at, now)}
        </span>
      </button>
    </li>
  );
}

interface ActivityFeedProps {
  /** One stock's activity instead of the whole market. */
  ticker?: string;
  /** Rows shown before "Show more". */
  limit?: number;
  className?: string;
}

/**
 * Market activity: buys and sells with no name and no size, running about 20
 * minutes behind and mixed with bot trades, so it shows nothing the chart
 * doesn't. New entries land one at a time; a repeat on the top row bumps its
 * counter instead of adding a row.
 */
export default function ActivityFeed({ ticker, limit = 8, className = '' }: ActivityFeedProps) {
  const { entries, lastHour } = useMarketActivity(ticker);
  const { getColorBlindColors } = useSession();
  const { cardClass, mutedClass } = themeClasses;
  const navigate = useNavigate();
  const now = useMinute();
  const [more, setMore] = useState(false);

  // The live dot rings once each time something lands.
  const [tick, setTick] = useState(0);
  const last = useRef('');
  const head = entries[0] ? `${entries[0].id}:${entries[0].bump}` : '';
  useEffect(() => {
    if (head && head !== last.current) {
      last.current = head;
      setTick((t) => t + 1);
    }
  }, [head]);

  const total = lastHour.buys + lastHour.sells;
  const buyPct = total ? (lastHour.buys / total) * 100 : 50;
  const up = getColorBlindColors(true).text;
  const down = getColorBlindColors(false).text;
  const shown = entries.slice(0, more ? limit * 3 : limit);

  return (
    <section className={`${cardClass} border rounded-sm mb-4 ${className}`}>
      <header className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between">
          <h2 className={`text-xs font-semibold uppercase tracking-wide ${mutedClass}`}>
            {ticker ? `Activity on $${ticker}` : 'Market activity'}
          </h2>
          <span className={`flex items-center gap-1.5 text-xs ${mutedClass}`}>
            <span
              key={tick}
              className={`act-dot ${tick ? 'act-tick' : ''} w-1.5 h-1.5 rounded-full bg-current ${up}`}
            />
            Live, 20 min behind
          </span>
        </div>
        {/* Buys against sells over the last hour of the feed. */}
        <div className="mt-2.5">
          <div className="flex h-1.5 rounded-full overflow-hidden light:bg-zinc-200 dark:bg-zinc-800">
            <div className={`act-bar bg-current ${up}`} style={{ width: `${buyPct}%` }} />
            <div className={`act-bar bg-current ${down} opacity-80`} style={{ width: `${100 - buyPct}%` }} />
          </div>
          <div className="mt-1 flex justify-between text-[11px] tabular-nums">
            <span className={up}>{lastHour.buys} buys</span>
            <span className={mutedClass}>last hour</span>
            <span className={down}>{lastHour.sells} sells</span>
          </div>
        </div>
      </header>

      {shown.length ? (
        <ul className="px-1 pb-1">
          {shown.map((e) => (
            <Row key={e.id} e={e} now={now} onOpen={(t) => navigate(`/stock/${t}`)} />
          ))}
        </ul>
      ) : (
        <p className={`px-4 pb-4 text-sm ${mutedClass}`}>Nothing yet. Trades show up here about 20 minutes later.</p>
      )}

      <footer
        className={`px-4 py-2 border-t flex items-center justify-between text-[11px] ${mutedClass} light:border-amber-200 dark:border-zinc-800`}
      >
        <span>No names or sizes. Bot trades included.</span>
        {entries.length > limit && (
          <button onClick={() => setMore((m) => !m)} className="text-orange-500 hover:underline">
            {more ? 'Show less' : 'Show more'}
          </button>
        )}
      </footer>
    </section>
  );
}
