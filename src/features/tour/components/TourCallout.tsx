// One box of the tour: what this part of the page is, with Back, Next and
// Skip. Sits next to the lit-up area with a small arrow pointing at it.
import { forwardRef, useEffect, useRef } from 'react';
import { themeClasses } from '../../../utils/theme';
import PixelIcon from '../../../shared/components/PixelIcon';
import type { Placement } from '../utils/placement';
import type { TourStep } from '../utils/tourSteps';

interface TourCalloutProps {
  step: TourStep;
  index: number;
  count: number;
  place: Placement;
  shown: boolean;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

const ARROW =
  'absolute w-3 h-3 rotate-45 border light:bg-white light:border-amber-200 dark:bg-zinc-900 dark:border-zinc-800';

const TourCallout = forwardRef<HTMLDivElement, TourCalloutProps>(
  ({ step, index, count, place, shown, onBack, onNext, onSkip }, ref) => {
    const { modalShellClass, textClass, mutedClass } = themeClasses;
    const nextRef = useRef<HTMLButtonElement | null>(null);
    const last = index === count - 1;

    // Keyboard players keep their place: Next has focus on every step.
    useEffect(() => {
      if (shown) nextRef.current?.focus({ preventScroll: true });
    }, [index, shown]);

    return (
      <div
        ref={ref}
        className={`${modalShellClass} ${textClass} fixed p-4 transition-[top,left,opacity] duration-300 ease-out motion-reduce:transition-none ${
          shown ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ top: place.top, left: place.left, width: 'min(22rem, calc(100vw - 2rem))' }}
      >
        {place.side === 'below' && (
          <span className={`${ARROW} -top-1.5 border-b-0 border-r-0`} style={{ left: place.arrowLeft - 6 }} />
        )}
        {place.side === 'above' && (
          <span className={`${ARROW} -bottom-1.5 border-t-0 border-l-0`} style={{ left: place.arrowLeft - 6 }} />
        )}

        <div className="flex gap-0.5 mb-3" aria-hidden="true">
          {Array.from({ length: count }, (_, i) => (
            <span
              key={i}
              className={`h-1 flex-1 rounded-sm ${i <= index ? 'bg-orange-500' : 'light:bg-amber-100 dark:bg-zinc-800'}`}
            />
          ))}
        </div>

        <div aria-live="polite">
          <div className="flex items-center gap-2 mb-1.5">
            <PixelIcon name={step.icon} className="w-6 h-6 shrink-0" />
            <h2 className="text-base font-bold">{step.title}</h2>
          </div>
          <p className={`text-sm leading-relaxed ${mutedClass}`}>{step.body()}</p>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {!last && (
            <button type="button" onClick={onSkip} className={`mr-auto text-xs ${mutedClass} hover:text-orange-500`}>
              Skip tour
            </button>
          )}
          {index > 0 && (
            <button
              type="button"
              onClick={onBack}
              className={`${last ? 'mr-auto' : ''} px-3 py-1.5 text-sm rounded-sm ${mutedClass} hover:text-orange-500`}
            >
              Back
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            onClick={onNext}
            className="px-5 py-1.5 bg-orange-600 hover:bg-orange-700 text-white text-sm font-semibold rounded-sm"
          >
            {last ? 'Start trading' : index === 0 ? 'Show me around' : 'Next'}
          </button>
        </div>
      </div>
    );
  },
);
TourCallout.displayName = 'TourCallout';

export default TourCallout;
