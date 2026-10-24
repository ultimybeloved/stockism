import { useRef, type TouchEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { CHARACTERS } from '../../../characters';
import { browseNeighbors } from '../utils/browseList';

const MIN_DX = 60;

/**
 * Stock page: the previous and next stock in the market list, and phone swipe
 * handlers to go to them (left is next, right is previous). A swipe that starts
 * on the chart or a sideways-scrolling row is left alone, and mostly-vertical
 * drags are scrolls. Moving replaces the history entry, so Back still returns
 * to the market. `dir` comes back on the location so the page can slide in.
 */
export function useStockSwipe(ticker: string, prices: Record<string, number>) {
  const navigate = useNavigate();
  const start = useRef<{ x: number; y: number } | null>(null);

  const neighbors = browseNeighbors(
    ticker,
    CHARACTERS.filter((c) => prices[c.ticker]).map((c) => c.ticker),
  );

  const go = (dir: 'next' | 'prev') => {
    if (!neighbors) return;
    navigate(`/stock/${neighbors[dir]}`, { replace: true, state: { dir } });
  };

  const handlers = {
    onTouchStart: (e: TouchEvent) => {
      const t = e.touches[0];
      const skip = (e.target as HTMLElement).closest('[data-noswipe], .overflow-x-auto');
      start.current = t && !skip ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e: TouchEvent) => {
      const t = e.changedTouches[0];
      const s = start.current;
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < MIN_DX || Math.abs(dx) < Math.abs(dy) * 1.5) return;
      go(dx < 0 ? 'next' : 'prev');
    },
  };

  return { neighbors, go, handlers };
}
