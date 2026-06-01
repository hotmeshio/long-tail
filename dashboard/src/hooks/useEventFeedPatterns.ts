import { useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';

const STORAGE_KEY = 'lt_event_feed_patterns';

/** Derive a base subscription pattern from the current route. */
function patternFromRoute(pathname: string): string {
  // Topic detail → subscribe to that specific topic
  if (pathname.startsWith('/topics/')) {
    const topic = decodeURIComponent(pathname.replace('/topics/', ''));
    if (topic && !topic.includes('/')) return `lt.events.${topic}`;
  }
  // Escalation pages
  if (pathname.startsWith('/escalations')) return 'lt.events.escalation.>';
  // Workflow pages
  if (pathname.startsWith('/workflows')) return 'lt.events.workflow.>';
  // Agent pages
  if (pathname.startsWith('/agents')) return 'lt.events.agent.>';
  // Knowledge
  if (pathname.startsWith('/knowledge')) return 'lt.events.knowledge.>';
  // Files
  if (pathname.startsWith('/files')) return 'lt.events.file.>';
  // Home / recent activity — broader
  if (pathname === '/') return 'lt.events.>';
  // Capabilities, MCP
  if (pathname.startsWith('/mcp')) return 'lt.events.activity.>';
  // Fallback
  return 'lt.events.>';
}

function loadUserPatterns(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch { return []; }
}

function saveUserPatterns(patterns: string[]): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(patterns)); }
  catch { /* quota */ }
}

/**
 * Returns the combined set of event feed subscription patterns:
 * one page-derived pattern + any user-added patterns from localStorage.
 */
export function useEventFeedPatterns() {
  const { pathname } = useLocation();
  const [userPatterns, setUserPatterns] = useState<string[]>(loadUserPatterns);

  const pagePattern = useMemo(() => patternFromRoute(pathname), [pathname]);

  const allPatterns = useMemo(() => {
    const set = new Set([pagePattern, ...userPatterns]);
    return Array.from(set);
  }, [pagePattern, userPatterns]);

  const addPattern = useCallback((pattern: string) => {
    const prefixed = pattern.startsWith('lt.events.') ? pattern : `lt.events.${pattern}`;
    setUserPatterns((prev) => {
      if (prev.includes(prefixed)) return prev;
      const next = [...prev, prefixed];
      saveUserPatterns(next);
      return next;
    });
  }, []);

  const removePattern = useCallback((pattern: string) => {
    setUserPatterns((prev) => {
      const next = prev.filter((p) => p !== pattern);
      saveUserPatterns(next);
      return next;
    });
  }, []);

  const clearUserPatterns = useCallback(() => {
    setUserPatterns([]);
    saveUserPatterns([]);
  }, []);

  return {
    patterns: allPatterns,
    pagePattern,
    userPatterns,
    addPattern,
    removePattern,
    clearUserPatterns,
  };
}
