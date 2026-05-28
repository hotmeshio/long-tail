import { useState, useCallback } from 'react';

const STORAGE_KEY = 'lt_view_mode';

/**
 * Persists a dev/user mode preference to sessionStorage.
 * Falls back to the provided default when no preference has been stored.
 */
export function useViewMode(defaultDevMode: boolean): {
  isDevMode: boolean;
  toggleMode: () => void;
} {
  const [isDevMode, setIsDevMode] = useState<boolean>(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved !== null) return saved === 'dev';
    } catch { /* sessionStorage unavailable */ }
    return defaultDevMode;
  });

  const toggleMode = useCallback(() => {
    setIsDevMode((prev) => {
      const next = !prev;
      try {
        sessionStorage.setItem(STORAGE_KEY, next ? 'dev' : 'user');
      } catch { /* quota exceeded or unavailable */ }
      return next;
    });
  }, []);

  return { isDevMode, toggleMode };
}
