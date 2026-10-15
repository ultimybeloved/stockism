import { useCallback, useRef } from 'react';
import { useModalFocus } from './useModalFocus';

const CLOSE_AT = 90;

// Drag a bottom sheet down to close it. Attach the returned ref to the sheet.
// Only starts when the sheet is scrolled to its top, so scrolling the sheet's
// own content still works. Touch only: a mouse never triggers it.
export function useSwipeToClose(onClose: () => void, enabled = true) {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const cleanup = useRef<(() => void) | null>(null);

  return useCallback(
    (el: HTMLElement | null) => {
      cleanup.current?.();
      cleanup.current = null;
      if (!el || !enabled) return;
      let startY: number | null = null;
      let dy = 0;

      const start = (e: TouchEvent) => {
        // A finger on a text box or slider is editing, not dragging.
        const target = e.target as HTMLElement;
        if (el.scrollTop > 0 || target.closest('input, textarea, select')) return;
        startY = e.touches[0]!.clientY;
        dy = 0;
      };
      const move = (e: TouchEvent) => {
        if (startY === null) return;
        dy = Math.max(0, e.touches[0]!.clientY - startY);
        el.style.transform = dy ? `translateY(${dy}px)` : '';
        el.style.transition = 'none';
      };
      const end = () => {
        if (startY === null) return;
        startY = null;
        el.style.transition = 'transform 150ms ease-out';
        if (dy > CLOSE_AT) closeRef.current();
        else el.style.transform = '';
      };
      el.addEventListener('touchstart', start, { passive: true });
      el.addEventListener('touchmove', move, { passive: true });
      el.addEventListener('touchend', end);
      el.addEventListener('touchcancel', end);
      cleanup.current = () => {
        el.removeEventListener('touchstart', start);
        el.removeEventListener('touchmove', move);
        el.removeEventListener('touchend', end);
        el.removeEventListener('touchcancel', end);
      };
    },
    [enabled],
  );
}

/**
 * The ref for a bottom-sheet modal: the usual dialog focus handling plus
 * swipe-down-to-close. Use with themeClasses.sheetOverlayClass / sheetShellClass.
 */
export function useSheetRef(onClose: () => void) {
  const focusRef = useModalFocus();
  const swipeRef = useSwipeToClose(onClose);
  return useCallback(
    (el: HTMLDivElement | null) => {
      focusRef(el);
      swipeRef(el);
    },
    [focusRef, swipeRef],
  );
}
