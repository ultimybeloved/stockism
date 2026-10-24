// The guided tour: dims the screen, lights up one part of a page at a time
// and explains it in a box beside it. Walks from home to a stock page,
// Missions and Portfolio and back. Opens once for a new player; anyone can
// replay it from the account menu or About (startTour).
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEscapeKey } from '../../../shared/hooks/useEscapeKey';
import { useModalFocus } from '../../../shared/hooks/useModalFocus';
import { useTour } from '../hooks/useTour';
import { useTourTarget } from '../hooks/useTourTarget';
import { placeCallout, TOUR_PADDING, type Box } from '../utils/placement';
import TourSpotlight from './TourSpotlight';
import TourCallout from './TourCallout';

const pad = (r: Box): Box => ({
  top: r.top - TOUR_PADDING,
  left: r.left - TOUR_PADDING,
  width: r.width + TOUR_PADDING * 2,
  height: r.height + TOUR_PADDING * 2,
});

export default function GuidedTour({ autoStart, onFirstRunDone }: { autoStart: boolean; onFirstRunDone: () => void }) {
  const tour = useTour({ autoStart, onFirstRunDone });
  if (!tour.active) return null;
  return <TourScreen tour={tour} />;
}

function TourScreen({ tour }: { tour: ReturnType<typeof useTour> }) {
  const { step, index, count, onPage, next, back, passOver, close } = tour;
  const { rect, status } = useTourTarget(step.target, !!step.optional, step.id, onPage);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState({ width: window.innerWidth, height: window.innerHeight });
  const boxRef = useRef<HTMLDivElement | null>(null);
  const focusRef = useModalFocus<HTMLDivElement>();
  const setBox = useCallback(
    (el: HTMLDivElement | null) => {
      boxRef.current = el;
      focusRef(el);
    },
    [focusRef],
  );

  useEscapeKey(close);

  useEffect(() => {
    if (status === 'missing' && step.optional) passOver();
  }, [status, step.optional, passOver]);

  useEffect(() => {
    const onResize = () => setView({ width: window.innerWidth, height: window.innerHeight });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') next();
      else if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('resize', onResize);
    document.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('resize', onResize);
      document.removeEventListener('keydown', onKey);
    };
  }, [next, back]);

  // The box's size decides where it fits. It changes with the step's text
  // and the screen width.
  useLayoutEffect(() => {
    const el = boxRef.current;
    if (el) setSize({ width: el.offsetWidth, height: el.offsetHeight });
  }, [index, view.width]);

  const hole = rect ? pad(rect) : null;
  const shown = status !== 'searching' && size.width > 0;

  return (
    <div className="fixed inset-0 z-[100]">
      <TourSpotlight hole={status === 'found' ? hole : null} />
      <TourCallout
        ref={setBox}
        step={step}
        index={index}
        count={count}
        place={placeCallout(status === 'found' ? hole : null, size, view)}
        shown={shown}
        onBack={back}
        onNext={next}
        onSkip={close}
      />
    </div>
  );
}
