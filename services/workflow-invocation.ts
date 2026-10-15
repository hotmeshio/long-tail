/**
 * Workflow invocation service.
 *
 * Encapsulates the business logic for starting a workflow by type:
 * config lookup, role/scope enforcement, principal resolution,
 * envelope building, and Durable client start.
 *
 * Transport-agnostic — called by HTTP routes, CLI, or other transports.
 */

import { Durable } from '@hotmeshio/hotmesh';
import { canInvokeWorkflow, mayActAs, SYSTEM_AUTHORITY_WORKFLOWS, type InvocationRoleGrant } from './invocation-access';
import { isUuid } from '../lib/uuid';

import { createClient } from '../workers';
import * as configService from './config';
import * as userService from './user';
import { JOB_EXPIRE_SECS } from '../modules/defaults';
import { getRegisteredWorkers } from './workers/registry';
import { resolvePrincipal } from './iam/principal';
import type { LTEnvelope } from '../types';

// ── Public types ────────────────────────────────────────────────────────────

export interface InvocationAuthContext {
  /** JWT or API-key userId (external_id or UUID). */
  userId: string;
  /** High-level role from auth middleware (e.g. 'admin', 'superadmin'). */
  role?: string;
  /** Bot API key scopes (empty for human JWTs). */
  scopes?: string[];
}

export interface InvokeWorkflowInput {
  workflowType: string;
  data: Record<string, any>;
  metadata?: Record<string, any>;
  /** Per-request execute_as override (admin-only). */
  executeAs?: string;
  /**
   * Passthrough options forwarded to `Durable.Client.workflow.start()`.
   * Any WorkflowOptions field (workflowId, expire, entity, namespace,
   * search, signalIn, pending, etc.) can be set here. The service
   * applies defaults for workflowId, expire, entity, taskQueue, and
   * workflowName when not provided.
   *
   * @see https://docs.hotmesh.io/types/types_durable.WorkflowOptions.html
   */
  options?: Record<string, any>;
  auth: InvocationAuthContext;
}

export interface InvokeWorkflowResult {
  workflowId: string;
}

// ── Error types ─────────────────────────────────────────────────────────────

export class InvocationError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = 'InvocationError';
  }
}

// ── Service ─────────────────────────────────────────────────────────────────

/**
 * Start a workflow by its registered type.
 *
 * Thin proxy over `Durable.Client.workflow.start()` — callers have
 * access to the full option set (workflowId, expire, entity) with
 * sensible defaults when omitted. The service resolves the task queue,
 * enforces auth/scope constraints, builds the LTEnvelope with IAM
 * context, and delegates to the Durable client.
 *
 * Throws `InvocationError` with an appropriate status code on failure.
 */
export async function invokeWorkflow(
  input: InvokeWorkflowInput,
): Promise<InvokeWorkflowResult> {
  const { workflowType, data, metadata, executeAs: executeAsOverride, auth } = input;

  // 1. Look up workflow config and resolve task queue
  const taskQueue = await resolveTaskQueue(workflowType);

  // 2. Enforce bot API key scopes
  const authScopes = auth.scopes ?? [];
  if (authScopes.length > 0 && !authScopes.includes('workflow:invoke')) {
    throw new InvocationError('API key scope does not include workflow:invoke', 403);
  }

  // 3. Validate inputs
  if (!data || typeof data !== 'object') {
    throw new InvocationError('Request body must include a data object', 400);
  }

  if (executeAsOverride && auth.role !== 'admin' && auth.role !== 'superadmin') {
    throw new InvocationError('execute_as override requires admin role', 403);
  }

  // 4. Resolve principals and build envelope
  const wfConfig = await configService.getWorkflowConfig(workflowType);
  const isCertified = !!(
    wfConfig &&
    ((wfConfig.roles?.length ?? 0) > 0 || (wfConfig.consumes?.length ?? 0) > 0)
  );
  const resolvedMetadata = { ...(metadata ?? {}) };
  if (isCertified && resolvedMetadata.certified !== false) {
    resolvedMetadata.certified = true;
  }
  const envelope = await buildEnvelope(
    data,
    resolvedMetadata,
    auth.userId,
    executeAsOverride,
    wfConfig?.execute_as ?? undefined,
  );

  // 5. Start workflow — caller options pass through to Durable client
  const client = createClient();
  const callerOpts = input.options ?? {};
  const workflowId = callerOpts.workflowId || `${workflowType}-${Durable.guid()}`;

  await client.workflow.start({
    ...callerOpts,
    args: [envelope],
    taskQueue,
    workflowName: workflowType,
    workflowId,
    expire: callerOpts.expire ?? JOB_EXPIRE_SECS,
    entity: callerOpts.entity ?? workflowType,
    signalIn: false,
  } as any);

  return { workflowId };
}

