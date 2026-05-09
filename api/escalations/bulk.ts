import * as escalationService from '../../services/escalation';
import * as userService from '../../services/user';
import * as taskService from '../../services/task';
import { createClient } from '../../workers';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { validateIds, checkBulkPermission, publishBulkClaimEvents } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

// ── Bulk routes ────────────────────────────────────────────────────────────

/**
 * Release all escalation claims past their `assigned_until` deadline.
 *
 * Typically called on a maintenance schedule. Returns the count of
 * released claims.
 *
 * @returns `{ status: 200, data: { released: number } }`
 */
export async function releaseExpiredClaims(): Promise<LTApiResult> {
  try {
    const released = await escalationService.releaseExpiredClaims();
    return { status: 200, data: { released } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Update priority for one or more escalations.
 *
 * @param input.ids — array of escalation UUIDs
 * @param input.priority — new priority (1=critical, 2=high, 3=medium, 4=low)
 * @param auth — authenticated user context (admin or role-holder required)
 * @returns `{ status: 200, data: { updated: number } }`
 */
export async function updatePriority(
  input: { ids: string[]; priority: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { ids, priority } = input;
    if (!validateIds(ids)) {
      return { status: 400, error: 'ids must be a non-empty array' };
    }
    if (![1, 2, 3, 4].includes(priority)) {
      return { status: 400, error: 'priority must be 1, 2, 3, or 4' };
    }

    const perm = await checkBulkPermission(auth.userId, ids);
    if (!perm.allowed) return perm;

    const updated = await escalationService.updateEscalationsPriority(ids, priority as any);
    return { status: 200, data: { updated } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Claim multiple escalations at once for the authenticated user.
 *
 * @param input.ids — array of escalation UUIDs
 * @param input.durationMinutes — claim duration (default: 30)
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { claimed, skipped } }`
 */
export async function bulkClaim(
  input: { ids: string[]; durationMinutes?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { ids, durationMinutes } = input;
    if (!validateIds(ids)) {
      return { status: 400, error: 'ids must be a non-empty array' };
    }

    const perm = await checkBulkPermission(auth.userId, ids);
    if (!perm.allowed) return perm;

    const result = await escalationService.bulkClaimEscalations(
      ids,
      auth.userId,
      durationMinutes ?? 30,
    );

    if (result.claimed > 0) publishBulkClaimEvents(ids, auth.userId);

    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Assign multiple escalations to a specific user.
 *
 * Non-superadmin callers must verify the target user holds each
 * escalation's role. Publishes claim events for assigned items.
 *
 * @param input.ids — array of escalation UUIDs
 * @param input.targetUserId — user to assign to
 * @param input.durationMinutes — assignment duration (default: 30)
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { assigned, skipped } }`
 */
export async function bulkAssign(
  input: { ids: string[]; targetUserId: string; durationMinutes?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { ids, targetUserId, durationMinutes } = input;
    if (!validateIds(ids)) {
      return { status: 400, error: 'ids must be a non-empty array' };
    }
    if (!targetUserId || typeof targetUserId !== 'string') {
      return { status: 400, error: 'targetUserId is required' };
    }

    const perm = await checkBulkPermission(auth.userId, ids);
    if (!perm.allowed) return perm;

    // Non-superadmin: target user must hold each escalation's role
    const isSuperAdminUser = await userService.isSuperAdmin(auth.userId);
    if (!isSuperAdminUser) {
      const roles = await escalationService.getEscalationRoles(ids);
      for (const role of roles) {
        const targetHasRole = await userService.hasRole(targetUserId, role);
        if (!targetHasRole) {
          return { status: 400, error: `Target user does not hold the "${role}" role` };
        }
      }
    }

    const result = await escalationService.bulkAssignEscalations(
      ids,
      targetUserId,
      durationMinutes ?? 30,
    );

    if (result.assigned > 0) publishBulkClaimEvents(ids, targetUserId);

    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Route multiple escalations to a different role.
 *
 * @param input.ids — array of escalation UUIDs
 * @param input.targetRole — destination role
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { updated: number } }`
 */
export async function bulkEscalate(
  input: { ids: string[]; targetRole: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { ids, targetRole } = input;
    if (!validateIds(ids)) {
      return { status: 400, error: 'ids must be a non-empty array' };
    }
    if (!targetRole || typeof targetRole !== 'string') {
      return { status: 400, error: 'targetRole is required' };
    }

    const perm = await checkBulkPermission(auth.userId, ids);
    if (!perm.allowed) return perm;

    const updated = await escalationService.bulkEscalateToRole(ids, targetRole);
    return { status: 200, data: { updated } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Trigger AI triage for multiple escalations.
 *
 * Resolves each escalation and starts a triage workflow that uses MCP
 * tools to analyze and potentially auto-resolve the issue.
 *
 * @param input.ids — array of escalation UUIDs
 * @param input.hint — optional natural-language guidance for the triage AI
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { triaged, workflows } }`
 */
export async function bulkTriage(
  input: { ids: string[]; hint?: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { ids, hint } = input;
    if (!validateIds(ids)) {
      return { status: 400, error: 'ids must be a non-empty array' };
    }

    const perm = await checkBulkPermission(auth.userId, ids);
    if (!perm.allowed) return perm;

    const resolved = await escalationService.bulkResolveForTriage(ids, hint);
    const client = createClient();
    const workflowIds: string[] = [];

    for (const escalation of resolved) {
      const triageWorkflowId = await startTriageWorkflow(
        escalation,
        hint,
        auth.userId,
        client,
      );
      workflowIds.push(triageWorkflowId);
    }

    return { status: 200, data: { triaged: resolved.length, workflows: workflowIds } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// ── Triage workflow launcher (shared by bulkTriage) ────────────────────────

async function startTriageWorkflow(
  escalation: any,
  hint: string | undefined,
  userId: string | undefined,
  client: ReturnType<typeof createClient>,
): Promise<string> {
  let escalationPayload: Record<string, any> = {};
  if (escalation.escalation_payload) {
    try {
      escalationPayload = JSON.parse(escalation.escalation_payload as string);
    } catch {}
  }

  let envelope: Record<string, any> = {};
  if (escalation.envelope) {
    try {
      envelope = JSON.parse(escalation.envelope as string);
    } catch {}
  }

  const triageWorkflowId = `triage-${escalation.id}-${Date.now()}`;

  const triageEnvelope = {
    data: {
      escalationId: escalation.id,
      originId: escalation.origin_id ?? undefined,
      originalWorkflowType: escalation.workflow_type,
      originalTaskQueue: escalation.task_queue,
      originalTaskId: escalation.task_id,
      escalationPayload,
      resolverPayload: {
        _lt: { needsTriage: true, ...(hint ? { hint } : {}) },
      },
    },
    metadata: envelope.metadata || {},
    lt: { ...(envelope.lt || {}), userId },
  };

  const routing = escalation.task_id
    ? ((await taskService.getTask(escalation.task_id))?.metadata as Record<string, any> | null)
    : null;

  await taskService.createTask({
    workflow_id: triageWorkflowId,
    workflow_type: 'mcpTriage',
    lt_type: 'mcpTriage',
    task_queue: 'long-tail-system',
    signal_id: `lt-triage-${triageWorkflowId}`,
    parent_workflow_id: routing?.parentWorkflowId || triageWorkflowId,
    origin_id: escalation.origin_id || triageWorkflowId,
    parent_id: escalation.parent_id ?? undefined,
    envelope: JSON.stringify(triageEnvelope),
    metadata: routing || undefined,
  });

  await client.workflow.start({
    workflowName: 'mcpTriage',
    args: [triageEnvelope],
    taskQueue: 'long-tail-system',
    workflowId: triageWorkflowId,
    expire: JOB_EXPIRE_SECS,
    entity: 'mcpTriage',
  } as any);

  return triageWorkflowId;
}
