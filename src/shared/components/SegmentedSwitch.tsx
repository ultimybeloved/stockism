import type { MouseEvent, ReactNode } from 'react';

interface SegmentedSwitchProps<V extends string> {
  options: readonly (readonly [V, ReactNode])[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  /** 'sm' inside cards (the shop's styles), 'md' for most controls, 'lg' beside full-size buttons. */
  size?: 'sm' | 'md' | 'lg';
  /** Stretch across the row, segments sharing the width. */
  fill?: boolean;
  /** Options that can't be picked right now. */
  disabled?: readonly V[];
  className?: string;
}

const SIZES = {
  sm: 'px-2.5 py-1 text-[11px]',
  md: 'px-2 sm:px-3 py-1.5 text-xs',
  lg: 'px-3 sm:px-4 py-2 text-sm',
};

// The site's small switch, used instead of pill buttons: joined segments, a
// hover highlight, an orange underline on the one that's on. Scrolls sideways
// on a screen too narrow for it. It often sits inside tappable cards, so a
// press never reaches the card.
const SegmentedSwitch = <V extends string>({
  options,
  value,
  onChange,
  label,
  size = 'sm',
  fill = false,
  disabled = [],
  className = '',
}: SegmentedSwitchProps<V>) => (
  <span
    role="radiogroup"
    aria-label={label}
    className={`${fill ? 'flex w-full' : 'inline-flex'} max-w-full overflow-x-auto scrollbar-hide rounded-md border light:border-amber-200 dark:border-zinc-800 ${className}`}
    onClick={(e: MouseEvent) => e.stopPropagation()}
  >
    {options.map(([v, text]) => {
      const on = v === value;
      return (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={on}
          disabled={disabled.includes(v)}
          onClick={() => onChange(v)}
          className={`${SIZES[size]} ${fill ? 'flex-1' : 'shrink-0'} inline-flex items-center justify-center gap-1 font-semibold whitespace-nowrap disabled:opacity-40 disabled:pointer-events-none border-r last:border-r-0 light:border-amber-200 dark:border-zinc-800 transition-colors ${
            on
              ? 'shadow-[inset_0_-2px_0_#f97316] light:bg-amber-100 light:text-slate-900 dark:bg-zinc-800 dark:text-zinc-50'
              : 'light:text-zinc-500 light:hover:bg-amber-50 light:hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800/60 dark:hover:text-zinc-200'
          }`}
        >
          {text}
        </button>
      );
    })}
  </span>
);

export default SegmentedSwitch;
