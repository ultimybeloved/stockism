import type { KeyboardEvent } from 'react';

/**
 * Click AND keyboard support for a clickable box that can't simply be a
 * <button> (it holds other buttons, or needs block layout). Spread it in place
 * of onClick:
 *
 *   <div {...pressable(() => open(item))} className="...">
 *
 * Tab reaches it, and Enter or Space activates it, the same as a button.
 * Keys pressed on a button or link inside it are left to that control.
 */
export const pressable = (onPress: () => void) => ({
  role: 'button' as const,
  tabIndex: 0,
  onClick: onPress,
  onKeyDown: (e: KeyboardEvent) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onPress();
    }
  },
});
