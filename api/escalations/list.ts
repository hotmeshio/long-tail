import * as escalationService from '../../services/escalation';
import { getVisibleRoles } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

// ── List routes ────────────────────────────────────────────────────────────

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
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles && visibleRoles.length === 0) {
      return { status: 200, data: { escalations: [], total: 0 } };
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
      visibleRoles,
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
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles && visibleRoles.length === 0) {
      return { status: 200, data: { escalations: [], total: 0 } };
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
      visibleRoles,
    });
    return { status: 200, data: result };
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
    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles && visibleRoles.length === 0) {
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
    const stats = await escalationService.getEscalationStats(visibleRoles, input.period);
    return { status: 200, data: stats };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
