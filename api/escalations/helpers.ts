import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import { publishEscalationEvent } from '../../lib/events/publish';

// ── Private helpers ────────────────────────────────────────────────────────

export async function getVisibleRoles(
  userId: string,
): Promise<string[] | undefined> {
  const isSuperAdminUser = await userService.isSuperAdmin(userId);
  if (isSuperAdminUser) return undefined;
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
  const isSuperAdminUser = await userService.isSuperAdmin(userId);
  if (isSuperAdminUser) return { allowed: true };

  const roles = await escalationService.getEscalationRoles(ids);
  for (const role of roles) {
    const canManage = await userService.isGroupAdmin(userId, role);
    if (!canManage) {
      return { allowed: false, status: 403, error: `Insufficient permissions for role "${role}"` };
    }
  }
  return { allowed: true };
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
