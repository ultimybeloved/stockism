import type { ReactNode } from 'react';

export interface TabItem<V extends string> {
  value: V;
  label: ReactNode;
  /** Small count after the label (desktop only). */
  count?: number;
  onHover?: () => void;
}

interface TabBarProps<V extends string> {
  tabs: readonly TabItem<V>[];
  value: V;
  onChange: (value: V) => void;
  label: string;
  className?: string;
}

// The site's tab header, used instead of pill buttons: joined segments with
// dividers, a hover highlight, and the open tab merged into the panel below
// with an orange top edge. Scrolls sideways when the tabs don't fit.
const TabBar = <V extends string>({ tabs, value, onChange, label, className = '' }: TabBarProps<V>) => (
  <div
    role="tablist"
    aria-label={label}
    className={`flex shrink-0 overflow-x-auto scrollbar-hide rounded-t-md border-x border-t light:border-amber-200 light:bg-amber-50/70 dark:border-zinc-800 dark:bg-zinc-900/60 ${className}`}
  >
    {tabs.map((tab) => {
      const on = tab.value === value;
      return (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={on}
          onClick={() => onChange(tab.value)}
          onMouseEnter={tab.onHover}
          className={`flex-1 shrink-0 sm:shrink sm:min-w-0 px-3 sm:px-1 py-2.5 text-xs sm:text-[13px] font-semibold whitespace-nowrap inline-flex items-center justify-center gap-1 border-r border-b last:border-r-0 light:border-amber-200 dark:border-zinc-800 transition-colors ${
            on
              ? 'shadow-[inset_0_2px_0_#f97316] !border-b-transparent light:bg-white light:text-slate-900 dark:bg-zinc-900 dark:text-zinc-50'
              : 'light:text-zinc-500 light:hover:bg-amber-100/70 light:hover:text-slate-800 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
          }`}
        >
          {tab.label}
          {tab.count ? <span className="hidden sm:inline text-[11px] font-medium opacity-55">{tab.count}</span> : null}
        </button>
      );
    })}
  </div>
);

export default TabBar;
