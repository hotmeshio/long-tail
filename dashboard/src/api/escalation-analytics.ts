// ---------------------------------------------------------------------------
// Escalation analytics hooks — grouped membership/dwell aggregates and
// per-entity interval timelines (POST /escalations/aggregate-by-facets and
// /timeline-by-facet). Every escalation is one open interval
// [created_at, ended_at); these hooks read that time-series.
//
// Query-key discipline: inputs are canonicalized (key-sorted stringify) and
// windows are quantized to the minute — the window end rounds UP to the next
// minute boundary so (a) keys stay stable across renders within the minute
// and (b) `to >= now` keeps the query in the server's now-anchored cache
// (invalidated on escalation writes) instead of the 10-minute past cache.
// Refresh is push-driven (useEscalationAnalyticsEvents) — never polling.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, ApiError } from './client';

// Wire types — mirrors of types/analytics.ts on the server.

export interface AnalyticsWindow {
  from: string;
  to: string;
}

export type AggregateMeasure =
  | { kind: 'membership'; asOf?: string }
  | { kind: 'dwell'; window: AnalyticsWindow };

export interface AnalyticsFilter {
  role?: string;
  roles?: string[];
  /** Entity facet key — resolves server-side to every role declaring it (the entity's system). */
  entity?: string;
  facets?: Record<string, unknown>;
  block?: Record<string, unknown>[];
  range?: { facet: string; op: '<' | '<=' | '>' | '>=' | '='; value: number }[];
  exists?: string[];
}

export interface AggregateByFacetsInput {
  query: AnalyticsFilter;
  groupBy: { columns?: ('role' | 'subtype' | 'status')[]; facets?: string[]; state?: boolean };
  measure: AggregateMeasure;
  distinctBy?: string;
  orderBy?: { field: string; direction?: 'asc' | 'desc' }[];
  limit?: number;
  offset?: number;
}

export interface AggregateRow {
  role?: string;
  subtype?: string | null;
  status?: string;
  facets: Record<string, string | null>;
  state?: string;
  count?: number;
  dwellSeconds?: number;
  sampleCount: number;
}

export interface AggregateByFacetsResult {
  groups: AggregateRow[];
  overflow: boolean;
}

export interface TimelineByFacetInput {
  facet: { key: string; value: string };
  query?: AnalyticsFilter;
  window?: AnalyticsWindow;
  select?: { columns?: ('role' | 'subtype' | 'status')[]; facets?: string[] };
  limit?: number;
}

export interface TimelineInterval {
  role: string;
  subtype?: string | null;
  status?: string;
  facets: Record<string, string | null>;
  startedAt: string;
  endedAt: string | null;
  durationSeconds: number;
}

export interface TimelineByFacetResult {
  intervals: TimelineInterval[];
  overflow: boolean;
}

// ── Key + window helpers (exported for tests) ────────────────────────────────

/** Key-order-independent stringify so `{a,b}` and `{b,a}` share one query key. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );
}

/** The trailing window for a period: `to` = next minute boundary, `from` = to − hours. */
export function analyticsWindow(periodHours: number, now = Date.now()): AnalyticsWindow {
  const to = Math.ceil(now / 60_000) * 60_000;
  return {
    from: new Date(to - periodHours * 3_600_000).toISOString(),
    to: new Date(to).toISOString(),
  };
}

/**
 * A live trailing window that rolls forward on the minute. Without the tick a
 * quiet tab's `to` falls into the past and the server reclassifies the query
 * fully-past (10-minute cache) — a "live" board frozen for 10 minutes.
 */
export function useAnalyticsWindow(periodHours: number): AnalyticsWindow {
  const [window, setWindow] = useState(() => analyticsWindow(periodHours));
  useEffect(() => {
    setWindow(analyticsWindow(periodHours));
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      // Fire just past the minute boundary so ceil() lands on the NEXT one.
      timer = setTimeout(() => {
        setWindow(analyticsWindow(periodHours));
        schedule();
      }, 60_000 - (Date.now() % 60_000) + 250);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [periodHours]);
  return window;
}

/** 403 is a scope answer, not a transient fault — never retry it. */
function retryUnlessForbidden(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status === 403) return false;
  return failureCount < 2;
}

// ── Hooks ─────────────────────────────────────────────────────────────────────

export function useAggregateByFacets(
  input: AggregateByFacetsInput | null,
  opts?: { enabled?: boolean },
) {
  return useQuery<AggregateByFacetsResult>({
    queryKey: ['escAggregate', input ? canonicalStringify(input) : 'off'],
    queryFn: () =>
      apiFetch('/escalations/aggregate-by-facets', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    staleTime: 15_000,
    enabled: (opts?.enabled ?? true) && !!input,
    retry: retryUnlessForbidden,
  });
}

export function useTimelineByFacet(
  input: TimelineByFacetInput | null,
  opts?: { enabled?: boolean },
) {
  return useQuery<TimelineByFacetResult>({
    queryKey: ['escTimeline', input ? canonicalStringify(input) : 'off'],
    queryFn: () =>
      apiFetch('/escalations/timeline-by-facet', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    staleTime: 15_000,
    enabled: (opts?.enabled ?? true) && !!input,
    retry: retryUnlessForbidden,
  });
}

/** True when the query failed the analytics read gate (render the scope notice). */
export function isForbidden(error: unknown): boolean {
  return error instanceof ApiError && error.status === 403;
}
