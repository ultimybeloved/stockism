import { useEffect, useState } from 'react';
import { getSeasonStandingsFunction } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { SEASON_TIERS, SEASON_TIER_MAP, seasonLabel, seasonRulesFor, seasonTierRule } from '../../constants/seasons';

// Season standings, ranked on how far ahead of the market each player is with
// free money removed. Server-cached, so this is one document read per load.
//
// Banked tiers show solid. Platinum and Diamond aren't decided until the season
// ends, so they show dashed, as where each would land if it ended now.
const SeasonBoard = () => {
  const { darkMode, user } = useAppContext();
  const { textClass, mutedClass } = getThemeClasses(darkMode);
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading');

  useEffect(() => {
    getSeasonStandingsFunction({})
      .then(({ data: d }) => { setData(d); setState('ready'); })
      .catch((err) => { console.error('Season standings failed:', err); setState('error'); });
  }, []);

  if (state === 'loading') return <p className={`text-center py-8 ${mutedClass}`}>Loading season...</p>;
  if (state === 'error') return <p className="text-center py-8 text-red-400">Could not load the season board.</p>;
  if (!data?.active) {
    return (
      <p className={`text-center py-8 ${mutedClass}`}>
        No season is running right now. The next one starts with the next arc.
      </p>
    );
  }

  const fmt = (v) => `${v > 0 ? '+' : ''}${(v || 0).toFixed(1)}%`;
  const rules = seasonRulesFor(data);

  return (
    <div>
      <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-zinc-900' : 'bg-amber-50'}`}>
        <h3 className={`font-semibold ${textClass}`}>
          {seasonLabel(data)} · {data.name}
        </h3>
        <p className={`text-xs ${mutedClass}`}>
          Week {data.weeks} · {data.totalScored} players
          {typeof data.marketPercent === 'number' && ` · market ${fmt(data.marketPercent)} this season`}
        </p>
        <ul className="mt-2 space-y-1">
          {SEASON_TIERS.map((t) => (
            <li key={t.id} className="text-xs">
              <span className="font-semibold" style={{ color: t.color }}>{t.name}</span>{' '}
              <span className={mutedClass}>{seasonTierRule(t.id, rules)}</span>
            </li>
          ))}
        </ul>
        <p className={`text-xs ${mutedClass} mt-2`}>
          Ranked on how far ahead of the market you are. Free stock and bonuses don't count.
          Dashed badges show where Platinum and Diamond would land if the season ended now.
        </p>
      </div>

      <div className={`flex items-center gap-2 px-2 pb-1 text-[10px] uppercase tracking-wide ${mutedClass}`}>
        <span className="flex-1" />
        <span className="w-16 text-right">Return</span>
        <span className="w-20 text-right">vs market</span>
      </div>

      <div className="space-y-1">
        {data.entries.map((e, i) => {
          const projected = e.projectedTier ? SEASON_TIER_MAP[e.projectedTier] : null;
          const badge = projected || (e.tier ? SEASON_TIER_MAP[e.tier] : null);
          const excess = e.excess ?? e.returnPercent;
          const isMe = user && e.userId === user.uid;
          return (
            <div
              key={e.userId}
              className={`flex items-center gap-2 p-2 rounded-sm text-sm ${
                isMe
                  ? (darkMode ? 'bg-orange-900/30 border border-orange-700' : 'bg-orange-100 border border-orange-300')
                  : (darkMode ? 'bg-zinc-900' : 'bg-white')
              }`}
            >
              <span className={`w-8 text-right font-semibold ${mutedClass}`}>{i + 1}</span>
              <span className={`flex-1 truncate ${textClass}`}>{e.displayName}</span>
              {badge && (
                <span
                  className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold shrink-0 ${projected ? 'border border-dashed' : ''}`}
                  style={projected
                    ? { borderColor: badge.color, color: badge.color }
                    : { backgroundColor: `${badge.color}22`, color: badge.color }}
                  title={projected ? `${badge.name} if the season ended now` : `${badge.name} secured`}
                >
                  {badge.name}
                </span>
              )}
              <span className={`w-16 text-right text-xs tabular-nums ${mutedClass}`}>
                {fmt(e.returnPercent)}
              </span>
              <span className={`w-20 text-right font-semibold tabular-nums ${
                excess >= 0 ? 'text-green-500' : 'text-red-400'
              }`}>
                {fmt(excess)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SeasonBoard;
