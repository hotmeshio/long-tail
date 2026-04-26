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

// ── Create ────────────────────────────────────────────────────────────────

/**
 * Create a standalone escalation (not tied to a workflow).
 *
 * Useful for manual work items, support tickets, or approval requests
 * that originate outside the durable workflow engine. The caller must
 * hold the target role or be a superadmin.
 *
 * @param input.type — escalation category (e.g. `"support"`, `"approval"`)
 * @param input.subtype — subcategory for finer routing
 * @param input.role — role responsible for resolving this escalation
 * @param input.description — human-readable summary
 * @param input.priority — 1 (critical) through 4 (low), default 2
 * @param input.envelope — serialized context for the resolver
 * @param input.metadata — arbitrary key-value data (e.g. signal_routing)
 * @param input.escalation_payload — serialized payload for the resolver UI
 * @param auth — authenticated user context (must hold target role or be superadmin)
 * @returns `{ status: 201, data: <escalation record> }`
 */
export async function createEscalation(
  input: {
    type: string;
    subtype?: string;
    role: string;
    description?: string;
    priority?: number;
    envelope?: string;
    metadata?: Record<string, any>;
    escalation_payload?: string;
  },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { type, role } = input;
    if (!type || typeof type !== 'string') {
      return { status: 400, error: 'type is required' };
    }
    if (!role || typeof role !== 'string') {
      return { status: 400, error: 'role is required' };
    }

    // RBAC: caller must hold the target role or be superadmin
    const isSuperAdminUser = await userService.isSuperAdmin(auth.userId);
    if (!isSuperAdminUser) {
      const userHasRole = await userService.hasRole(auth.userId, role);
      if (!userHasRole) {
        return { status: 403, error: `You must hold the "${role}" role or be a superadmin to create escalations for it` };
      }
    }

    const escalation = await escalationService.createEscalation({
      type,
      subtype: input.subtype ?? type,
      description: input.description,
      priority: input.priority,
      role,
      envelope: input.envelope ?? '{}',
      metadata: input.metadata,
      escalation_payload: input.escalation_payload,
    });

    publishEscalationEvent({
      type: 'escalation.created',
      source: 'api',
      workflowId: '',
      workflowName: '',
      taskQueue: '',
      escalationId: escalation.id,
      status: 'pending',
      data: { type: input.type, role },
    });

    return { status: 201, data: escalation };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

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

/**
 * Claim a pending escalation for the authenticated user.
 *
 * Sets `assigned_to` and `assigned_until` on the escalation (soft lock).
 * Non-superadmin users must hold the escalation's role. Publishes a
 * `escalation.claimed` event.
 *
 * @param input.id — escalation UUID
 * @param input.durationMinutes — claim duration (default: 30)
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { escalation, isExtension } }` or 403/404/409
 */
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

/**
 * Release a claimed escalation back to the pool.
 *
 * Only the user who holds the claim can release it. Publishes a
 * `escalation.released` event.
 *
 * @param input.id — escalation UUID
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { escalation } }` or 409
 */
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

// ── Resolve route ──────────────────────────────────────────────────────────

/**
 * Resolve a pending escalation with a human-provided payload.
 *
 * Handles two resolution paths:
 * 1. **Signal-routed** — if the escalation has `signal_routing` metadata,
 *    the resolver payload is sent directly to the paused workflow via
 *    `handle.signal()`. Supports both Durable and YAML engines.
 * 2. **Re-run** — the original workflow is re-started with the resolver
 *    payload injected into `envelope.resolver`. The interceptor detects
 *    the re-run and skips to the resolution branch.
 *
 * Password fields in the resolver payload are replaced with ephemeral
 * tokens (15-minute TTL) so plaintext never enters the signal store.
 *
 * Supports optional escalation strategy execution after resolution.
 *
 * @param input.id — escalation UUID
 * @param input.resolverPayload — human decision data
 * @param auth — authenticated user context
 * @returns `{ status: 200, data: { signaled, escalationId, workflowId } }` (signal path)
 *          or `{ status: 200, data: { workflowId, resumed, escalationId } }` (re-run path)
 */
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
