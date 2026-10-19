import type { ReactNode } from 'react';
import TabBar from '../../../shared/components/TabBar';
import SegmentedSwitch from '../../../shared/components/SegmentedSwitch';
import PixelIcon from '../../../shared/components/PixelIcon';
import { themeClasses } from '../../../utils/theme';

export type BoardMode = 'value' | 'gain' | 'season';
export type GainUnit = '$' | '%';

interface BoardNavProps {
  mode: BoardMode;
  setMode: (mode: BoardMode) => void;
  gainUnit: GainUnit;
  setGainUnit: (unit: GainUnit) => void;
  seasonActive: boolean;
  /** Pointing at a board warms it so opening it is instant. */
  onPrefetch: (mode: BoardMode) => void;
}

const boards = (seasonActive: boolean): { value: BoardMode; label: ReactNode }[] => [
  { value: 'value', label: 'Net Worth' },
  { value: 'gain', label: 'Top Gainers' },
  ...(seasonActive
    ? [
        {
          value: 'season' as const,
          label: (
            <>
              <PixelIcon name="season" className="w-3.5 h-3.5" />
              Season
            </>
          ),
        },
      ]
    : []),
];

const UNITS = [
  ['$', 'Dollars'],
  ['%', 'Percent'],
] as const;

// One choice in a side column list. The open one gets an edge bar in its
// accent color; the rest light up on hover.
export const RailItem = ({
  active,
  accent = '#f97316',
  onClick,
  onHover,
  children,
}: {
  active: boolean;
  accent?: string;
  onClick: () => void;
  onHover?: () => void;
  children: ReactNode;
}) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    onMouseEnter={onHover}
    className={`w-full flex items-center gap-2 px-3 py-2 text-sm font-semibold text-left border-l-[3px] transition-colors ${
      active
        ? 'light:text-slate-900 dark:text-zinc-50'
        : 'border-transparent light:text-zinc-500 light:hover:bg-amber-50 light:hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-100'
    }`}
    style={active ? { borderLeftColor: accent, backgroundColor: `${accent}1f` } : undefined}
  >
    {children}
  </button>
);

export const RailHeading = ({ children }: { children: ReactNode }) => (
  <p className={`px-3 pt-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wide ${themeClasses.mutedClass}`}>
    {children}
  </p>
);

/** Desktop: the boards as a list in the left column. */
export const BoardRail = ({ mode, setMode, gainUnit, setGainUnit, seasonActive, onPrefetch }: BoardNavProps) => (
  <div>
    <RailHeading>Boards</RailHeading>
    {boards(seasonActive).map((b) => (
      <div key={b.value}>
        <RailItem active={mode === b.value} onClick={() => setMode(b.value)} onHover={() => onPrefetch(b.value)}>
          {b.label}
        </RailItem>
        {b.value === 'gain' && mode === 'gain' && (
          <div className="px-3 py-2">
            <SegmentedSwitch label="Gain in" options={UNITS} value={gainUnit} onChange={setGainUnit} fill />
          </div>
        )}
      </div>
    ))}
  </div>
);

/** Phones and tablets: the boards as a tab header over the list. */
export const BoardTabs = ({ mode, setMode, seasonActive, onPrefetch }: BoardNavProps) => (
  <TabBar
    label="Boards"
    tabs={boards(seasonActive).map((b) => ({ ...b, onHover: () => onPrefetch(b.value) }))}
    value={mode}
    onChange={setMode}
  />
);

/** Top Gainers in dollars or percent, for phones and tablets. */
export const GainUnitSwitch = ({ gainUnit, setGainUnit }: Pick<BoardNavProps, 'gainUnit' | 'setGainUnit'>) => (
  <SegmentedSwitch label="Gain in" size="md" options={UNITS} value={gainUnit} onChange={setGainUnit} />
);
