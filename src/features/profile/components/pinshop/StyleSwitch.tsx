import type { MouseEvent } from 'react';

interface StyleSwitchProps<V extends string> {
  options: readonly (readonly [V, string])[];
  value: V;
  onChange: (value: V) => void;
  label: string;
}

// A small connected switch (Steady / Pulsing, Fade / Solid, the Split Flap and
// Bull / Bear styles). Same look as the shop's category tabs: joined segments,
// a hover highlight, an orange underline on the one that's on. It sits inside
// tappable cards, so a press never reaches the card.
const StyleSwitch = <V extends string>({ options, value, onChange, label }: StyleSwitchProps<V>) => (
  <span
    role="radiogroup"
    aria-label={label}
    className="inline-flex shrink-0 overflow-hidden rounded-md border light:border-amber-200 dark:border-zinc-800"
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
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 text-[11px] font-semibold border-r last:border-r-0 light:border-amber-200 dark:border-zinc-800 transition-colors ${
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

export default StyleSwitch;
