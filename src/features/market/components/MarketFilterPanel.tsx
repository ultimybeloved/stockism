import { CREWS, CREW_MAP } from '../../../crews';
import { GENERATIONS, GENERATION_FILTER_ALL, GENERATION_FILTER_UNASSIGNED } from '../../../constants/generations';
import { STATUSES } from '../../../constants/statuses';
import { CREW_FILTER_ALL } from '../../../utils/marketFilters';
import type { ReactNode } from 'react';
import type { MarketFilters } from '../../../utils/marketFilters';
import type { UserData } from '../../../types';
import PixelIcon from '../../../shared/components/PixelIcon';
import CrewPin from '../../../shared/components/CrewPin';
import ToggleChip from '../../../shared/components/ToggleChip';

interface MarketFilterPanelProps {
  filters: MarketFilters;
  setFilter: <K extends keyof MarketFilters>(key: K, value: MarketFilters[K]) => void;
  userData: UserData | null;
  mutedClass: string;
  textClass: string;
}

// Crew, generation and status, in one collapsible panel.
//
// They used to be two unbounded rows of pills stacked above the grid, which had
// grown to ten crews wrapping onto two lines with a third row on the way for
// status. Every crew or generation added made the page taller before you could
// see a single stock. Folding them away keeps that cost flat no matter how many
// get added later, and the active count means a hidden filter is never a
// mystery.
const MarketFilterPanel = ({ filters, setFilter, userData, mutedClass, textClass }: MarketFilterPanelProps) => {
  const toggleStatus = (id: string) => {
    const hidden = filters.statusHidden;
    setFilter('statusHidden', hidden.includes(id) ? hidden.filter((s) => s !== id) : [...hidden, id]);
  };

  const group = (label: string, children: ReactNode) => (
    <div className="mb-3 last:mb-0">
      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${mutedClass}`}>{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );

  return (
    <div className="rounded-sm border p-3 mb-4 light:border-slate-200 light:bg-slate-50 dark:border-zinc-800 dark:bg-zinc-900/40">
      {group(
        'Crew',
        <>
          <ToggleChip active={filters.crew === CREW_FILTER_ALL} onClick={() => setFilter('crew', CREW_FILTER_ALL)}>
            All
          </ToggleChip>
          {userData?.crew && (
            <ToggleChip
              active={filters.crew === userData.crew}
              accent={CREW_MAP[userData.crew]?.color}
              onClick={() => setFilter('crew', userData.crew as string)}
            >
              My Crew
            </ToggleChip>
          )}
          {Object.values(CREWS).map((crew) => (
            <ToggleChip
              key={crew.id}
              active={filters.crew === crew.id}
              accent={crew.color}
              onClick={() => setFilter('crew', crew.id)}
            >
              {crew.icon ? <CrewPin crew={crew} className="w-3.5 h-3.5" /> : <span>{crew.emblem}</span>}
              <span>{crew.name}</span>
            </ToggleChip>
          ))}
        </>,
      )}

      {group(
        'Generation',
        <>
          <ToggleChip
            active={filters.generation === GENERATION_FILTER_ALL}
            onClick={() => setFilter('generation', GENERATION_FILTER_ALL)}
          >
            All
          </ToggleChip>
          {GENERATIONS.map((gen) => (
            <ToggleChip
              key={gen.id}
              active={filters.generation === gen.id}
              accent="#0284c7"
              onClick={() => setFilter('generation', gen.id)}
            >
              {gen.label}
            </ToggleChip>
          ))}
          <ToggleChip
            active={filters.generation === GENERATION_FILTER_UNASSIGNED}
            accent="#64748b"
            onClick={() => setFilter('generation', GENERATION_FILTER_UNASSIGNED)}
          >
            Unassigned
          </ToggleChip>
        </>,
      )}

      {/* Shown as what is VISIBLE rather than what is hidden: "hide the dead" is
          the common intent, but a row of un-ticked boxes reads as nothing being
          on. Lit means showing. */}
      {group(
        'Showing',
        <>
          {STATUSES.map((s) => {
            const shown = !filters.statusHidden.includes(s.id);
            return (
              <ToggleChip
                key={s.id}
                active={shown}
                accent="#059669"
                onClick={() => toggleStatus(s.id)}
                title={s.hint}
                className={shown ? '' : 'line-through opacity-60'}
              >
                {s.badge && <PixelIcon name={s.badge} className="w-3.5 h-3.5" />}
                {s.label}
              </ToggleChip>
            );
          })}
          <span className={`text-[10px] self-center ml-1 ${mutedClass}`}>Funds are never hidden by this</span>
        </>,
      )}

      <p className={`text-[10px] mt-2 ${mutedClass}`}>
        <span className={textClass}>Tip:</span> filters are in the address bar, so this view can be linked or
        bookmarked.
      </p>
    </div>
  );
};

export default MarketFilterPanel;
