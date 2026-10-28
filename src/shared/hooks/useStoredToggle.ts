import { useCallback, useSyncExternalStore } from 'react';

// An on/off display preference kept in the browser, such as chart chapter flags.
// Every component using the same key updates together. Storage blocked: the
// default holds and the toggle still works for the open page.
const listeners = new Set<() => void>();
const memory = new Map<string, boolean>();
const storageKey = (key: string) => `toggle:${key}`;

const read = (key: string, fallback: boolean) => {
  if (memory.has(key)) return memory.get(key)!;
  try {
    const v = localStorage.getItem(storageKey(key));
    return v === null ? fallback : v === '1';
  } catch {
    return fallback;
  }
};

const subscribe = (onChange: () => void) => {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
};

/** [on, toggle] for one stored display preference. */
export const useStoredToggle = (key: string, fallback = false): [boolean, () => void] => {
  const on = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const toggle = useCallback(() => {
    const next = !read(key, fallback);
    memory.set(key, next);
    try {
      localStorage.setItem(storageKey(key), next ? '1' : '0');
    } catch {
      /* kept in memory for this page only */
    }
    listeners.forEach((l) => l());
  }, [key, fallback]);
  return [on, toggle];
};
