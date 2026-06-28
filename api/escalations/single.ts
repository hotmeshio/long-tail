import * as escalationService from '../../services/escalation';
import * as roleService from '../../services/role';
import { assertReadAccess, assertQueueManageAccess } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

// ── Single-escalation routes ───────────────────────────────────────────────

/**
 * Get a single escalation by ID.
 *
 * Non-superadmin users must hold the escalation's assigned role.
 *
 * @param input.id — escalation UUID
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: <escalation record> }` or 403/404
 */
export async function getEscalation(
  input: { id: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const escalation = await escalationService.getEscalation(input.id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }

    const denied = await assertReadAccess(auth.userId, escalation);
    if (denied) return denied;

    return { status: 200, data: escalation };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * List all escalations for a given workflow ID.
 *
 * @param input.workflowId — HotMesh workflow ID
 * @returns `{ status: 200, data: { escalations } }`
 */
export async function getEscalationsByWorkflowId(
  input: { workflowId: string },
): Promise<LTApiResult> {
  try {
    const escalations = await escalationService.getEscalationsByWorkflowId(input.workflowId);
    return { status: 200, data: { escalations } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Route a pending escalation to a different role.
 *
 * The user must be authorized to escalate from the current role to the
 * target role (checked via escalation chain configuration).
 *
 * @param input.id — escalation UUID
 * @param input.targetRole — destination role
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: <updated escalation> }` or 403/404/409
 */
export async function escalateToRole(
  input: { id: string; targetRole: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, targetRole } = input;

    if (!targetRole || typeof targetRole !== 'string') {
      return { status: 400, error: 'targetRole is required' };
    }

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }
    if (escalation.status !== 'pending') {
      return { status: 409, error: 'Escalation is not pending' };
    }

    // Escalating routes the item to another role — a queue-management verb that
    // self-scope owners and read-only members may not perform.
    const manageDenied = await assertQueueManageAccess(auth.userId, escalation.role);
    if (manageDenied) return manageDenied;

    const canEscalate = await roleService.canEscalateTo(auth.userId, escalation.role, targetRole);
    if (!canEscalate) {
      return { status: 403, error: 'Not authorized to escalate to this role' };
    }

    const updated = await escalationService.escalateToRole(id, targetRole);
    if (!updated) {
      return { status: 409, error: 'Escalation could not be updated' };
    }

    return { status: 200, data: updated };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}
