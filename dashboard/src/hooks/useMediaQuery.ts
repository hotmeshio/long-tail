import { useEffect, useState } from 'react';

/**
 * Tracks a viewport media query. Unlike container measurement, the viewport
 * is stable while shell panels open and close, so layout decisions made on
 * it never feed back into themselves. Returns false in environments without
 * matchMedia (jsdom), which callers treat as "wide".
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    try {
      return window.matchMedia(query).matches;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let mql: MediaQueryList;
    try {
      mql = window.matchMedia(query);
    } catch {
      return;
    }
    setMatches(mql.matches);
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);

  return matches;
}
