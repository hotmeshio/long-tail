import { interpolateHelp } from './x-lt-help';
import type { ShowIfContext } from './x-lt-show-if';

/**
 * The embedded escalation query shape shared by `x-lt-query` (escalation-list
 * widget) and `x-lt-submit-guard.query` (form-level submit gate). String
 * values inside `facets` support `{{domain.path}}` token interpolation against
 * the host escalation's context.
 *
 * `assigned` is the ownership scope. Ownership is not a separate list — it is
 * one more dimension of the same faceted query language the escalation API
 * composes server-side ("claimed" is the implied status: pending, held, claim
 * window live):
 * - `"me"`  — rows claimed by the viewing user (the walk case: I walk what I own)
 * - `"any"` — all matching rows regardless of claim state
 * - omitted — available rows only (unclaimed, or claim window lapsed)
 */
export interface EmbedQuery {
  role?: string;
  status?: string;
  facets?: Record<string, string>;
  limit?: number;
  assigned?: 'me' | 'any';
  /** Superseded by `assigned`; honored only when `assigned` is omitted. */
  available?: boolean;
}

/** Interpolate `{{domain.path}}` tokens in every string value of the facets map. */
export function resolveQueryFacets(
  facets: Record<string, string> | undefined,
  ctx: ShowIfContext,
): Record<string, unknown> {
  if (!facets) return {};
  const resolved: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(facets)) {
    resolved[k] = typeof v === 'string' ? interpolateHelp(v, ctx) : v;
  }
  return resolved;
}

/** The escalation-query params an EmbedQuery resolves to — the exact input
 *  shape of `useEscalations`, so every embed surface queries identically. */
export interface ScopedQueryParams {
  role?: string;
  status: string;
  facets: Record<string, unknown>;
  assigned_to?: string;
  available?: boolean;
  limit?: number;
  enabled: boolean;
}

/**
 * Resolve an EmbedQuery into concrete escalation-query params — the ONE
 * mapping every embed surface (escalation-list, x-lt-actions, x-lt-submit-guard)
 * consumes, so the visible rows and any count derived from the same query can
 * never disagree.
 *
 * Ownership scope translates into the faceted query language:
 * - `assigned: "me"`  → `assigned_to = viewer AND available = false` — the
 *   implied "claimed" status (pending + live claim window held by the viewer)
 * - `assigned: "any"` → no ownership constraint
 * - omitted           → `available = true` (the unclaimed pool; a declared
 *   legacy `available` value is honored)
 */
export function resolveScopedQuery(
  query: EmbedQuery,
  ctx: ShowIfContext,
  viewerId: string | undefined,
): ScopedQueryParams {
  const facets = resolveQueryFacets(query.facets, ctx);
  const base: ScopedQueryParams = {
    role: query.role,
    status: query.status ?? 'pending',
    facets,
    limit: query.limit,
    enabled: !!(query.role || Object.keys(facets).length),
  };
  if (query.assigned === 'me') {
    // Without a viewer identity the scope cannot be evaluated — disable rather
    // than silently widen to another scope.
    return { ...base, assigned_to: viewerId, available: false, enabled: base.enabled && !!viewerId };
  }
  if (query.assigned === 'any') {
    return base;
  }
  return { ...base, available: query.available ?? true };
}
