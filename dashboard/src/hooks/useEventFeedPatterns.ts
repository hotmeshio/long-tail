import { useState, useMemo, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import { sanitizeSubjectToken } from '../lib/events/subjects';

const STORAGE_KEY = 'lt_event_feed_patterns';

/** Derive a base subscription pattern from the current route. */
function patternFromRoute(pathname: string, search: string): string {
  // Topic detail → subscribe to that specific topic
  if (pathname.startsWith('/topics/')) {
    const topic = decodeURIComponent(pathname.replace('/topics/', ''));
    if (topic && !topic.includes('/')) return `lt.events.${topic}`;
  }
  // Escalation detail → that item's own lifecycle, across role hops
  // (the id is the subject's fourth token, after the role).
  const escDetailMatch = pathname.match(/^\/escalations\/detail\/(.+)/);
  if (escDetailMatch) return `lt.events.system.escalation.*.${escDetailMatch[1]}.>`;
  // Escalation pages (list) — a role filter narrows to that queue's token
  if (pathname.startsWith('/escalations')) {
    const role = new URLSearchParams(search).get('role');
    return role
      ? `lt.events.system.escalation.${sanitizeSubjectToken(role)}.>`
      : 'lt.events.system.escalation.>';
  }
  // Workflow execution detail → subscribe to that specific workflow
  const wfDetailMatch = pathname.match(/^\/workflows\/(?:durable\/)?executions\/(.+)/);
  if (wfDetailMatch) return `lt.events.system.workflow.${wfDetailMatch[1]}.>`;
  // Workflow pages (list)
  if (pathname.startsWith('/workflows')) return 'lt.events.system.workflow.>';
  // Agent detail → subscribe to that specific agent's events
  const agentDetailMatch = pathname.match(/^\/agents\/([^/]+)$/);
  if (agentDetailMatch && agentDetailMatch[1] !== 'new') return `lt.events.system.agent.${agentDetailMatch[1]}.>`;
  // Agent pages (list)
  if (pathname.startsWith('/agents')) return 'lt.events.system.agent.>';
  // Knowledge
  if (pathname.startsWith('/knowledge')) return 'lt.events.system.knowledge.>';
  // Files
  if (pathname.startsWith('/files')) return 'lt.events.system.file.>';
  // Home / recent activity — all system events
  if (pathname === '/') return 'lt.events.system.>';
  // MCP execution detail → subscribe to that specific job
  const mcpDetailMatch = pathname.match(/^\/mcp\/executions\/(.+)/);
  if (mcpDetailMatch) return `lt.events.system.*.${mcpDetailMatch[1]}.>`;
  // Capabilities, MCP — include workflow events so graph flow lifecycle is visible
  if (pathname.startsWith('/mcp')) return 'lt.events.system.>';
  // Fallback — all system events
  return 'lt.events.system.>';
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
  const { pathname, search } = useLocation();
  const [userPatterns, setUserPatterns] = useState<string[]>(loadUserPatterns);

  const pagePattern = useMemo(() => patternFromRoute(pathname, search), [pathname, search]);

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
