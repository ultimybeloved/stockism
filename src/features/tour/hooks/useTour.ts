import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { TOUR_STEPS } from '../utils/tourSteps';

/** Fired by the "Replay the tour" buttons; GuidedTour listens for it. */
export const START_TOUR_EVENT = 'stockism:start-tour';
export const startTour = () => window.dispatchEvent(new Event(START_TOUR_EVENT));

/**
 * The tour's step and page. `autoStart` opens it once for a new player;
 * `onFirstRunDone` runs when that first run is finished or skipped, so it never
 * opens on its own again. Replays never call it.
 */
export function useTour({ autoStart, onFirstRunDone }: { autoStart: boolean; onFirstRunDone: () => void }) {
  const [active, setActive] = useState(false);
  const [index, setIndex] = useState(0);
  const forward = useRef(true);
  const firstRun = useRef(false);
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const step = TOUR_STEPS[index]!;

  const open = useCallback((first: boolean) => {
    firstRun.current = first;
    forward.current = true;
    setIndex(0);
    setActive(true);
  }, []);

  useEffect(() => {
    if (autoStart) open(true);
  }, [autoStart, open]);

  useEffect(() => {
    const onStart = () => open(false);
    window.addEventListener(START_TOUR_EVENT, onStart);
    return () => window.removeEventListener(START_TOUR_EVENT, onStart);
  }, [open]);

  // Each step brings its own page.
  useEffect(() => {
    if (active && pathname !== step.route) navigate(step.route);
  }, [active, pathname, step.route, navigate]);

  const close = useCallback(() => {
    setActive(false);
    if (pathname !== '/') navigate('/');
    if (firstRun.current) {
      firstRun.current = false;
      onFirstRunDone();
    }
  }, [pathname, navigate, onFirstRunDone]);

  const go = useCallback(
    (delta: 1 | -1) => {
      const next = index + delta;
      if (next >= TOUR_STEPS.length) return close();
      if (next < 0) return undefined;
      forward.current = delta > 0;
      setIndex(next);
      return undefined;
    },
    [index, close],
  );

  /** An optional step whose card isn't on the page is passed over, either way. */
  const passOver = useCallback(() => {
    const next = index + (forward.current ? 1 : -1);
    if (next < 0) setIndex(index + 1);
    else if (next >= TOUR_STEPS.length) close();
    else setIndex(next);
  }, [index, close]);

  return {
    active,
    step,
    index,
    count: TOUR_STEPS.length,
    onPage: pathname === step.route,
    next: () => go(1),
    back: () => go(-1),
    passOver,
    close,
  };
}
