import * as escalationService from '../../services/escalation';
import { getEscalationReadScope } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';
import type { FacetRange, FacetOrder } from '../../types';

// ── List routes ────────────────────────────────────────────────────────────

/** Faceted-query elements a human caller may add to the scoped list/available query. */
export interface FacetInput {
  roles?: string[];
  facets?: Record<string, any>;
  block?: Record<string, any>[];
  range?: FacetRange[];
  exists?: string[];
  available?: boolean;
  orderBy?: FacetOrder[];
}

/** True when the caller asked for anything the plain list path can't express. */
function hasFacetQuery(i: FacetInput): boolean {
  return !!(
    i.facets ||
    i.block?.length ||
    i.range?.length ||
    i.exists?.length ||
    i.orderBy?.length ||
    i.roles?.length ||
    i.available != null
  );
}

/**
 * List escalations with optional filters.
 *
 * Results are scoped to the authenticated user's roles unless the user
 * is a superadmin (who sees all roles).
 *
 * @param input.status — filter by `pending`, `resolved`, or `cancelled`
 * @param input.role — filter by assigned role
 * @param input.type — filter by workflow type
 * @param input.subtype — filter by subtype
 * @param input.assigned_to — filter by assigned user ID
 * @param input.priority — filter by priority (1–4)
 * @param input.limit — max results (default: 50)
 * @param input.offset — pagination offset
 * @param input.sort_by — column to sort by (e.g. `created_at`, `priority`)
 * @param input.order — `asc` or `desc`
 * @param auth — authenticated user context (required for role scoping)
 * @returns `{ status: 200, data: { escalations, total } }`
 */
