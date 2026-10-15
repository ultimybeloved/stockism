// The shareable picture of a week's price changes: risers on the left, drops
// on the right, sized for a Reddit post. Fixed colors rather than the panel's
// terminal theme, so the saved image looks the same whoever saves it.
import { forwardRef } from 'react';
import { weekLabel, type Week, type WeeklyChange } from '../../utils/weeklyChanges';

const price = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`;

interface WeeklyCardProps {
  rows: WeeklyChange[];
  week: Week;
  names: Record<string, string>;
}

const Column = ({
  title,
  rows,
  names,
  max,
  up,
}: {
  title: string;
  rows: WeeklyChange[];
  names: Record<string, string>;
  max: number;
  up: boolean;
}) => {
  const tone = up ? 'text-emerald-400' : 'text-rose-400';
  const pill = up ? 'bg-emerald-500/15 text-emerald-300' : 'bg-rose-500/15 text-rose-300';
  const bar = up ? 'bg-emerald-500/70' : 'bg-rose-500/70';
  return (
    <div className="min-w-0">
      <div className={`flex items-baseline justify-between mb-2 pb-2 border-b border-zinc-800`}>
        <h3 className={`text-sm font-bold uppercase tracking-wider ${tone}`}>
          {up ? '▲' : '▼'} {title}
        </h3>
        <span className="text-xs text-zinc-500">{rows.length}</span>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500 py-2">None this week</p>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.ticker}>
              <div className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-[15px] font-semibold text-zinc-100 truncate">{names[r.ticker] || r.ticker}</div>
                  <div className="text-xs text-zinc-500 tabular-nums">
                    <span className="text-orange-400/90 font-semibold">${r.ticker}</span> · {price(r.from)} →{' '}
                    {price(r.to)}
                  </div>
                </div>
                <span className={`shrink-0 px-2 py-1 rounded text-sm font-bold tabular-nums ${pill}`}>
                  {signed(r.percent)}
                </span>
              </div>
              <div className="mt-1.5 h-1 rounded-full bg-zinc-800">
                <div
                  className={`h-full rounded-full ${bar}`}
                  style={{ width: `${Math.max(3, (Math.abs(r.percent) / max) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const WeeklyCard = forwardRef<HTMLDivElement, WeeklyCardProps>(({ rows, week, names }, ref) => {
  const ups = rows.filter((r) => r.percent > 0).sort((a, b) => b.percent - a.percent);
  const downs = rows.filter((r) => r.percent < 0).sort((a, b) => a.percent - b.percent);
  const max = Math.max(...rows.map((r) => Math.abs(r.percent)), 0.01);
  const top = ups[0];
  const bottom = downs[0];

  const tile = (label: string, value: string, sub?: string, tone = 'text-zinc-100') => (
    <div className="rounded-md border border-zinc-800 bg-zinc-900/70 px-4 py-3 min-w-0">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500 font-semibold">{label}</div>
      <div className={`text-xl font-bold tabular-nums truncate ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-zinc-400 truncate">{sub}</div>}
    </div>
  );

  return (
    <div
      ref={ref}
      className="w-[880px] p-8 text-zinc-100 bg-zinc-950"
      style={{
        fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        backgroundImage: 'radial-gradient(ellipse at top right, rgba(234,88,12,0.18), transparent 55%)',
      }}
    >
      <div className="flex items-center justify-between gap-6 mb-6">
        <img src="/stockism logo.png" alt="Stockism" className="h-16 w-auto" />
        <div className="text-right">
          <div className="text-xs font-bold uppercase tracking-[0.2em] text-orange-400">Weekly price changes</div>
          <div className="text-2xl font-bold">{weekLabel(week)}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-6">
        {tile('Stocks changed', String(rows.length), `${ups.length} up, ${downs.length} down`)}
        {top
          ? tile(
              'Biggest rise',
              signed(top.percent),
              `${names[top.ticker] || top.ticker} ($${top.ticker})`,
              'text-emerald-400',
            )
          : tile('Biggest rise', '-')}
        {bottom
          ? tile(
              'Biggest drop',
              signed(bottom.percent),
              `${names[bottom.ticker] || bottom.ticker} ($${bottom.ticker})`,
              'text-rose-400',
            )
          : tile('Biggest drop', '-')}
      </div>

      <div className="grid grid-cols-2 gap-8">
        <Column title="Up" rows={ups} names={names} max={max} up />
        <Column title="Down" rows={downs} names={names} max={max} up={false} />
      </div>

      <div className="mt-7 pt-4 border-t border-zinc-800 flex items-center justify-between text-xs text-zinc-500">
        <span>Set by the Stockism team. Totals include moves from linked stocks.</span>
        <span className="font-semibold text-orange-400">stockism.app</span>
      </div>
    </div>
  );
});

WeeklyCard.displayName = 'WeeklyCard';

export default WeeklyCard;
