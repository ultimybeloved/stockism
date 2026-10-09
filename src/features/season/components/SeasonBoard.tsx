import { useEffect, useState } from 'react';
import { getSeasonStandingsFunction } from '../../../api/callables';
import { useSession } from '../../../context/AppContext';

import { themeClasses } from '../../../utils/theme';
import {
  SEASON_TIERS,
  SEASON_TIER_MAP,
  seasonLabel,
  seasonRulesFor,
  seasonTierRule,
  tierGivesTitle,
  divisionRange,
} from '../../../constants/seasons';
import type { SeasonStandingsResponse } from '../../../api/types';

// Season standings, ranked on how far ahead of the market each player is with
// free money removed. Server-cached, so this is one document read per load.
//
// One number per row, the player's return. Green means ahead of the market. For
// everyone pinned at the start, return and "ahead of the market" rank the same,
// so a second column only repeated the first with the market subtracted.
//
// One tab per size division. Platinum and Diamond are ranked within a division,
// so that's the race that matters; it opens on the viewer's own.
//
// Banked tiers (Bronze) show solid. Everything above is decided when the season
// ends, so it shows dashed, as where each player would land if it ended now.
const SeasonBoard = () => {
  const { user } = useSession();
  const { textClass, mutedClass } = themeClasses;
  const [data, setData] = useState<SeasonStandingsResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [picked, setPicked] = useState<string | null>(null);

  useEffect(() => {
    getSeasonStandingsFunction({})
      .then(({ data: d }) => {
        setData(d);
        setState('ready');
      })
      .catch((err) => {
        console.error('Season standings failed:', err);
        setState('error');
      });
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

  const fmt = (v: number | undefined) => `${(v ?? 0) > 0 ? '+' : ''}${(v || 0).toFixed(1)}%`;
  const rules = seasonRulesFor(data);
  const divisions = data.divisions || [];
  const mine = user && data.entries.find((e) => e.userId === user.uid)?.division;
  const tab = picked || mine || divisions.find((d) => d.players > 0)?.id || divisions[0]?.id;
  const current = divisions.find((d) => d.id === tab);
  const rows = data.entries.filter((e) => e.division === tab);

  return (
    <div>
      <div className="p-3 rounded-sm mb-3 light:bg-amber-50 dark:bg-zinc-900">
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
              <span className="font-semibold" style={{ color: t.color }}>
                {t.name}
              </span>{' '}
              <span className={mutedClass}>{seasonTierRule(t.id, rules)}</span>
              {!tierGivesTitle(t.id, rules) && <span className={mutedClass}> No title.</span>}
            </li>
          ))}
        </ul>
        <p className={`text-xs ${mutedClass} mt-2`}>
          Ranked on how far ahead of the market you are, against players who started the season about your size. Green
          means you're beating it. Free stock and bonuses don't count, and holdings count at what they'd sell for, after
          your own sale moves the price. Dashed badges show where Platinum and Diamond would land if the season ended
          now.
        </p>
      </div>

      <div className="flex gap-1 flex-wrap mb-2">
        {divisions.map((d) => (
          <button
            key={d.id}
            onClick={() => setPicked(d.id)}
            className={`px-2 py-1 rounded-sm text-xs font-semibold ${
              d.id === tab
                ? 'bg-orange-600 text-white'
                : 'light:bg-white light:text-slate-700 dark:bg-zinc-900 dark:text-zinc-300'
            }`}
          >
            {d.label}
            {d.id === mine ? ' (you)' : ''}
          </button>
        ))}
      </div>
      {current && (
        <p className={`text-xs ${mutedClass} px-2 pb-2`}>
          {divisionRange(current)} at the start · {current.players} players · {current.platinum} Platinum and{' '}
          {current.diamond} Diamond {current.diamond === 1 ? 'place' : 'places'}
        </p>
      )}

      <div className={`flex items-center gap-2 px-2 pb-1 text-[10px] uppercase tracking-wide ${mutedClass}`}>
        <span className="flex-1" />
        <span className="w-20 text-right">Return</span>
      </div>

      <div className="space-y-1">
        {rows.length === 0 && <p className={`text-center py-4 text-sm ${mutedClass}`}>Nobody in this division yet.</p>}
        {rows.map((e, i) => {
          const projected = e.projectedTier ? SEASON_TIER_MAP[e.projectedTier] : null;
          const badge = projected || (e.tier ? SEASON_TIER_MAP[e.tier] : null);
          const excess = e.excess ?? e.returnPercent;
          const isMe = user && e.userId === user.uid;
          return (
            <div
              key={e.userId}
              className={`flex items-center gap-2 p-2 rounded-sm text-sm ${
                isMe
                  ? 'light:bg-orange-100 light:border light:border-orange-300 dark:bg-orange-900/30 dark:border dark:border-orange-700'
                  : 'light:bg-white dark:bg-zinc-900'
              }`}
            >
              <span className={`w-8 text-right font-semibold ${mutedClass}`}>{i + 1}</span>
              <span className={`flex-1 truncate ${textClass}`}>{e.displayName}</span>
              {badge && (
                <span
                  className={`px-1.5 py-0.5 rounded-sm text-[10px] font-bold shrink-0 ${projected ? 'border border-dashed' : ''}`}
                  style={
                    projected
                      ? { borderColor: badge.color, color: badge.color }
                      : { backgroundColor: `${badge.color}22`, color: badge.color }
                  }
                  title={projected ? `${badge.name} if the season ended now` : `${badge.name} secured`}
                >
                  {badge.name}
                </span>
              )}
              <span
                className={`w-20 text-right font-semibold tabular-nums ${
                  excess >= 0 ? 'text-green-500' : 'text-red-400'
                }`}
                title={`${fmt(excess)} against the market`}
              >
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
