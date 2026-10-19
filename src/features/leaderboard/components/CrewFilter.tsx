import { useEffect, useRef, useState } from 'react';
import { CREWS, CREW_MAP } from '../../../crews';
import CrewPin from '../../../shared/components/CrewPin';
import { useTheme } from '../../../context/AppContext';
import { themeClasses, getReadableCrewColor } from '../../../utils/theme';
import { RailHeading, RailItem } from './BoardNav';

interface CrewFilterProps {
  crewFilter: string;
  setCrewFilter: (crewId: string) => void;
  /** Pointing at a crew warms its board so opening it is instant. */
  onPrefetch?: (crewId: string) => void;
}

const crewList = () => Object.values(CREWS);

/** Desktop: every crew as a list in the left column. */
export const CrewRail = ({ crewFilter, setCrewFilter, onPrefetch }: CrewFilterProps) => (
  <div>
    <RailHeading>Crews</RailHeading>
    <RailItem active={crewFilter === 'ALL'} onClick={() => setCrewFilter('ALL')} onHover={() => onPrefetch?.('ALL')}>
      <span className="w-4 h-4 shrink-0" />
      All players
    </RailItem>
    {crewList().map((crew) => (
      <RailItem
        key={crew.id}
        active={crewFilter === crew.id}
        accent={crew.color}
        onClick={() => setCrewFilter(crew.id)}
        onHover={() => onPrefetch?.(crew.id)}
      >
        <CrewPin crew={crew} className="w-4 h-4 shrink-0" />
        <span className="truncate">{crew.name}</span>
      </RailItem>
    ))}
  </div>
);

/** Phones and tablets: a menu button that opens the crew list. */
export const CrewMenu = ({ crewFilter, setCrewFilter }: CrewFilterProps) => {
  const { cardClass, cardEdgeClass, inputClass, mutedClass } = themeClasses;
  const { darkMode } = useTheme();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  const current = crewFilter === 'ALL' ? null : CREW_MAP[crewFilter];

  useEffect(() => {
    if (!open) return undefined;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', close);
    };
  }, [open]);

  const pick = (id: string) => {
    setCrewFilter(id);
    setOpen(false);
  };

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold rounded-sm border ${inputClass}`}
      >
        {current ? <CrewPin crew={current} className="w-4 h-4 shrink-0" /> : null}
        <span className={`${mutedClass} font-normal`}>Crew:</span>
        <span
          className="truncate"
          style={current ? { color: getReadableCrewColor(current.color, darkMode) } : undefined}
        >
          {current ? current.name : 'All players'}
        </span>
        <span className={`ml-auto text-xs ${mutedClass}`}>{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div
          role="listbox"
          aria-label="Crews"
          className={`absolute z-30 left-0 right-0 mt-1 max-h-80 overflow-y-auto border rounded-sm shadow-xl ${cardClass} ${cardEdgeClass}`}
        >
          <RailItem active={crewFilter === 'ALL'} onClick={() => pick('ALL')}>
            <span className="w-4 h-4 shrink-0" />
            All players
          </RailItem>
          {crewList().map((crew) => (
            <RailItem key={crew.id} active={crewFilter === crew.id} accent={crew.color} onClick={() => pick(crew.id)}>
              <CrewPin crew={crew} className="w-4 h-4 shrink-0" />
              <span className="truncate">{crew.name}</span>
            </RailItem>
          ))}
        </div>
      )}
    </div>
  );
};
