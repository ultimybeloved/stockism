import { useEffect, useRef, useState } from 'react';

// True while the page is at the top or being scrolled up; false while scrolling
// down. The phone bottom bar hides on the way down to give the content room,
// and anything pinned above it uses the same rule so they move together.
export function useHideOnScroll(): boolean {
  const [visible, setVisible] = useState(true);
  const lastY = useRef(0);
  const visibleRef = useRef(true);

  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      const show = y < 10 || y <= lastY.current;
      if (show !== visibleRef.current) {
        visibleRef.current = show;
        setVisible(show);
      }
      lastY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return visible;
}
