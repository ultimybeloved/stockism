import type { ReactNode } from 'react';

interface ToggleChipProps {
  active: boolean;
  onClick: () => void;
  /** The color it lights up in; orange unless given (a crew's color, say). */
  accent?: string;
  title?: string;
  className?: string;
  children: ReactNode;
}

// A square, outlined filter chip for rows of options that wrap (crews,
// generations, sections), used instead of round pills. On, it takes the accent
// color on its edge and a tint of it inside.
const ToggleChip = ({ active, onClick, accent = '#f97316', title, className = '', children }: ToggleChipProps) => (
  <button
    type="button"
    aria-pressed={active}
    onClick={onClick}
    title={title}
    className={`inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold rounded-sm border transition-colors ${
      active
        ? 'light:text-slate-900 dark:text-zinc-50'
        : 'light:border-amber-200 light:text-zinc-500 light:hover:bg-amber-50 light:hover:text-slate-800 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
    } ${className}`}
    style={
      active
        ? { borderColor: accent, backgroundColor: `${accent}26`, boxShadow: `inset 0 -2px 0 ${accent}` }
        : undefined
    }
  >
    {children}
  </button>
);

export default ToggleChip;
