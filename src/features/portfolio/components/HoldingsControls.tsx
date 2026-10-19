import { themeClasses } from '../../../utils/theme';
import { HOLDING_SORTS } from '../utils/shared';
import SegmentedSwitch from '../../../shared/components/SegmentedSwitch';

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
        aria-label="Search holdings"
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search holdings..."
        className="flex-1 px-3 py-1.5 text-sm rounded-sm border focus:outline-none focus:border-orange-500 light:bg-white light:border-amber-200 light:text-slate-900 light:placeholder-slate-400 dark:bg-zinc-900 dark:border-zinc-700 dark:text-zinc-100 dark:placeholder-zinc-500"
      />
      {/* Wider screens sort by the table's column headers instead. */}
      <div className="flex md:hidden items-center gap-1">
        <span className={`text-xs ${mutedClass} mr-1`}>Sort</span>
        <SegmentedSwitch
          label="Sort holdings"
          size="md"
          options={HOLDING_SORTS.map(
            (s) => [s.key, sortKey === s.key ? `${s.label} ${sortDir === 'asc' ? '▲' : '▼'}` : s.label] as const,
          )}
          value={sortKey}
          onChange={onSortChange}
        />
      </div>
    </div>
  );
};

export default HoldingsControls;
