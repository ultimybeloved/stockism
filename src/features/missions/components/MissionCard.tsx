import { Link } from 'react-router-dom';
import { formatCurrency } from '../../../utils/formatters';
import { themeClasses } from '../../../utils/theme';
import type { BoardMission } from '../hooks/useMissionBoard';

// Tailwind needs whole class names, so each accent is spelled out.
const ACCENTS = {
  orange: {
    done: 'border-orange-500 bg-orange-500/10',
    claimed: 'border-orange-500/30 bg-orange-500/5',
    text: 'text-orange-500',
    bar: 'bg-orange-500',
    barIdle: 'bg-amber-500',
    button: 'bg-orange-600 hover:bg-orange-700',
  },
  purple: {
    done: 'border-purple-500 bg-purple-500/10',
    claimed: 'border-purple-500/30 bg-purple-500/5',
    text: 'text-purple-500',
    bar: 'bg-purple-500',
    barIdle: 'bg-purple-400',
    button: 'bg-purple-600 hover:bg-purple-700',
  },
} as const;

// Missions whose bar counts dollars rather than things.
const MONEY_CHECKS = new Set(['SELL_HELD', 'SELL_LOSS', 'COVER_PROFIT']);

// How many qualifying stocks to list before "+N more".
const MAX_PICKS = 8;

const short = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(n % 1000 === 0 ? 0 : 1)}k` : String(n));

export default function MissionCard({
  mission,
  accent,
  onClaim,
  claiming,
  minTrade,
}: {
  mission: BoardMission;
  accent: keyof typeof ACCENTS;
  onClaim: (missionId: string, reward: number) => unknown;
  claiming?: boolean;
  /** Smallest buy that counts, shown with the qualifying stocks. */
  minTrade?: number;
}) {
  const { textClass, mutedClass, borderClass } = themeClasses;
  const a = ACCENTS[accent];
  const money = MONEY_CHECKS.has(mission.checkType);
  const label = (n: number) => (money ? `$${short(n)}` : short(n));
  const pct = Math.min(100, mission.target > 0 ? (mission.progress / mission.target) * 100 : 0);

  return (
    <div className={`p-3 rounded-sm border ${mission.claimed ? a.claimed : mission.complete ? a.done : borderClass}`}>
      <div className="flex justify-between items-start mb-2 gap-2">
        <div>
          <h3 className={`font-semibold ${textClass}`}>{mission.name}</h3>
          <p className={`text-xs ${mutedClass}`}>{mission.description}</p>
        </div>
        <span className={`text-sm font-bold shrink-0 ${mission.complete ? a.text : mutedClass}`}>
          +{formatCurrency(mission.reward)}
        </span>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1 h-2 rounded-full light:bg-slate-200 dark:bg-zinc-800">
          <div
            className={`h-full rounded-full transition-all ${mission.complete ? a.bar : a.barIdle}`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <span className={`text-xs ${mutedClass} w-16 text-right`}>
          {label(mission.progress)}/{label(mission.target)}
        </span>
      </div>
      {mission.note && !mission.claimed && <p className={`text-xs ${mutedClass} mt-1 italic`}>{mission.note}</p>}
      {mission.picks && !mission.complete && (
        <div className="mt-2">
          <p className={`text-xs ${mutedClass}`}>
            {mission.picks.length
              ? `Counts if you buy now${minTrade ? ` ($${Math.round(minTrade).toLocaleString('en-US')}+, and keep it)` : ''}${mission.picksFrom ? `, vs ${mission.picksFrom}` : ''}:`
              : `No stock qualifies right now${mission.picksFrom ? `, vs ${mission.picksFrom}` : ''}. Check back later.`}
          </p>
          {mission.picks.length > 0 && (
            <div className="flex flex-wrap gap-1 mt-1">
              {mission.picks.slice(0, MAX_PICKS).map((p) => (
                <Link
                  key={p.ticker}
                  to={`/stock/${p.ticker}`}
                  className={`text-xs px-1.5 py-0.5 rounded-sm border ${borderClass} ${textClass} hover:border-orange-500`}
                >
                  ${p.ticker}{' '}
                  {p.change !== undefined ? (
                    <span className={p.change < 0 ? 'text-red-500' : 'text-green-500'}>
                      {p.change > 0 ? '+' : ''}
                      {p.change.toFixed(1)}%
                    </span>
                  ) : (
                    p.price !== undefined && <span className={mutedClass}>{formatCurrency(p.price)}</span>
                  )}
                </Link>
              ))}
              {mission.picks.length > MAX_PICKS && (
                <span className={`text-xs px-1 py-0.5 ${mutedClass}`}>+{mission.picks.length - MAX_PICKS} more</span>
              )}
            </div>
          )}
        </div>
      )}

      {mission.complete && !mission.claimed && (
        <button
          onClick={() => onClaim(mission.id, mission.reward)}
          disabled={claiming}
          className={`w-full mt-2 py-1.5 text-sm font-semibold rounded-sm text-white disabled:opacity-50 ${a.button}`}
        >
          {claiming ? 'Claiming...' : 'Claim Reward'}
        </button>
      )}
      {mission.claimed && <p className={`text-xs mt-2 text-center ${a.text}`}>✓ Claimed</p>}
    </div>
  );
}
