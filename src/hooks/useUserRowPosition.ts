import { useState, useEffect, useRef } from 'react';

// Tracks whether the signed-in player's leaderboard row is currently visible in
// the scroll container, or has scrolled above/below it — that drives the sticky
// "your rank" bars at the top and bottom of the board.
//
// Split out of LeaderboardPage.jsx, which was past the 300-line page limit.
// Returns the refs to attach plus the current position; 'unknown' means the row
// is not rendered at all (e.g. the player is not on the filtered board).
export type UserRowPosition = 'unknown' | 'visible' | 'above' | 'below';

export const useUserRowPosition = (deps: unknown[] = []) => {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const userRowRef = useRef<HTMLDivElement | null>(null);
  const [userRowPosition, setUserRowPosition] = useState<UserRowPosition>('unknown');

  useEffect(() => {
    const container = scrollContainerRef.current;
    const userRow = userRowRef.current;

    if (!container || !userRow) {
      setUserRowPosition('unknown');
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) {
          setUserRowPosition('visible');
        } else {
          const rowRect = entry.boundingClientRect;
          // rootBounds is always set when the observer has an element root.
          const containerRect = entry.rootBounds!;
          setUserRowPosition(rowRect.bottom < containerRect.top ? 'above' : 'below');
        }
      },
      {
        root: container,
        threshold: [0, 0.1],
      },
    );

    observer.observe(userRow);

    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { scrollContainerRef, userRowRef, userRowPosition };
};
