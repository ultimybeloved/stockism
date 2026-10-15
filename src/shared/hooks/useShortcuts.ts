import { useEffect, useRef } from 'react';

// Keyboard shortcuts. Keys are lower-case `e.key` values ('b', '/', '?',
// 'arrowright'); 'mod+k' means Ctrl+K, or Cmd+K on a Mac. Plain keys are ignored
// while typing in a box or while a window (dialog) is open, so they never fire
// by accident; 'mod+' keys always work. A window can opt back in by carrying
// data-keep-shortcuts (the desktop stock window, so arrows and B / S work in
// it), as long as nothing else is open on top of it.
export type ShortcutMap = Record<string, (e: KeyboardEvent) => void>;

export const isTyping = (target: EventTarget | null) => {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
};

const dialogOpen = () => {
  const open = document.querySelectorAll('[aria-modal="true"]');
  return open.length > 1 || (open.length === 1 && !open[0]!.hasAttribute('data-keep-shortcuts'));
};

export function useShortcuts(map: ShortcutMap, enabled = true) {
  const mapRef = useRef(map);
  mapRef.current = map;

  useEffect(() => {
    if (!enabled) return undefined;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey) return;
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        const handler = mapRef.current[`mod+${key}`];
        if (handler) {
          e.preventDefault();
          handler(e);
        }
        return;
      }
      if (isTyping(e.target) || dialogOpen()) return;
      const handler = mapRef.current[key];
      if (handler) {
        e.preventDefault();
        handler(e);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);
}

/** "⌘" on a Mac, "Ctrl" everywhere else, for showing 'mod+' shortcuts. */
export const MOD_LABEL = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl';
