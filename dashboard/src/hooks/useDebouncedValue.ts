import { SEARCH_DEBOUNCE_MS } from '../lib/realtime-refresh';
import { useEffect, useState } from 'react';

/**
 * Returns a debounced copy of `value` that only updates
 * after `delay` ms of inactivity.
 */
export function useDebouncedValue<T>(value: T, delay = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