export async function listEscalations(
  input: {
    status?: string;
    role?: string;
    type?: string;
    subtype?: string;
    assigned_to?: string;
    claimed?: boolean;
    priority?: number;
    limit?: number;
    offset?: number;
    sort_by?: string;
    order?: string;
    search?: string;
  } & FacetInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && scope.allRoles.length === 0 && scope.selfRoles.length === 0) {
      return { status: 200, data: { escalations: [], total: 0 } };
    }

    // Faceted path: the read-scope predicate composes with the full FacetQuery
    // language (facets/block/range/exists/metadata-sort) IN SQL — the caller's
    // role(s) can only NARROW within their scope, never widen past it.
    if (hasFacetQuery(input)) {
      const result = await escalationService.searchEscalationsFaceted({
        global: scope.global,
        visibleRoles: scope.global ? undefined : scope.allRoles,
        selfRoles: scope.global ? undefined : scope.selfRoles,
        meUserId: auth.userId,
        facet: {
          role: input.role,
          roles: input.roles,
          status: input.status,
          available: input.available ?? (input.claimed ? false : undefined),
          facets: input.facets,
          block: input.block,
          range: input.range,
          exists: input.exists,
          orderBy: input.orderBy,
        },
        type: input.type,
        subtype: input.subtype,
        priority: input.priority,
        assigned_to: input.assigned_to,
        search: input.search,
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
      });
      return { status: 200, data: result };
    }

    const result = await escalationService.listEscalations({
      status: input.status as any,
      role: input.role,
      type: input.type,
      subtype: input.subtype,
      assigned_to: input.assigned_to,
      claimed: input.claimed,
      priority: input.priority,
      limit: input.limit,
      offset: input.offset,
      sort_by: input.sort_by,
      order: input.order,
      search: input.search,
      visibleRoles: scope.global ? undefined : scope.allRoles,
      selfRoles: scope.global ? undefined : scope.selfRoles,
      meUserId: auth.userId,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List escalations available for claim (pending and not actively claimed).
 *
 * Similar to `listEscalations` but excludes escalations with active claims.
 * Scoped to the authenticated user's roles.
 *
 * @param input.role — filter by role
 * @param input.type — filter by workflow type
 * @param input.subtype — filter by subtype
 * @param input.priority — filter by priority (1–4)
 * @param input.limit — max results (default: 50)
 * @param input.offset — pagination offset
 * @param input.sort_by — column to sort by
 * @param input.order — `asc` or `desc`
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { escalations, total } }`
 */
export async function listAvailableEscalations(
  input: {
    role?: string;
    type?: string;
    subtype?: string;
    priority?: number;
    limit?: number;
    offset?: number;
    sort_by?: string;
    order?: string;
    search?: string;
  } & FacetInput,
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && scope.allRoles.length === 0 && scope.selfRoles.length === 0) {
      return { status: 200, data: { escalations: [], total: 0 } };
    }

    // Faceted path — same as listEscalations but pinned to the available pool.
    if (hasFacetQuery(input)) {
      const result = await escalationService.searchEscalationsFaceted({
        global: scope.global,
        visibleRoles: scope.global ? undefined : scope.allRoles,
        selfRoles: scope.global ? undefined : scope.selfRoles,
        meUserId: auth.userId,
        facet: {
          role: input.role,
          roles: input.roles,
          status: 'pending',
          available: true,
          facets: input.facets,
          block: input.block,
          range: input.range,
          exists: input.exists,
          orderBy: input.orderBy,
        },
        type: input.type,
        subtype: input.subtype,
        priority: input.priority,
        search: input.search,
        limit: input.limit ?? 50,
        offset: input.offset ?? 0,
      });
      return { status: 200, data: result };
    }

    const result = await escalationService.listAvailableEscalations({
      role: input.role,
      type: input.type,
      subtype: input.subtype,
      priority: input.priority,
      limit: input.limit,
      offset: input.offset,
      sort_by: input.sort_by,
      order: input.order,
      search: input.search,
      visibleRoles: scope.global ? undefined : scope.allRoles,
      selfRoles: scope.global ? undefined : scope.selfRoles,
      meUserId: auth.userId,
    });
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List the distinct top-level metadata facet KEYS visible to the caller. Powers the
 * faceted-query UI's key autocomplete — only keys that actually exist in the caller's
 * (role-scoped) escalations are offered, never description-only text.
 *
 * @returns `{ status: 200, data: { keys: string[] } }`
 */
export async function listFacetKeys(_input: unknown, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && scope.allRoles.length === 0 && scope.selfRoles.length === 0) {
      return { status: 200, data: { keys: [] } };
    }
    const keys = await escalationService.listFacetKeys({
      global: scope.global,
      visibleRoles: scope.global ? undefined : scope.allRoles,
      selfRoles: scope.global ? undefined : scope.selfRoles,
      meUserId: auth.userId,
    });
    return { status: 200, data: { keys } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List all distinct escalation type values.
 *
 * @returns `{ status: 200, data: { types: string[] } }`
 */
export async function listDistinctTypes(): Promise<LTApiResult> {
  try {
    const types = await escalationService.listDistinctTypes();
    return { status: 200, data: { types } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Get aggregate escalation statistics scoped to the user's roles.
 *
 * @param input.period — time window (`1h`, `24h`, `7d`, `30d`)
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { pending, claimed, created, resolved, by_role, by_type } }`
 */
export async function getEscalationStats(
  input: { period?: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    // Aggregate stats reflect read_all roles only. read_self memberships get the
    // single-item surface (auto user-mode), not a queue-overview dashboard, so
    // their items are deliberately not aggregated here (and not leaked in counts).
    const scope = await getEscalationReadScope(auth.userId);
    if (!scope.global && scope.allRoles.length === 0) {
      return {
        status: 200,
        data: {
          pending: 0,
          claimed: 0,
          created: 0,
          resolved: 0,
          by_role: [],
          by_type: [],
        },
      };
    }
    const stats = await escalationService.getEscalationStats(
      scope.global ? undefined : scope.allRoles,
      input.period,
    );
    return { status: 200, data: stats };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function getStationMetrics(
  input: { period?: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    // Station metrics are aggregate queue-SHAPE counts (pending/claimed/resolved
    // + jeopardy) per role — the depth of a lane, not the disclosure of any one
    // item. Membership in a role entitles you to see its shape, so this view
    // spans every role the user belongs to, including read_scope='self' roles
    // (whose per-item lists stay narrowed elsewhere). Without the selfRoles
    // union, a self-scoped operator would see an empty board on their own lanes.
    const scope = await getEscalationReadScope(auth.userId);
    const memberRoles = [...scope.allRoles, ...scope.selfRoles];
    if (!scope.global && memberRoles.length === 0) {
      return { status: 200, data: { stations: [] } };
    }
    const stations = await escalationService.getStationMetrics(
      scope.global ? undefined : memberRoles,
      input.period,
    );
    return { status: 200, data: { stations } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
