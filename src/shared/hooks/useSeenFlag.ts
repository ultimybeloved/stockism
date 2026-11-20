import { useCallback, useSyncExternalStore } from 'react';

// "Have they looked at this yet?" for NEW! badges, kept in the browser. Every
// badge for the same key updates together, so opening the shop from one button
// clears the badge on the others too. Storage blocked: the badge just shows.
const listeners = new Set<() => void>();
const storageKey = (key: string) => `seen:${key}`;

const isSeen = (key: string) => {
  try {
    return localStorage.getItem(storageKey(key)) === '1';
  } catch {
    return false;
  }
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

/**
 * [unseen keys, markSeen] for several NEW! badges at once (a fixed list, e.g.
 * one per shop category).
 */
export const useSeenFlags = (keys: readonly string[]): [Set<string>, (key: string) => void] => {
  const joined = useSyncExternalStore(
    subscribe,
    () => keys.map((k) => (isSeen(k) ? '1' : '0')).join(''),
    () => keys.map(() => '1').join(''),
  );
  const unseen = new Set(keys.filter((_, i) => joined[i] === '0'));
  const markSeen = useCallback((key: string) => {
    if (isSeen(key)) return;
    try {
      localStorage.setItem(storageKey(key), '1');
    } catch {
      /* nothing to remember it in */
    }
    listeners.forEach((l) => l());
  }, []);
  return [unseen, markSeen];
};

/** [unseen, markSeen] for one thing a NEW! badge points at. */
export const useSeenFlag = (key: string): [boolean, () => void] => {
  const seen = useSyncExternalStore(
    subscribe,
    () => isSeen(key),
    () => true,
  );
  const markSeen = useCallback(() => {
    if (isSeen(key)) return;
    try {
      localStorage.setItem(storageKey(key), '1');
    } catch {
      /* nothing to remember it in */
    }
    listeners.forEach((l) => l());
  }, [key]);
  return [!seen, markSeen];
};
