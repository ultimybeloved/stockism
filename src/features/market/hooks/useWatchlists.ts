import { useCallback, useState, useSyncExternalStore } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase';
import { useSession } from '../../../context/AppContext';
import { getWatchlists, watchlistWrite } from '../utils/watchlists';
import type { Watchlist } from '../../../types';

/** Store the player's lists (and the flat `watchlist` beside them). */
export const saveWatchlists = (uid: string, lists: Watchlist[]) =>
  updateDoc(doc(db, 'users', uid), watchlistWrite(lists));

// The "Save to list" menu: which stock it's open for. A tiny store, so the star
// on any card can open the one menu App renders.
let pickerTicker: string | null = null;
const listeners = new Set<() => void>();
export const openWatchlistPicker = (ticker: string | null) => {
  pickerTicker = ticker;
  listeners.forEach((l) => l());
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
export const useWatchlistPicker = () => useSyncExternalStore(subscribe, () => pickerTicker);

/** The signed-in player's lists, and a save that reports failures. */
export function useWatchlists() {
  const { user, userData, showNotification } = useSession();
  const lists = getWatchlists(userData);
  const save = useCallback(
    async (next: Watchlist[] | null) => {
      if (!user || !next) return false;
      try {
        await saveWatchlists(user.uid, next);
        return true;
      } catch (err) {
        console.error('Failed to update watchlists:', err);
        showNotification('error', 'Could not save your watchlist. Try again.');
        return false;
      }
    },
    [user, showNotification],
  );
  return { lists, save };
}

const ACTIVE_KEY = 'stockism_watchlist';
const readActive = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY) || '';
  } catch {
    return '';
  }
};

/** The list open on the Watchlist tab, remembered per browser. Falls back to the first. */
export function useActiveWatchlist(lists: Watchlist[]) {
  const [id, setId] = useState(readActive);
  const active = lists.find((l) => l.id === id) ?? lists[0]!;
  const setActive = useCallback((next: string) => {
    setId(next);
    try {
      localStorage.setItem(ACTIVE_KEY, next);
    } catch {
      // Private window: it just won't be remembered.
    }
  }, []);
  return [active, setActive] as const;
}
