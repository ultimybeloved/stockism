import type { ReactNode } from 'react';

/** Shown in place of the form when this answer can't be bet on right now. */
export const SlipNote = ({ children }: { children: ReactNode }) => (
  <p className="mt-3 p-3 text-sm rounded-sm light:bg-amber-50 light:text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
    {children}
  </p>
);

/** The big number at the bottom of the slip, under a dashed tear line. */
export const SlipTotal = ({ label, value, children }: { label: string; value: string; children?: ReactNode }) => (
  <div className="mt-4 pt-3 border-t border-dashed light:border-amber-300 dark:border-zinc-700">
    <div className="flex justify-between items-baseline gap-3">
      <span className="text-sm light:text-zinc-600 dark:text-zinc-400">{label}</span>
      <span className="text-2xl font-black tabular-nums light:text-slate-900 dark:text-zinc-50">{value}</span>
    </div>
    {children && <p className="text-xs mt-0.5 tabular-nums light:text-zinc-600 dark:text-zinc-400">{children}</p>}
  </div>
);
