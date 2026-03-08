import { useState, useCallback } from 'react';

const STORAGE_KEY = 'lt-collapsed-sections';

function load(pageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY}:${pageKey}`);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function save(pageKey: string, set: Set<string>) {
  localStorage.setItem(`${STORAGE_KEY}:${pageKey}`, JSON.stringify([...set]));
}

export function useCollapsedSections(pageKey: string) {
  const [collapsed, setCollapsed] = useState<Set<string>>(() => load(pageKey));

  const isCollapsed = useCallback(
    (section: string) => collapsed.has(section),
    [collapsed],
  );

  const toggle = useCallback(
    (section: string) => {
      setCollapsed((prev) => {
        const next = new Set(prev);
        if (next.has(section)) {
          next.delete(section);
        } else {
          next.add(section);
        }
        save(pageKey, next);
        return next;
      });
    },
    [pageKey],
  );

  return { isCollapsed, toggle };
}
