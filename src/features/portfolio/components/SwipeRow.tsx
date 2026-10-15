// A row that can be swiped sideways on a touch screen: right for one action,
// left for another. The colored strip behind it says which. Releasing past the
// line runs the action; anything short of it springs back. Mouse users never
// see any of this.
import { useRef, useState, type ReactNode, type TouchEvent } from 'react';

const TRIGGER_PX = 90;

interface SwipeRowProps {
  children: ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  leftLabel?: string;
  rightLabel?: string;
  colorBlindMode?: boolean;
}

const SwipeRow = ({
  children,
  onSwipeLeft,
  onSwipeRight,
  leftLabel = 'Sell',
  rightLabel = 'Buy more',
  colorBlindMode = false,
}: SwipeRowProps) => {
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<'x' | 'y' | null>(null);

  if (!onSwipeLeft && !onSwipeRight) return <>{children}</>;

  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0]!;
    start.current = { x: t.clientX, y: t.clientY };
    axis.current = null;
  };
  const onTouchMove = (e: TouchEvent) => {
    if (!start.current) return;
    const t = e.touches[0]!;
    const mx = t.clientX - start.current.x;
    const my = t.clientY - start.current.y;
    // Decide once whether this is a sideways swipe or a scroll.
    if (!axis.current && Math.hypot(mx, my) > 8) axis.current = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
    if (axis.current !== 'x') return;
    let next = mx;
    if (next > 0 && !onSwipeRight) next = 0;
    if (next < 0 && !onSwipeLeft) next = 0;
    setDragging(true);
    setDx(Math.max(-140, Math.min(140, next)));
  };
  const onTouchEnd = () => {
    if (dx <= -TRIGGER_PX) onSwipeLeft?.();
    else if (dx >= TRIGGER_PX) onSwipeRight?.();
    start.current = null;
    axis.current = null;
    setDragging(false);
    setDx(0);
  };

  const up = colorBlindMode ? 'bg-teal-600' : 'bg-green-600';
  const down = colorBlindMode ? 'bg-purple-600' : 'bg-red-600';
  const past = Math.abs(dx) >= TRIGGER_PX;

  return (
    <div className="relative overflow-hidden rounded-sm">
      {dx !== 0 && (
        <div
          className={`absolute inset-0 flex items-center px-4 text-white text-sm font-semibold uppercase ${
            dx > 0 ? `${up} justify-start` : `${down} justify-end`
          } ${past ? 'opacity-100' : 'opacity-70'}`}
          aria-hidden="true"
        >
          {dx > 0 ? rightLabel : leftLabel}
        </div>
      )}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
        className="relative touch-pan-y light:bg-amber-50 dark:bg-zinc-900"
        style={{
          transform: dx ? `translateX(${dx}px)` : undefined,
          transition: dragging ? 'none' : 'transform 150ms ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
};

export default SwipeRow;
