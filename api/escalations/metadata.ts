import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { getVisibleRoles, resolveAssignee } from './helpers';
import type { LTApiAuth, LTApiResult } from '../../types/sdk';

/**
 * Find escalations by a metadata key-value pair.
 *
 * Single query with window function for count. Results are
 * RBAC-scoped to the caller's visible roles.
 */
export async function findByMetadata(
  input: { key: string; value: string; status?: string; limit?: number; offset?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }
    const result = await escalationService.findByMetadata(
      input.key, input.value, input.status, input.limit, input.offset,
    );
    // RBAC: scope to visible roles
    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles) {
      const roleSet = new Set(visibleRoles);
      result.escalations = result.escalations.filter(e => roleSet.has(e.role));
      result.total = result.escalations.length;
    }
    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Claim an escalation by metadata key-value pair.
 *
 * Single atomic query. RBAC is enforced in the SQL WHERE clause —
 * if the caller doesn't have an allowed role, zero rows match and
 * the claim never happens. No pre-flight find, no TOCTOU.
 */
export async function claimByMetadata(
  input: { key: string; value: string; durationMinutes?: number; assignee?: string; metadata?: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }

    const resolved = await resolveAssignee(input.assignee, auth);
    if ('error' in resolved) return resolved.error;
    const claimUserId = resolved.userId;

    // Resolve allowed roles: null = global access (no filter), string[] = scoped
    const allowedRoles = await resolveAllowedRoles(auth.userId);

    const result = await escalationService.claimByMetadata(
      input.key, input.value, claimUserId, input.durationMinutes,
      input.metadata, allowedRoles,
    );

    if (!result) {
      // No rows matched. Check if candidates existed (role mismatch vs no match).
      return { status: 404, error: 'No pending escalation found for this metadata' };
    }

    if (result.candidatesExist > 0 && !result.escalation) {
      return { status: 403, error: 'Escalation exists but your roles do not permit claiming it' };
    }

    return { status: 200, data: { escalation: result.escalation, isExtension: result.isExtension } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Resolve an escalation by metadata key-value pair.
 *
 * Single atomic CTE: find + claim + resolve in one query.
 * RBAC is enforced in the SQL WHERE clause.
 */
export async function resolveByMetadata(
  input: { key: string; value: string; resolverPayload: Record<string, any>; assignee?: string; metadata?: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    if (!input.key || !input.value) {
      return { status: 400, error: 'key and value are required' };
    }
    if (!input.resolverPayload) {
      return { status: 400, error: 'resolverPayload is required' };
    }

    const resolved = await resolveAssignee(input.assignee, auth);
    if ('error' in resolved) return resolved.error;
    const resolveUserId = resolved.userId;

    const allowedRoles = await resolveAllowedRoles(auth.userId);

    const escalation = await escalationService.resolveByMetadataAtomic(
      input.key, input.value, resolveUserId,
      input.resolverPayload, input.metadata, allowedRoles,
    );

    if (!escalation) {
      return { status: 404, error: 'No pending escalation found for this metadata, or insufficient role permissions' };
    }

    return { status: 200, data: { escalation } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the set of roles the caller is allowed to act on.
 * Returns null for global access (superadmin/admin), or string[] for scoped users.
 */
async function resolveAllowedRoles(userId: string): Promise<string[] | null> {
  if (await userService.hasGlobalEscalationAccess(userId)) return null;
  const userRoles = await userService.getUserRoles(userId);
  return userRoles.map(r => r.role);
}
