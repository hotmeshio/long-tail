/**
 * x-lt-submit-guard — a query precondition on the resolve. A form_schema may
 * declare, at its root, that the escalation cannot be resolved while an embedded
 * escalation query still returns rows: the parent references a set of children
 * (commonly claimed by the same person) that must all be completed first, a
 * to-do list that empties as children resolve.
 *
 *   "x-lt-submit-guard": {
 *     "query": { "role": "print-harvest", "status": "pending",
 *                "assigned": "me",
 *                "facets": { "walkId": "{{metadata.walkId}}" } },
 *     "mustBeEmpty": true,               // the only mode today; defaults true
 *     "message": "{{count}} plates still pending — bag them before closing.",
 *     "autoResolveWhenEmpty": true       // auto-submit the parent once empty
 *   }
 *
 * The gate is isomorphic. The dashboard disables the submit while the query
 * returns rows (UI honesty), and the API layer enforces the same precondition
 * for `enforce_schema` roles so a raw-API resolve is rejected too. Only a
 * confirmed empty result (a successful read with zero rows) clears the gate — a
 * 403 or any error never does.
 *
 * `autoResolveWhenEmpty` closes the loop: the moment the query is confirmed
 * empty, the claimed parent auto-submits — checked on page-load and after each
 * inline child-resolve — so a set of escalations completes with no extra click.
 */
import type { EmbedQuery } from './x-lt-query';

export const X_LT_SUBMIT_GUARD = 'x-lt-submit-guard';

export interface SubmitGuardDef {
  query: EmbedQuery;
  /** The gate condition; defaults to true (the only supported mode today). */
  mustBeEmpty?: boolean;
  /** Shown beside the disabled submit. `{{count}}` and `{{domain.path}}` tokens interpolate. */
  message?: string;
  /** When true, auto-submit the claimed parent the moment the query is confirmed empty. */
  autoResolveWhenEmpty?: boolean;
}

export const SUBMIT_GUARD_DEFAULT_MESSAGE = '{{count}} related items are still pending';

/** The schema's submit-guard, or undefined when it declares none. */
export function readSubmitGuard(
  schema: Record<string, unknown> | null | undefined,
): SubmitGuardDef | undefined {
  const raw = schema?.[X_LT_SUBMIT_GUARD];
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const guard = raw as SubmitGuardDef;
  if (!guard.query || typeof guard.query !== 'object') return undefined;
  return guard;
}

/**
 * Whether a guard blocks the resolve given the query's row count. `mustBeEmpty`
 * defaults to true, so any matching row blocks. A pure decision — the caller
 * supplies the count from a confirmed read (never an error/loading state).
 */
export function guardBlocks(count: number, guard: SubmitGuardDef | undefined): boolean {
  return !!guard && guard.mustBeEmpty !== false && count > 0;
}
