import { useEscalations } from '../api/escalations';
import { interpolateHelp } from '../lib/x-lt-help';
import { resolveQueryFacets, type EmbedQuery } from '../lib/x-lt-query';
import type { ShowIfContext } from '../lib/x-lt-show-if';

/**
 * The `x-lt-submit-guard` form_schema token — a UI-honesty gate on the resolve
 * button. While the embedded query still returns rows, the submit stays
 * disabled and `message` renders beside it with the live count; the moment the
 * last row resolves, the existing socket-invalidation path refires the query
 * and the button lights up. No polling.
 *
 * This is a UI layer only: the consuming workflow's own verification (reject
 * and re-park with the remainder) remains the durable backstop for resolves
 * arriving through the raw API.
 *
 * Schema usage (top-level, a peer of `x-lt-help`):
 *   "x-lt-submit-guard": {
 *     "query": { "role": "print-harvest", "status": "pending",
 *                "facets": { "walkId": "{{metadata.walkId}}" } },
 *     "mustBeEmpty": true,
 *     "message": "{{count}} plates still pending — bag them before closing the walk."
 *   }
 */
export interface SubmitGuardDef {
  query: EmbedQuery;
  /** The gate condition; defaults to true (the only supported mode today). */
  mustBeEmpty?: boolean;
  /** Shown beside the disabled submit. `{{count}}` and `{{domain.path}}` tokens interpolate. */
  message?: string;
}

const DEFAULT_MESSAGE = '{{count}} related items are still pending';

export function useSubmitGuard(
  guard: SubmitGuardDef | undefined,
  ctx: ShowIfContext | undefined,
): { blocked: boolean; count: number; message: string } {
  const query = guard?.query;
  const resolvedFacets = resolveQueryFacets(query?.facets, ctx ?? {});

  const { data } = useEscalations({
    role: query?.role,
    status: query?.status ?? 'pending',
    facets: resolvedFacets,
    limit: 1, // the gate needs only the total; rows are irrelevant
    enabled: !!guard && !!(query?.role || Object.keys(resolvedFacets).length),
  });

  const count = data?.total ?? 0;
  const blocked = !!guard && guard.mustBeEmpty !== false && count > 0;

  // {{count}} is a local token — substitute it BEFORE the domain pass, which
  // replaces unknown domains with the missing-value dash.
  const template = guard?.message ?? DEFAULT_MESSAGE;
  const message = blocked
    ? interpolateHelp(template.replace(/\{\{count\}\}/g, String(count)), ctx ?? {})
    : '';

  return { blocked, count, message };
}
