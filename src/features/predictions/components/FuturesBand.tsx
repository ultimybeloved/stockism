// The futures section, on its own indigo band so it never reads as part of
// the week's bets. Phones swipe through the markets sideways, with dots.
import { useState, type ReactNode } from 'react';
import { themeClasses } from '../../../utils/theme';

const GAP = 12;

const FuturesBand = ({ count, children }: { count: number; children: ReactNode }) => {
  const { mutedClass } = themeClasses;
  const [at, setAt] = useState(0);
  return (
    <section className="mt-10 -mx-4 lg:mx-0 px-4 py-6 border-t-[3px] border-indigo-600 dark:border-indigo-400 light:bg-indigo-50 dark:bg-indigo-950/25 lg:rounded-b-sm">
      <div className="flex items-baseline justify-between gap-3 mb-1">
        <h2 className="text-xl font-black tracking-tight text-indigo-900 dark:text-indigo-200">Futures</h2>
        {count > 1 && (
          <span className="lg:hidden flex gap-1 items-center" aria-hidden="true">
            {Array.from({ length: count }, (_, i) => (
              <i
                key={i}
                className={`h-1.5 rounded-full transition-all ${i === at ? 'w-4 bg-indigo-600 dark:bg-indigo-400' : 'w-1.5 light:bg-indigo-200 dark:bg-indigo-900'}`}
              />
            ))}
          </span>
        )}
      </div>
      <p className={`text-sm mb-4 ${mutedClass}`}>
        Markets on the bigger story. Buy and sell shares any time. Winning shares pay $1 each when the market settles.
      </p>
      {count === 0 ? (
        <p className={`text-sm ${mutedClass}`}>No futures markets right now.</p>
      ) : (
        <div
          onScroll={(e) => {
            const el = e.currentTarget;
            const first = el.firstElementChild as HTMLElement | null;
            if (first) setAt(Math.round(el.scrollLeft / (first.offsetWidth + GAP)));
          }}
          className="flex gap-3 overflow-x-auto snap-x snap-mandatory scrollbar-hide -mx-4 px-4 pb-1 items-start lg:mx-0 lg:px-0 lg:grid lg:grid-cols-2 lg:overflow-visible [&>*]:shrink-0 [&>*]:basis-[86%] [&>*]:snap-center lg:[&>*]:basis-auto"
        >
          {children}
        </div>
      )}
    </section>
  );
};

export default FuturesBand;
