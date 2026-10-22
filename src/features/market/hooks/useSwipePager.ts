import { useRef, useState, type TouchEvent } from 'react';

const MIN_DX = 60;

/**
 * Phones: swipe the market sideways to turn the page. Left is next, right is
 * previous. Mostly-vertical drags are scrolls and are ignored. `dir` says
 * which way the last turn went, so the new page can slide in from that side.
 */
export function useSwipePager(
  currentPage: number,
  totalPages: number,
  setCurrentPage: (page: number) => void,
  enabled: boolean,
) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);

  const go = (page: number) => {
    if (page < 1 || page > totalPages || page === currentPage) return;
    setDir(page > currentPage ? 'next' : 'prev');
    setCurrentPage(page);
    // Land at the top of the new page if the old one was scrolled past it.
    const top = box.current?.getBoundingClientRect().top ?? 0;
    if (top < 0) box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  const handlers = enabled
    ? {
        onTouchStart: (e: TouchEvent) => {
          const t = e.touches[0];
          start.current = t ? { x: t.clientX, y: t.clientY } : null;
        },
        onTouchEnd: (e: TouchEvent) => {
          const t = e.changedTouches[0];
          const s = start.current;
          start.current = null;
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          go(currentPage + (dx < 0 ? 1 : -1));
        },
      }
    : {};

  return { box, handlers, dir, go };
}
