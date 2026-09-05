import { CREWS, CREW_MAP } from '../../crews';
import { GENERATIONS, GENERATION_FILTER_ALL, GENERATION_FILTER_UNASSIGNED } from '../../constants/generations';
import { STATUSES } from '../../constants/statuses';
import { CREW_FILTER_ALL } from '../../utils/marketFilters';

// Crew, generation and status, in one collapsible panel.
//
// They used to be two unbounded rows of pills stacked above the grid, which had
// grown to ten crews wrapping onto two lines with a third row on the way for
// status. Every crew or generation added made the page taller before you could
// see a single stock. Folding them away keeps that cost flat no matter how many
// get added later, and the active count means a hidden filter is never a
// mystery.
const MarketFilterPanel = ({
  filters, setFilter, userData, darkMode, chipClass, mutedClass, textClass,
}) => {
  const pill = (isActive, activeClass = 'bg-orange-600 text-white') =>
    `px-2.5 py-1 text-xs rounded-full font-semibold transition-colors ${isActive ? activeClass : chipClass}`;

  const toggleStatus = (id) => {
    const hidden = filters.statusHidden;
    setFilter('statusHidden', hidden.includes(id)
      ? hidden.filter((s) => s !== id)
      : [...hidden, id]);
  };

  const group = (label, children) => (
    <div className="mb-3 last:mb-0">
      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1.5 ${mutedClass}`}>{label}</p>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );

  return (
    <div className={`rounded-sm border p-3 mb-4 ${darkMode ? 'border-zinc-800 bg-zinc-900/40' : 'border-slate-200 bg-slate-50'}`}>
      {group('Crew', (
        <>
          <button onClick={() => setFilter('crew', CREW_FILTER_ALL)}
            className={pill(filters.crew === CREW_FILTER_ALL)}>All</button>
          {userData?.crew && (
            <button onClick={() => setFilter('crew', userData.crew)}
              className={pill(filters.crew === userData.crew)}
              style={filters.crew === userData.crew
                ? { backgroundColor: CREW_MAP[userData.crew]?.color || '#f97316' } : {}}>
              My Crew
            </button>
          )}
          {Object.values(CREWS).map((crew) => (
            <button key={crew.id} onClick={() => setFilter('crew', crew.id)}
              className={`${pill(filters.crew === crew.id)} inline-flex items-center gap-1`}
              style={filters.crew === crew.id ? {
                backgroundColor: crew.color,
                color: ['#FFFFFF', '#f3c404', '#f3c803'].includes(crew.color) ? '#000' : '#fff',
              } : {}}>
              {crew.icon
                ? <img src={crew.icon} alt="" className="w-3.5 h-3.5 rounded-full object-cover" />
                : <span>{crew.emblem}</span>}
              <span>{crew.name}</span>
            </button>
          ))}
        </>
      ))}

      {group('Generation', (
        <>
          <button onClick={() => setFilter('generation', GENERATION_FILTER_ALL)}
            className={pill(filters.generation === GENERATION_FILTER_ALL)}>All</button>
          {GENERATIONS.map((gen) => (
            <button key={gen.id} onClick={() => setFilter('generation', gen.id)}
              className={pill(filters.generation === gen.id, 'bg-sky-600 text-white')}>
              {gen.label}
            </button>
          ))}
          <button onClick={() => setFilter('generation', GENERATION_FILTER_UNASSIGNED)}
            className={pill(filters.generation === GENERATION_FILTER_UNASSIGNED, 'bg-slate-600 text-white')}>
            Unassigned
          </button>
        </>
      ))}

      {/* Shown as what is VISIBLE rather than what is hidden: "hide the dead" is
          the common intent, but a row of un-ticked boxes reads as nothing being
          on. Lit means showing. */}
      {group('Showing', (
        <>
          {STATUSES.map((s) => {
            const shown = !filters.statusHidden.includes(s.id);
            return (
              <button key={s.id} onClick={() => toggleStatus(s.id)} title={s.hint}
                className={`${pill(shown, 'bg-emerald-700 text-white')} ${shown ? '' : 'line-through opacity-60'}`}>
                {s.badge && <span className="mr-1">{s.badge}</span>}{s.label}
              </button>
            );
          })}
          <span className={`text-[10px] self-center ml-1 ${mutedClass}`}>
            Funds are never hidden by this
          </span>
        </>
      ))}

      <p className={`text-[10px] mt-2 ${mutedClass}`}>
        <span className={textClass}>Tip:</span> filters are in the address bar, so this view can be linked or bookmarked.
      </p>
    </div>
  );
};

export default MarketFilterPanel;
