import { useEffect, useState } from 'react';
import { getSeasonStandingsFunction } from '../../firebase';
import { useAppContext } from '../../context/AppContext';
import { getThemeClasses } from '../../utils/theme';
import { SEASON_TIER_MAP, seasonTierTarget } from '../../constants/seasons';

// Season standings. Ranked by return net of granted value, so it measures
// trading rather than who collected the most free stuff. Server-cached, so this
// is one document read per load.
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

  const fmt = (v) => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`;

  return (
    <div>
      <div className={`p-3 rounded-sm mb-3 ${darkMode ? 'bg-zinc-900' : 'bg-amber-50'}`}>
        <h3 className={`font-semibold ${textClass}`}>
          Season {data.number} · {data.name}
        </h3>
        <p className={`text-xs ${mutedClass}`}>
          Week {data.weeks} · {data.totalScored} players · ranked on trading only, free stock and
          bonuses don't count
        </p>
        <div className="flex gap-3 flex-wrap mt-2">
          {['silver', 'gold', 'platinum', 'diamond'].map((id) => {
            const meta = SEASON_TIER_MAP[id];
            const rate = data.thresholds?.[id];
            if (rate === undefined) return null;
            return (
              <span key={id} className="text-xs font-semibold" style={{ color: meta.color }}>
                {meta.name} {fmt(seasonTierTarget(rate, data.weeks))}
              </span>
            );
          })}
        </div>
      </div>

      <div className="space-y-1">
        {data.entries.map((e, i) => {
          const meta = e.tier ? SEASON_TIER_MAP[e.tier] : null;
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
              {meta && (
                <span
                  className="px-1.5 py-0.5 rounded-sm text-[10px] font-bold shrink-0"
                  style={{ backgroundColor: `${meta.color}22`, color: meta.color }}
                >
                  {meta.name}
                </span>
              )}
              <span className={`w-20 text-right font-semibold tabular-nums ${
                e.returnPercent >= 0 ? 'text-green-500' : 'text-red-400'
              }`}>
                {fmt(e.returnPercent)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SeasonBoard;
