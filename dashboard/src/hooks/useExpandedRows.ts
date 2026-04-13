import { useState, useCallback } from 'react';

/**
 * Track expanded row IDs with localStorage persistence.
 *
 * Resilient: if a stored ID no longer exists in the data, it's silently ignored.
 * Never blocks rendering — reads from localStorage synchronously on mount,
 * writes asynchronously on change.
 */
export function useExpandedRows(storageKey: string): {
  expandedIds: Set<string>;
  toggle: (id: string) => void;
  isExpanded: (id: string) => boolean;
} {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return new Set(parsed);
      }
    } catch { /* corrupted or unavailable — start empty */ }
    return new Set();
  });

  const persist = useCallback((next: Set<string>) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify([...next]));
    } catch { /* quota exceeded or unavailable — ignore */ }
  }, [storageKey]);

  const toggle = useCallback((id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      persist(next);
      return next;
    });
  }, [persist]);

  const isExpanded = useCallback((id: string) => expandedIds.has(id), [expandedIds]);

  return { expandedIds, toggle, isExpanded };
}
