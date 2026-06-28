import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';
import type { FacetQuery } from '../../types/facets';

// ── Faceted escalation surface (public) ──────────────────────────────────────
//
// The faceted-routing read/claim primitives, exposed on the public API so example
// workflows (and dependent projects) reach the pond the same way the dashboard,
// MCP, and CLI do — through api/, which calls services/. Faceted routing is the
// whole-pond dispatcher pattern: searching surfaces OTHER operators' items and
// claiming takes ownership of unassigned work. So the gate is the broad scope, not
// mere membership — read_all to search the pond, write_all to claim from it. A
// global principal (superadmin / admin) passes unfiltered. Self-scope members work
// only their own assigned items, through the by-id paths — not the pond surface.

async function callerMaySearchPond(userId: string, role: string): Promise<boolean> {
  if (await userService.hasGlobalEscalationAccess(userId)) return true;
  const scope = await userService.getRoleScope(userId, role);
  return scope?.read === 'all';
}

async function callerMayClaimPond(userId: string, role: string): Promise<boolean> {
  if (await userService.hasGlobalEscalationAccess(userId)) return true;
  const scope = await userService.getRoleScope(userId, role);
  return scope?.write === 'all';
}

/** Item-level faceted search over a pond, scoped to the caller's role. */
export async function searchByFacets(query: FacetQuery, auth: LTApiAuth): Promise<LTApiResult> {
  try {
    if (!query?.role) return { status: 400, error: 'role is required' };
    if (!(await callerMaySearchPond(auth.userId, query.role))) {
      return { status: 403, error: `You must hold the "${query.role}" role with full (read_all) scope or be a superadmin` };
    }
    const result = await escalationService.searchByFacets(query);
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Batch-claim complete origin groups in priority order, assigned to the calling operator. */
export async function claimGroups(
  input: { query: FacetQuery; limit?: number; durationMinutes?: number; sizeFacet?: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.query?.role) return { status: 400, error: 'role is required' };
    if (!(await callerMayClaimPond(auth.userId, input.query.role))) {
      return { status: 403, error: `You must hold the "${input.query.role}" role with claim (write_all) scope or be a superadmin` };
    }
    const groups = await escalationService.claimGroups(input.query, auth.userId, {
      limit: input.limit,
      durationMinutes: input.durationMinutes,
      sizeFacet: input.sizeFacet,
    });
    return { status: 200, data: { groups } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/** Batch-claim individual rows (FOR UPDATE SKIP LOCKED), assigned to the calling operator. */
export async function claimByFacets(
  input: { query: FacetQuery; limit?: number; durationMinutes?: number; allOrNone?: boolean },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.query?.role) return { status: 400, error: 'role is required' };
    if (!(await callerMayClaimPond(auth.userId, input.query.role))) {
      return { status: 403, error: `You must hold the "${input.query.role}" role with claim (write_all) scope or be a superadmin` };
    }
    const claimed = await escalationService.claimByFacets(input.query, auth.userId, {
      limit: input.limit,
      durationMinutes: input.durationMinutes,
      allOrNone: input.allOrNone,
    });
    return { status: 200, data: { claimed } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
