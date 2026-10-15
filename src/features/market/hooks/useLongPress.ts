import { useRef, type MouseEvent, type TouchEvent } from 'react';

const HOLD_MS = 450;
const MOVE_PX = 10;

// Tap does one thing, press-and-hold another (phones). Spread the result onto
// the element. Moving the finger (a scroll) cancels the hold, and the click
// that follows a hold is swallowed so it does not also count as a tap.
export function useLongPress(onTap: () => void, onHold?: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const held = useRef(false);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  };

  if (!onHold) return { onClick: onTap };

  return {
    onTouchStart: (e: TouchEvent) => {
      held.current = false;
      const t = e.touches[0]!;
      start.current = { x: t.clientX, y: t.clientY };
      timer.current = setTimeout(() => {
        held.current = true;
        timer.current = null;
        navigator.vibrate?.(15);
        onHold();
      }, HOLD_MS);
    },
    onTouchMove: (e: TouchEvent) => {
      const t = e.touches[0]!;
      if (start.current && Math.hypot(t.clientX - start.current.x, t.clientY - start.current.y) > MOVE_PX) cancel();
    },
    // After a hold, cancel the tap the browser would send on lifting the
    // finger: it would land on the menu that just opened and close it again.
    onTouchEnd: (e: TouchEvent) => {
      if (held.current) e.preventDefault();
      cancel();
    },
    onTouchCancel: cancel,
    // The browser's own long-press menu would cover ours.
    onContextMenu: (e: MouseEvent) => e.preventDefault(),
    onClick: () => {
      if (held.current) {
        held.current = false;
        return;
      }
      onTap();
    },
  };
}
