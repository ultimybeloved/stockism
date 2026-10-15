import { useCallback, useSyncExternalStore } from 'react';

// Whether a CSS media query matches right now, updating as the window resizes.
// Tests (jsdom) have no matchMedia, so there it is always false.
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window.matchMedia !== 'function') return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    },
    [query],
  );
  const get = () => typeof window.matchMedia === 'function' && window.matchMedia(query).matches;
  return useSyncExternalStore(subscribe, get, () => false);
}

/** Phone width: below Tailwind's `md`. */
export const usePhone = () => useMediaQuery('(max-width: 767px)');
/** Wide desktop: Tailwind's `lg` and up. */
export const useWideScreen = () => useMediaQuery('(min-width: 1024px)');
/** A real mouse (hover-capable, fine pointer), so keyboard and hover extras make sense. */
export const useMousePointer = () => useMediaQuery('(hover: hover) and (pointer: fine)');
