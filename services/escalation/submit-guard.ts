/**
 * Server-side enforcement of the `x-lt-submit-guard` query precondition — the
 * API-first counterpart of the dashboard's `useSubmitGuard`. Before an
 * escalation resolves, if its form schema declares a submit guard, the same
 * embedded query runs and the resolve is REJECTED while it still returns rows.
 *
 * Isomorphism with the dashboard is exact: the guard reuses `resolveScopedQuery`
 * (the mapping the escalation-list embed uses) and runs it through
 * `searchEscalationsFaceted` — the same faceted query the list API composes.
 *
 * Two deliberate rules:
 *  - The count is taken with `global: true`, bypassing the resolver's read
 *    scope, so a role that cannot SEE the children can never falsely clear the
 *    gate. Only a real, empty result count clears it (the "403 ≠ empty" rule).
 *  - A guard whose scope cannot be evaluated (e.g. `assigned:'me'` on a surface
 *    with no resolving user, like an MCP resolve) is skipped here; the consuming
 *    workflow's own verification remains the durable backstop.
 */
import {
  readSubmitGuard,
  resolveScopedQuery,
  interpolateHelp,
  SUBMIT_GUARD_DEFAULT_MESSAGE,
  type ShowIfContext,
} from '../../shared/form-validation';
import { searchEscalationsFaceted } from './queries';
import type { LTFieldViolation } from '../../types/validation';

/** The synthetic violation field for a guard rejection — not a form field. */
export const SUBMIT_GUARD_VIOLATION_FIELD = '_submitGuard';

/**
 * Returns a violation when the escalation's submit guard still matches rows, or
 * null when there is no guard, its scope is inert, or the query is confirmed
 * empty. The context carries the escalation domains the query facets and the
 * message interpolate against.
 */
export async function checkSubmitGuard(
  schema: Record<string, any> | null | undefined,
  ctx: ShowIfContext,
  resolvingUserId: string | undefined,
): Promise<LTFieldViolation | null> {
  const guard = readSubmitGuard(schema);
  if (!guard || guard.mustBeEmpty === false) return null;

  const scoped = resolveScopedQuery(guard.query, ctx, resolvingUserId);
  if (!scoped.enabled) return null;

  const { total } = await searchEscalationsFaceted({
    global: true,
    facet: {
      role: scoped.role,
      status: scoped.status,
      available: scoped.available,
      facets: scoped.facets as Record<string, any>,
    },
    assigned_to: scoped.assigned_to,
    limit: 1,
    offset: 0,
  });
  if (total <= 0) return null;

  const template = guard.message ?? SUBMIT_GUARD_DEFAULT_MESSAGE;
  const message = interpolateHelp(template.replace(/\{\{count\}\}/g, String(total)), ctx);
  return { field: SUBMIT_GUARD_VIOLATION_FIELD, message };
}
