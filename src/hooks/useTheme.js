// ============================================
// useTheme Hook
// Dark mode state management
// ============================================

import { useState, useEffect, useCallback } from 'react';

const THEME_KEY = 'stockism_darkMode';

/**
 * Custom hook for theme/dark mode state
 * @returns {Object} Theme state and methods
 */
export const useTheme = () => {
  // Initialize from localStorage or system preference
  const [darkMode, setDarkMode] = useState(() => {
    if (typeof window === 'undefined') return false;

    const stored = localStorage.getItem(THEME_KEY);
    if (stored !== null) {
      return stored === 'true';
    }

    // Check system preference
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  });

  // Update document class and localStorage when theme changes
  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem(THEME_KEY, String(darkMode));
  }, [darkMode]);

  // Listen for system theme changes
  useEffect(() => {
    const mediaQuery = window.matchMedia?.('(prefers-color-scheme: dark)');

    const handleChange = (e) => {
      // Only update if user hasn't manually set a preference
      const stored = localStorage.getItem(THEME_KEY);
      if (stored === null) {
        setDarkMode(e.matches);
      }
    };

    mediaQuery?.addEventListener?.('change', handleChange);

    return () => {
      mediaQuery?.removeEventListener?.('change', handleChange);
    };
  }, []);

  // Toggle dark mode
  const toggleDarkMode = useCallback(() => {
    setDarkMode(prev => !prev);
  }, []);

  // Set specific mode
  const setTheme = useCallback((isDark) => {
    setDarkMode(isDark);
  }, []);

  // Reset to system preference
  const resetToSystemPreference = useCallback(() => {
    localStorage.removeItem(THEME_KEY);
    const systemPreference = window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    setDarkMode(systemPreference);
  }, []);

  return {
    darkMode,
    isDark: darkMode,
    isLight: !darkMode,
    toggleDarkMode,
    setTheme,
    setDarkMode: setTheme,
    resetToSystemPreference
  };
};

export default useTheme;
