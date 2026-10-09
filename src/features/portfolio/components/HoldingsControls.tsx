import { themeClasses } from '../../../utils/theme';
import { HOLDING_SORTS } from '../utils/shared';

interface HoldingsControlsProps {
  search: string;
  setSearch: (search: string) => void;
  sortKey: string;
  sortDir: 'asc' | 'desc';
  onSortChange: (key: string) => void;
}

// Search + sort controls for the long-positions list. Clicking the active sort
// toggles its direction. Presentational — all state lives in the parent.
const HoldingsControls = ({ search, setSearch, sortKey, sortDir, onSortChange }: HoldingsControlsProps) => {
  const { mutedClass } = themeClasses;

  return (
    <div className="flex flex-col sm:flex-row gap-2 mb-3">
      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search holdings..."
        className="flex-1 px-3 py-1.5 text-sm rounded-sm border focus:outline-none focus:border-orange-500 light:bg-white light:border-amber-200 light:text-slate-900 light:placeholder-slate-400 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 dark:placeholder-zinc-500"
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
                  : 'light:text-slate-500 light:hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {s.label}
              {active && (sortDir === 'asc' ? ' ▲' : ' ▼')}
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default HoldingsControls;
