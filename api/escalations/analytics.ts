import * as escalationService from '../../services/escalation';
import { AnalyticsInputError } from '../../services/escalation';
import * as userService from '../../services/user';
import { getFeatureFlags } from '../../modules/features';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';
import type {
  AggregateByFacetsInput,
  AnalyticsQuery,
  TimelineByFacetInput,
} from '../../types';

// ── Escalation analytics surface (public) ────────────────────────────────────
//
// Grouped/temporal reads over the pond (membership, dwell, timeline). Reads
// only, but reads that AGGREGATE other operators' items — so the gate is the
// same broad scope the faceted search uses (read_all per requested role), with
// one extension: these queries may span roles. A caller must hold read_all on
// EVERY role in the filter; a filter with no role scope is inherently
// cross-role and requires a global principal (superadmin / admin). Results are
// principal-independent once the gate passes, which is what makes the
// service-layer cache shareable.
//
// publicPaceBoard carve-out (mirrors GET /station-metrics, list.ts): with the
// flag on, any authenticated caller may run aggregates whose group keys are
// COLUMNS only — those emit counts/seconds, the exact data class the Pace
// Board already exposes to every login. A groupBy.facets grouping emits facet
// VALUES (entity ids) as group keys and always takes the strict gate, as does
// timelineByFacet (an entity's movement history is item-level disclosure).

async function callerMayReadPonds(userId: string, roles: string[]): Promise<boolean> {
  if (await userService.hasGlobalEscalationAccess(userId)) return true;
  if (!roles.length) return false; // whole-pond / cross-role ⇒ global only
  for (const role of roles) {
    const scope = await userService.getRoleScope(userId, role);
    if (scope?.read !== 'all') return false;
  }
  return true;
}

async function effectiveRoles(query: AnalyticsQuery | undefined): Promise<string[]> {
  // `entity` scopes to its derived system — the gate covers the same roles the
  // query will actually touch. Resolution throws AnalyticsInputError (→ 400)
  // for unknown keys, before any scope decision.
  if (query?.entity) {
    return (await escalationService.resolveEntitySystem(query.entity)).map((s) => s.role);
  }
  if (query?.role) return [query.role];
  if (query?.roles?.length) return query.roles;
  return [];
}

function deniedMessage(roles: string[]): string {
  return roles.length
    ? `You must hold ${roles.map((r) => `"${r}"`).join(', ')} with full (read_all) scope or be a superadmin`
    : 'Analytics without a role filter spans every pond — a global (superadmin/admin) principal is required';
}

function failure(err: any): LTApiResult {
  if (err instanceof AnalyticsInputError) return { status: 400, error: err.message };
  return { status: 500, error: err.message };
}

/** Grouped membership/dwell aggregate over the escalation intervals. */
export async function aggregateByFacets(
  input: AggregateByFacetsInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const roles = await effectiveRoles(input?.query);
    const countsOnly = !input?.groupBy?.facets?.length;
    const publiclyReadable = countsOnly && getFeatureFlags().publicPaceBoard;
    if (!publiclyReadable && !(await callerMayReadPonds(auth.userId, roles))) {
      return { status: 403, error: deniedMessage(roles) };
    }
    const data = await escalationService.aggregateByFacets(input);
    return { status: 200, data };
  } catch (err: any) {
    return failure(err);
  }
}

/** One entity's ordered interval sequence (gap-preserving). */
export async function timelineByFacet(
  input: TimelineByFacetInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const roles = await effectiveRoles(input?.query);
    if (!(await callerMayReadPonds(auth.userId, roles))) {
      return { status: 403, error: deniedMessage(roles) };
    }
    const data = await escalationService.timelineByFacet(input);
    return { status: 200, data };
  } catch (err: any) {
    return failure(err);
  }
}
