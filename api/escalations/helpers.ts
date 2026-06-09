import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { publishEscalationEvent } from '../../lib/events/publish';

// ── Private helpers ────────────────────────────────────────────────────────

// Re-export from service layer for use by escalation API modules
export { hasGlobalEscalationAccess } from '../../services/user';

export async function getVisibleRoles(
  userId: string,
): Promise<string[] | undefined> {
  if (await userService.hasGlobalEscalationAccess(userId)) return undefined;
  const userRoles = await userService.getUserRoles(userId);
  return userRoles.map((r) => r.role);
}

export function validateIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0;
}

export async function checkBulkPermission(
  userId: string,
  ids: string[],
): Promise<{ allowed: true } | { allowed: false; status: 403; error: string }> {
  if (await userService.hasGlobalEscalationAccess(userId)) return { allowed: true };

  const roles = await escalationService.getEscalationRoles(ids);
  if (!roles.length) return { allowed: true };

  // Single batched query instead of N+1 loop
  const canManageAll = await userService.hasRolesAsAdmin(userId, roles);
  if (!canManageAll) {
    return { allowed: false, status: 403, error: 'Insufficient permissions for one or more escalation roles' };
  }
  return { allowed: true };
}

/**
 * Identity to provision when the assignee doesn't exist in lt_users
 * or lacks the required role. Only honored for callers with global
 * escalation access (superadmin, admin/admin).
 */
export interface ProvisionIfAbsent {
  displayName?: string;
  email?: string;
  roles?: Array<{ role: string; type?: string }>;
}

/**
 * Resolve an optional assignee external_id to an internal userId.
 * When omitted, returns the caller's userId from auth.
 *
 * When `provisionIfAbsent` is provided and the caller has global access,
 * the user is JIT-provisioned if absent and roles are ensured. This avoids
 * pre-flight queries — the happy path (user exists) is one lookup.
 */
export async function resolveAssignee(
  assignee: string | undefined,
  auth: { userId: string },
  provisionIfAbsent?: ProvisionIfAbsent,
): Promise<{ userId: string } | { error: { status: number; error: string } }> {
  if (!assignee) return { userId: auth.userId };

  // Happy path: user exists
  const user = await userService.getUserByExternalId(assignee);
  if (user) return { userId: user.id };

  // User not found — provision if caller has authority and flag is set
  if (!provisionIfAbsent) {
    return { error: { status: 404, error: `User not found for external_id: ${assignee}` } };
  }

  const hasAuthority = await userService.hasGlobalEscalationAccess(auth.userId);
  if (!hasAuthority) {
    return { error: { status: 403, error: 'Only superadmin or admin can provision users on claim' } };
  }

  // Provision the user
  const created = await userService.createUser({
    external_id: assignee,
    display_name: provisionIfAbsent.displayName || assignee,
    email: provisionIfAbsent.email,
    roles: (provisionIfAbsent.roles || []).map((r) => ({
      role: r.role,
      type: (r.type || 'member') as 'superadmin' | 'admin' | 'member',
    })),
  });

  return { userId: created.id };
}

/**
 * Ensure a user has the required role for an escalation.
 * Called after claim when the atomic SQL returns null due to role mismatch.
 * Only adds the role if `provisionIfAbsent` declares it and caller has authority.
 */
export async function ensureRoleMembership(
  userId: string,
  requiredRole: string,
  callerUserId: string,
  provisionIfAbsent?: ProvisionIfAbsent,
): Promise<boolean> {
  if (!provisionIfAbsent) return false;

  const hasAuthority = await userService.hasGlobalEscalationAccess(callerUserId);
  if (!hasAuthority) return false;

  // Check if the provision declares this role
  const declaredRole = provisionIfAbsent.roles?.find((r) => r.role === requiredRole);
  if (!declaredRole) return false;

  // Add the role — idempotent (ON CONFLICT DO NOTHING)
  try {
    await userService.addUserRole(userId, requiredRole, (declaredRole.type || 'member') as 'superadmin' | 'admin' | 'member');
  } catch { /* already has it */ }
  return true;
}

export function publishBulkClaimEvents(ids: string[], assignedTo: string): void {
  for (const id of ids) {
    publishEscalationEvent({
      type: 'escalation.claimed',
      source: 'api',
      workflowId: '',
      workflowName: '',
      taskQueue: '',
      escalationId: id,
      status: 'claimed',
      data: { assigned_to: assignedTo, bulk: true },
    });
  }
}
