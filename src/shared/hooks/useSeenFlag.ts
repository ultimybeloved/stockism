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
