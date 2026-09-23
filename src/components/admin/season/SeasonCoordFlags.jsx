import { SEASON_REPEAT_COORD_FLAGS } from '../../../constants/seasons';
import { useSeasonCoordFlags } from '../../../hooks/admin/useSeasonCoordFlags';
import CoordProfitPanel from './CoordProfitPanel';

// Players flagged for coordinated trading this season. Repeat cases are marked,
// but nothing happens to anyone until the admin presses the button.
const SeasonCoordFlags = ({ darkMode, textClass, mutedClass, active }) => {
  const { players, loading, busyUid, error, reload, toggleExclusion } = useSeasonCoordFlags(active);
  if (!active) return null;

  const rowClass = darkMode ? 'border-slate-600' : 'border-slate-300';
  const inputClass = `px-2 py-1 rounded border ${
    darkMode ? 'bg-slate-700 border-slate-600 text-white' : 'bg-white border-slate-300 text-slate-900'
  }`;

  return (
    <div className={`mt-3 pt-3 border-t ${rowClass}`}>
      <div className="flex items-center justify-between mb-1">
        <h4 className={`text-sm font-semibold ${textClass}`}>Coordinated trading this season</h4>
        <button onClick={reload} disabled={loading} className={`text-xs underline ${mutedClass} disabled:opacity-50`}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>
      <p className={`text-xs ${mutedClass} mb-2`}>
        Everyone named in a coordinated-pressure alert since the season started. {SEASON_REPEAT_COORD_FLAGS}+ flags
        is marked as a repeat. Excluded players keep Bronze, Silver and Gold but can&apos;t place Platinum or
        Diamond. Only they see it, on their own season card.
      </p>

      {error && <p className="text-xs text-red-500 mb-2">{error}</p>}
      {!loading && !players.length && !error && (
        <p className={`text-xs ${mutedClass}`}>No one has been flagged this season.</p>
      )}

      <ul className="space-y-1">
        {players.map((p) => {
          const repeat = p.flags >= SEASON_REPEAT_COORD_FLAGS;
          return (
            <li key={p.uid} className={`text-xs py-1 border-b ${rowClass}`}>
              <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <span className={`font-semibold ${textClass}`}>{p.name}</span>{' '}
                <span className={repeat ? 'text-red-500 font-semibold' : mutedClass}>
                  {p.flags} flag{p.flags === 1 ? '' : 's'}{repeat ? ' · repeat' : ''}
                </span>
                <div className={`${mutedClass} truncate`}>
                  {p.tickers.map((t) => `$${t}`).join(' ')}
                  {p.partners.length > 0 && ` · with ${p.partners.slice(0, 4).map((x) => `${x.name} (${x.n})`).join(', ')}`}
                </div>
              </div>
              <button
                onClick={() => toggleExclusion(p)}
                disabled={busyUid === p.uid}
                className={`shrink-0 px-2 py-1 rounded font-semibold text-white disabled:opacity-50 ${
                  p.excluded ? 'bg-slate-500 hover:bg-slate-600' : 'bg-red-600 hover:bg-red-700'
                }`}
              >
                {p.excluded ? 'Excluded · undo' : 'Exclude from Plat/Diamond'}
              </button>
              </div>
              <CoordProfitPanel player={p} {...{ textClass, mutedClass, inputClass }} />
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export default SeasonCoordFlags;
