import { useCallback, useLayoutEffect, useState, type Dispatch, type SetStateAction } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { db } from '../../firebase';

const STORAGE_KEY = 'stockism_darkMode';

/**
 * The theme, starting from this browser's saved choice. Dark when nothing is
 * saved. Mirrored onto <html> as the `dark` class, which every `dark:` and
 * `light:` style keys off; set before paint so the page never flashes the
 * other theme.
 */
export const useDarkMode = () => {
  const state = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored !== null) return stored === 'true';
    } catch (error) {
      console.error('Failed to load dark mode preference:', error);
    }
    return true;
  });
  const darkMode = state[0];
  useLayoutEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
  }, [darkMode]);
  return state;
};

/** Flips the theme and saves it to this browser and, when signed in, the account. */
export const useDarkModeToggle = (user: User | null, setDarkMode: Dispatch<SetStateAction<boolean>>) =>
  useCallback(() => {
    setDarkMode((prev) => {
      const newValue = !prev;
      localStorage.setItem(STORAGE_KEY, String(newValue));
      if (user) {
        updateDoc(doc(db, 'users', user.uid), { darkMode: newValue }).catch((err) => {
          console.error('Failed to save dark mode preference:', err);
        });
      }
      return newValue;
    });
  }, [user, setDarkMode]);
