import { useState, useEffect, useRef } from 'react';

// Tracks whether the signed-in player's leaderboard row is currently visible in
// the scroll container, or has scrolled above/below it — that drives the sticky
// "your rank" bars at the top and bottom of the board.
//
// Split out of LeaderboardPage.jsx, which was past the 300-line page limit.
// Returns the refs to attach plus the current position; 'unknown' means the row
// is not rendered at all (e.g. the player is not on the filtered board).
export const useUserRowPosition = (deps = []) => {
  const scrollContainerRef = useRef(null);
  const userRowRef = useRef(null);
  const [userRowPosition, setUserRowPosition] = useState('unknown');

  useEffect(() => {
    const container = scrollContainerRef.current;
    const userRow = userRowRef.current;

    if (!container || !userRow) {
      setUserRowPosition('unknown');
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setUserRowPosition('visible');
        } else {
          const rowRect = entry.boundingClientRect;
          const containerRect = entry.rootBounds;
          setUserRowPosition(rowRect.bottom < containerRect.top ? 'above' : 'below');
        }
      },
      {
        root: container,
        threshold: [0, 0.1]
      }
    );

    observer.observe(userRow);

    return () => {
      observer.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { scrollContainerRef, userRowRef, userRowPosition };
};
