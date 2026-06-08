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
 * Resolve an optional assignee external_id to an internal userId.
 * When omitted, returns the caller's userId from auth.
 */
export async function resolveAssignee(
  assignee: string | undefined,
  auth: { userId: string },
): Promise<{ userId: string } | { error: { status: number; error: string } }> {
  if (!assignee) return { userId: auth.userId };
  const user = await userService.getUserByExternalId(assignee);
  if (!user) {
    return { error: { status: 404, error: `User not found for external_id: ${assignee}` } };
  }
  return { userId: user.id };
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