// ── Internal helpers ────────────────────────────────────────────────────────

/**
 * Resolve the task queue for a workflow type. Checks the config table
 * first (with invocable/role guards), then falls back to active workers.
 */
async function resolveTaskQueue(workflowType: string): Promise<string> {
  const wfConfig = await configService.getWorkflowConfig(workflowType);

  if (wfConfig) {
    if (!wfConfig.invocable) {
      throw new InvocationError('Workflow is not invocable', 403);
    }
    if (!wfConfig.task_queue) {
      throw new InvocationError('Workflow has no task_queue configured', 400);
    }
    return wfConfig.task_queue;
  }

  // No config — fall back to active worker registry
  const worker = getRegisteredWorkers().get(workflowType);
  if (!worker) {
    throw new InvocationError(
      'Workflow not found (no config and no active worker)',
      404,
    );
  }
  return worker.taskQueue;
}

/** A principal's grants by uuid or external_id, or null when no such user exists. */
async function grantsOf(identifier: string): Promise<InvocationRoleGrant[] | null> {
  const user = isUuid(identifier)
    ? await userService.getUser(identifier)
    : await userService.getUserByExternalId(identifier);
  return user ? user.roles.map((r) => ({ role: r.role, type: r.type })) : null;
}

/**
 * Check a caller against the workflow's invocation rules, from the caller's
 * live grants rather than any role claim a token carries. A workflow with no
 * invocation roles is open, except a system-authority workflow, which needs a
 * superadmin.
 */
export async function checkInvocationRoles(
  workflowType: string,
  userId: string,
): Promise<void> {
  const wfConfig = await configService.getWorkflowConfig(workflowType);
  const systemAuthority = SYSTEM_AUTHORITY_WORKFLOWS.has(workflowType);
  if (!systemAuthority && (!wfConfig || wfConfig.invocation_roles.length === 0)) return;

  const roles = await grantsOf(userId);
  if (!roles) {
    throw new InvocationError('User not registered', 403);
  }

  // invocable is resolveTaskQueue's concern; this gate decides roles only.
  const rules = { workflow_type: workflowType, invocation_roles: wfConfig?.invocation_roles ?? [], invocable: true };
  if (!canInvokeWorkflow(rules, roles)) {
    throw new InvocationError('Insufficient role for invocation', 403);
  }
}

/** Refuse an execute_as override that would exceed the caller's own authority. */
export async function assertMayActAs(userId: string, executeAs: string): Promise<void> {
  const caller = await grantsOf(userId);
  if (!caller) throw new InvocationError('User not registered', 403);
  const target = await grantsOf(executeAs);
  if (!target) throw new InvocationError(`execute_as principal "${executeAs}" not found`, 404);
  if (!mayActAs(caller, target)) {
    throw new InvocationError('execute_as may not exceed your own authority', 403);
  }
}

/**
 * Authorize an invocation that arrives from outside the process (REST, /mcp):
 * the workflow's invocation rules, then any execute_as override.
 */
export async function authorizeInvocation(input: {
  workflowType: string;
  userId: string;
  executeAs?: string;
}): Promise<void> {
  await checkInvocationRoles(input.workflowType, input.userId);
  if (input.executeAs) await assertMayActAs(input.userId, input.executeAs);
}

/**
 * Build the LTEnvelope with IAM context.
 */
async function buildEnvelope(
  data: Record<string, any>,
  metadata: Record<string, any>,
  userId: string | undefined,
  executeAsOverride: string | undefined,
  configExecuteAs: string | undefined,
): Promise<LTEnvelope> {
  const executeAs = executeAsOverride ?? configExecuteAs;

  let principal: Awaited<ReturnType<typeof resolvePrincipal>> | undefined;
  let initiatingPrincipal: Awaited<ReturnType<typeof resolvePrincipal>> | undefined;

  if (executeAs) {
    const [botP, userP] = await Promise.all([
      resolvePrincipal(executeAs),
      userId ? resolvePrincipal(userId) : Promise.resolve(null),
    ]);
    principal = botP ?? undefined;
    initiatingPrincipal = userP ?? undefined;
  } else if (userId) {
    principal = (await resolvePrincipal(userId)) ?? undefined;
  }

  const resolvedUserId = principal?.id ?? userId;
  const resolvedInitiatorId = initiatingPrincipal?.id ?? userId;

  return {
    data,
    metadata,
    lt: {
      userId: executeAs ? principal?.id ?? executeAs : resolvedUserId,
      principal: principal ?? undefined,
      scopes: ['workflow:invoke'],
      ...(executeAs && userId
        ? {
            initiatedBy: resolvedInitiatorId,
            initiatingPrincipal: initiatingPrincipal ?? undefined,
          }
        : {}),
    },
  };
}
