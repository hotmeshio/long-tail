import { useState, useCallback, useRef } from 'react';

// ── History hook ──────────────────────────────────────────────────────────────

export interface HistoryEntry {
  path: string;
  scrollTop: number;
}

export function useDocHistory() {
  const [backStack, setBackStack] = useState<HistoryEntry[]>([]);
  const [forwardStack, setForwardStack] = useState<HistoryEntry[]>([]);
  const [current, setCurrent] = useState<HistoryEntry | null>(null);

  // Refs track latest values so callbacks never read stale state
  const currentRef = useRef(current);
  const backRef = useRef(backStack);
  const forwardRef = useRef(forwardStack);
  currentRef.current = current;
  backRef.current = backStack;
  forwardRef.current = forwardStack;

  const navigate = useCallback((path: string, scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const prev = currentRef.current;
    if (prev) {
      const scrollTop = scrollRef?.current?.scrollTop ?? 0;
      setBackStack([...backRef.current, { ...prev, scrollTop }]);
    }
    setForwardStack([]);
    setCurrent({ path, scrollTop: 0 });
  }, []);

  const goBack = useCallback((scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const back = backRef.current;
    if (back.length === 0) return;
    const prev = back[back.length - 1];
    const cur = currentRef.current;
    if (cur) {
      const scrollTop = scrollRef?.current?.scrollTop ?? 0;
      setForwardStack([...forwardRef.current, { ...cur, scrollTop }]);
    }
    setBackStack(back.slice(0, -1));
    setCurrent(prev);
    requestAnimationFrame(() => {
      if (scrollRef?.current) scrollRef.current.scrollTop = prev.scrollTop;
    });
  }, []);

  const goForward = useCallback((scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const fwd = forwardRef.current;
    if (fwd.length === 0) return;
    const next = fwd[fwd.length - 1];
    const cur = currentRef.current;
    if (cur) {
      const scrollTop = scrollRef?.current?.scrollTop ?? 0;
      setBackStack([...backRef.current, { ...cur, scrollTop }]);
    }
    setForwardStack(fwd.slice(0, -1));
    setCurrent(next);
    requestAnimationFrame(() => {
      if (scrollRef?.current) scrollRef.current.scrollTop = next.scrollTop;
    });
  }, []);

  const pushScrollPosition = useCallback((scrollRef?: React.RefObject<HTMLDivElement | null>) => {
    const cur = currentRef.current;
    if (!cur) return;
    const scrollTop = scrollRef?.current?.scrollTop ?? 0;
    setBackStack([...backRef.current, { ...cur, scrollTop }]);
    setForwardStack([]);
    setCurrent({ ...cur, scrollTop: scrollRef?.current?.scrollTop ?? 0 });
  }, []);

  const reset = useCallback(() => {
    setBackStack([]);
    setForwardStack([]);
    setCurrent(null);
  }, []);

  return { current, backStack, forwardStack, navigate, goBack, goForward, pushScrollPosition, reset };
}

// ── Resolve relative doc links ───────────────────────────────────────────────

export function resolveDocLink(link: string, currentPath: string | null): { path: string; anchor?: string } {
  const [rawPath, anchor] = link.split('#');
  let resolved = rawPath;

  // Relative paths like ../architecture.md or ./data.md
  if (resolved.startsWith('./') || resolved.startsWith('../')) {
    const currentDir = currentPath ? currentPath.replace(/[^/]+$/, '') : '';
    const parts = (currentDir + resolved).split('/');
    const normalized: string[] = [];
    for (const p of parts) {
      if (p === '..') normalized.pop();
      else if (p && p !== '.') normalized.push(p);
    }
    resolved = normalized.join('/');
  }

  return { path: resolved, anchor };
}

// ── Hash helpers ──────────────────────────────────────────────────────────────

export function parseDocsHash(hash: string): { path: string; anchor?: string } | null {
  if (!hash.startsWith('#docs')) return null;
  const parts = hash.slice(1).split(':'); // ['docs', 'mcp.md', 'anchor']
  const path = parts[1] || 'README.md';
  const anchor = parts[2] || undefined;
  return { path, anchor };
}

export function buildDocsHash(path: string | null): string {
  if (!path || path === 'README.md') return '#docs';
  return `#docs:${path}`;
}
