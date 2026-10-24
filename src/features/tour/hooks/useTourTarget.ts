import { useEffect, useState } from 'react';
import type { Box } from '../utils/placement';

/** How long a step waits for its target to show up (pages load lazily). */
const TARGET_WAIT_MS = 2500;
/** Optional steps give up sooner: their card is usually just not there. */
const OPTIONAL_WAIT_MS = 900;

export type TargetStatus = 'searching' | 'found' | 'missing';

const reducedMotion = () =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Phones and computers can mark different elements with the same name; the
// one with a size on screen wins (the other is display: none).
const findVisible = (name: string) =>
  [...document.querySelectorAll<HTMLElement>(`[data-tour="${name}"]`)].find((el) => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }) ?? null;

const isPinned = (el: HTMLElement) => {
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const { position } = getComputedStyle(node);
    if (position === 'fixed' || position === 'sticky') return true;
  }
  return false;
};

/**
 * Finds the element a tour step lights up, scrolls it into view and follows
 * it on screen (scrolling, resizing, cards loading in) until the step changes.
 * `missing` when it never shows up, so the box can fall back to the middle.
 */
export function useTourTarget(name: string | undefined, optional: boolean, stepKey: string, ready: boolean) {
  const [rect, setRect] = useState<Box | null>(null);
  const [status, setStatus] = useState<TargetStatus>(name ? 'searching' : 'found');

  useEffect(() => {
    setRect(null);
    // Still on the last step's page: wait for the new one.
    if (!ready) {
      setStatus('searching');
      return undefined;
    }
    if (!name) {
      setStatus('found');
      return undefined;
    }
    setStatus('searching');
    const started = performance.now();
    const wait = optional ? OPTIONAL_WAIT_MS : TARGET_WAIT_MS;
    let el: HTMLElement | null = null;
    let last = '';
    let frame = 0;

    const tick = () => {
      if (!el || !el.isConnected) {
        el = findVisible(name);
        if (el) {
          if (!isPinned(el)) el.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
          setStatus('found');
        } else if (performance.now() - started > wait) {
          setRect(null);
          setStatus('missing');
          return;
        }
      }
      if (el) {
        const r = el.getBoundingClientRect();
        const key = `${r.top}|${r.left}|${r.width}|${r.height}`;
        if (key !== last) {
          last = key;
          setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
        }
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [name, optional, stepKey, ready]);

  return { rect, status };
}
