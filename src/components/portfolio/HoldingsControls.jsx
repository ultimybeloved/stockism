import { getThemeClasses } from '../../utils/theme';
import { HOLDING_SORTS } from './shared';

// Search + sort controls for the long-positions list. Clicking the active sort
// toggles its direction. Presentational — all state lives in the parent.
const HoldingsControls = ({ darkMode, search, setSearch, sortKey, sortDir, onSortChange }) => {
  const { mutedClass } = getThemeClasses(darkMode);

  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search holdings..."
        className={`flex-1 px-3 py-1.5 text-sm rounded-sm border focus:outline-none focus:border-orange-500 ${
          darkMode
            ? 'bg-zinc-900 border-zinc-700 text-zinc-100 placeholder-zinc-500'
            : 'bg-white border-amber-200 text-slate-900 placeholder-slate-400'
        }`}
      />
      <div className="flex items-center gap-1">
        <span className={`text-xs ${mutedClass} mr-1`}>Sort</span>
        {HOLDING_SORTS.map((s) => {
          const active = sortKey === s.key;
          return (
            <button
              key={s.key}
              onClick={() => onSortChange(s.key)}
              className={`text-xs px-2.5 py-1 rounded-full font-semibold whitespace-nowrap transition-colors ${
                active
                  ? 'bg-orange-600 text-white'
                  : darkMode ? 'text-zinc-400 hover:bg-zinc-800' : 'text-slate-500 hover:bg-zinc-100'
              }`}
            >
              {s.label}{active && (sortDir === 'asc' ? ' ▲' : ' ▼')}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default HoldingsControls;
