import { interpolateHelp } from './x-lt-help';
import type { ShowIfContext } from './x-lt-show-if';

/**
 * The embedded escalation query shape shared by `x-lt-query` (escalation-list
 * widget) and `x-lt-submit-guard.query` (form-level submit gate). String
 * values inside `facets` support `{{domain.path}}` token interpolation against
 * the host escalation's context.
 */
export interface EmbedQuery {
  role?: string;
  status?: string;
  facets?: Record<string, string>;
  limit?: number;
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
