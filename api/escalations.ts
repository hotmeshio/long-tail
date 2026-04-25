import * as escalationService from '../services/escalation';
import * as userService from '../services/user';
import * as roleService from '../services/role';
import * as taskService from '../services/task';
import { publishEscalationEvent } from '../lib/events/publish';
import { escalationStrategyRegistry } from '../services/escalation-strategy';
import { storeEphemeral, formatEphemeralToken } from '../services/iam/ephemeral';
import { getEngine as getYamlEngine } from '../services/yaml-workflow/deployer';
import { createClient } from '../workers';
import { JOB_EXPIRE_SECS } from '../modules/defaults';
import type { LTApiResult, LTApiAuth } from '../types/sdk';

// ── Private helpers ────────────────────────────────────────────────────────

async function getVisibleRoles(
  userId: string,
): Promise<string[] | undefined> {
  const isSuperAdminUser = await userService.isSuperAdmin(userId);
  if (isSuperAdminUser) return undefined;
  const userRoles = await userService.getUserRoles(userId);
  return userRoles.map((r) => r.role);
}

function validateIds(ids: unknown): ids is string[] {
  return Array.isArray(ids) && ids.length > 0;
}

async function checkBulkPermission(
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

function publishBulkClaimEvents(ids: string[], assignedTo: string): void {
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

// ── List routes ────────────────────────────────────────────────────────────

export async function listEscalations(
  input: {
    status?: string;
    role?: string;
    type?: string;
    subtype?: string;
    assigned_to?: string;
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

export async function listDistinctTypes(): Promise<LTApiResult> {
  try {
    const types = await escalationService.listDistinctTypes();
    return { status: 200, data: { types } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

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

// ── Single-escalation routes ───────────────────────────────────────────────

export async function getEscalation(
  input: { id: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const escalation = await escalationService.getEscalation(input.id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }

    const isSuperAdminUser = await userService.isSuperAdmin(auth.userId);
    if (!isSuperAdminUser) {
      const userHasRole = await userService.hasRole(auth.userId, escalation.role);
      if (!userHasRole) {
        return { status: 403, error: 'Not authorized to view this escalation' };
      }
    }

    return { status: 200, data: escalation };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

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

export async function claimEscalation(
  input: { id: string; durationMinutes?: number },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, durationMinutes } = input;

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }

    const isSuperAdminUser = await userService.isSuperAdmin(auth.userId);
    if (!isSuperAdminUser) {
      const userHasRole = await userService.hasRole(auth.userId, escalation.role);
      if (!userHasRole) {
        return {
          status: 403,
          error: `You must have the "${escalation.role}" role to claim this escalation`,
        };
      }
    }

    const result = await escalationService.claimEscalation(id, auth.userId, durationMinutes);
    if (!result) {
      return { status: 409, error: 'Escalation not available for claim' };
    }

    publishEscalationEvent({
      type: 'escalation.claimed',
      source: 'api',
      workflowId: escalation.workflow_id || '',
      workflowName: escalation.workflow_type || '',
      taskQueue: escalation.task_queue || '',
      escalationId: id,
      status: 'claimed',
      data: { assigned_to: auth.userId },
    });

    return { status: 200, data: result };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

export async function releaseEscalation(
  input: { id: string },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const result = await escalationService.releaseEscalation(input.id, auth.userId);
    if (!result) {
      return { status: 409, error: 'Escalation not found or not claimed by you' };
    }

    publishEscalationEvent({
      type: 'escalation.released',
      source: 'api',
      workflowId: result.workflow_id || '',
      workflowName: result.workflow_type || '',
      taskQueue: result.task_queue || '',
      escalationId: input.id,
      status: 'released',
      data: { released_by: auth.userId },
    });

    return { status: 200, data: { escalation: result } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// ── Bulk routes ────────────────────────────────────────────────────────────

export async function releaseExpiredClaims(): Promise<LTApiResult> {
  try {
    const released = await escalationService.releaseExpiredClaims();
    return { status: 200, data: { released } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

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

// ── Resolve route ──────────────────────────────────────────────────────────

export async function resolveEscalation(
  input: { id: string; resolverPayload: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, resolverPayload } = input;
    if (!resolverPayload) {
      return { status: 400, error: 'resolverPayload is required' };
    }

    // 1. Read escalation (verify pending)
    const escalation = await escalationService.getEscalation(id);
    if (!escalation) {
      return { status: 404, error: 'Escalation not found' };
    }
    if (escalation.status !== 'pending') {
      return { status: 409, error: 'Escalation not available for resolution' };
    }

    // 2. waitFor signal escalation -- signal the paused workflow directly
    const signalRouting = (escalation.metadata as any)?.signal_routing;
    if (signalRouting?.signalId) {
      // Replace password fields with ephemeral tokens so plaintext never enters the signal store
      let signalPayload = resolverPayload;
      const formSchema = (escalation.metadata as any)?.form_schema;
      if (formSchema?.properties) {
        signalPayload = { ...resolverPayload };
        for (const [key, def] of Object.entries(formSchema.properties)) {
          if ((def as any)?.format === 'password' && typeof signalPayload[key] === 'string') {
            const uuid = await storeEphemeral(signalPayload[key], {
              ttlSeconds: 900,
              label: key,
            });
            signalPayload[key] = formatEphemeralToken(uuid, key);
          }
        }
      }

      if (signalRouting.engine === 'yaml' && signalRouting.hookTopic && signalRouting.appId) {
        const engine = await getYamlEngine(signalRouting.appId);
        await engine.signal(signalRouting.hookTopic, {
          ...signalPayload,
          escalationId: escalation.id,
          job_id: signalRouting.jobId,
        });
      } else if (signalRouting.workflowId) {
        const client = createClient();
        const handle = await client.workflow.getHandle(
          signalRouting.taskQueue,
          signalRouting.workflowType,
          signalRouting.workflowId,
        );
        await handle.signal(signalRouting.signalId, signalPayload);
      }

      await escalationService.resolveEscalation(escalation.id, resolverPayload);

      publishEscalationEvent({
        type: 'escalation.resolved',
        source: 'api',
        workflowId: escalation.workflow_id || signalRouting.workflowId,
        workflowName: escalation.workflow_type || signalRouting.workflowType,
        taskQueue: escalation.task_queue || signalRouting.taskQueue || signalRouting.appId,
        taskId: escalation.task_id!,
        escalationId: escalation.id,
        originId: escalation.origin_id ?? undefined,
        status: 'resolved',
      });

      return {
        status: 200,
        data: {
          signaled: true,
          escalationId: escalation.id,
          workflowId: signalRouting.workflowId || signalRouting.appId,
        },
      };
    }

    // 3. Reconstruct the original envelope from the escalation or task
    let envelope: Record<string, any> = {};
    if (escalation.envelope) {
      try {
        envelope = JSON.parse(escalation.envelope);
      } catch { /* use empty */ }
    } else if (escalation.task_id) {
      const task = await taskService.getTask(escalation.task_id);
      if (task?.envelope) {
        try {
          envelope = JSON.parse(task.envelope);
        } catch { /* use empty */ }
      }
    }

    // 4. Check escalation strategy for triage routing
    const strategy = escalationStrategyRegistry.current;
    if (strategy) {
      const directive = await strategy.onResolution({
        escalation,
        resolverPayload,
        envelope,
      });

      if (directive.action === 'triage') {
        const originalTask = escalation.task_id
          ? await taskService.getTask(escalation.task_id)
          : null;
        const routing = originalTask?.metadata as Record<string, any> | null;

        const triageWorkflowId = `triage-${escalation.id}-${Date.now()}`;
        const client = createClient();

        await taskService.createTask({
          workflow_id: triageWorkflowId,
          workflow_type: 'mcpTriageRouter',
          lt_type: 'mcpTriage',
          task_queue: 'long-tail-system',
          signal_id: `lt-triage-${triageWorkflowId}`,
          parent_workflow_id: triageWorkflowId,
          origin_id: escalation.origin_id || triageWorkflowId,
          parent_id: escalation.parent_id ?? undefined,
          envelope: JSON.stringify(directive.triageEnvelope),
        });

        await client.workflow.start({
          workflowName: 'mcpTriageRouter',
          args: [directive.triageEnvelope],
          taskQueue: 'long-tail-system',
          workflowId: triageWorkflowId,
          expire: JOB_EXPIRE_SECS,
          entity: 'mcpTriageRouter',
        } as any);

        await escalationService.resolveEscalation(escalation.id, {
          ...resolverPayload,
          _lt: { ...resolverPayload._lt, triaged: true, triageWorkflowId },
        });

        publishEscalationEvent({
          type: 'escalation.resolved',
          source: 'api',
          workflowId: escalation.workflow_id!,
          workflowName: escalation.workflow_type!,
          taskQueue: escalation.task_queue!,
          taskId: escalation.task_id!,
          escalationId: escalation.id,
          originId: escalation.origin_id ?? undefined,
          status: 'resolved',
        });

        return {
          status: 200,
          data: {
            started: true,
            escalationId: escalation.id,
            workflowId: triageWorkflowId,
            triage: true,
          },
        };
      }
    }

    // 5. If no workflow_type, this is a notification-only escalation -- acknowledge and close
    if (!escalation.workflow_type || !escalation.task_queue) {
      await escalationService.resolveEscalation(escalation.id, resolverPayload);
      return { status: 200, data: { acknowledged: true, escalationId: escalation.id } };
    }

    // 6. Standard re-run: inject resolver data and start original workflow
    envelope.resolver = resolverPayload;
    envelope.lt = {
      ...envelope.lt,
      escalationId: escalation.id,
    };

    const newWorkflowId = `rerun-${escalation.id}-${Date.now()}`;
    const client = createClient();

    await client.workflow.start({
      workflowName: escalation.workflow_type,
      args: [envelope],
      taskQueue: escalation.task_queue,
      workflowId: newWorkflowId,
      expire: 180,
    });

    publishEscalationEvent({
      type: 'escalation.resolved',
      source: 'api',
      workflowId: escalation.workflow_id!,
      workflowName: escalation.workflow_type!,
      taskQueue: escalation.task_queue!,
      taskId: escalation.task_id!,
      escalationId: escalation.id,
      originId: escalation.origin_id ?? undefined,
      status: 'resolved',
    });

    return {
      status: 200,
      data: { started: true, escalationId: escalation.id, workflowId: newWorkflowId },
    };
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
