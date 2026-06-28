import * as escalationService from '../../services/escalation';
import * as taskService from '../../services/task';
import { escalationStrategyRegistry } from '../../services/escalation-strategy';
import { storeEphemeral, formatEphemeralToken } from '../../services/iam/ephemeral';
import { getEngine as getYamlEngine } from '../../services/yaml-workflow/deployer';
import { createClient } from '../../workers';
import { JOB_EXPIRE_SECS } from '../../modules/defaults';
import { getVisibleRoles } from './helpers';
import type { LTApiResult, LTApiAuth } from '../../types/sdk';

// ── Orchestrator ─────────────────────────────────────────────────────────

/**
 * Resolve a pending escalation with a human-provided payload.
 *
 * Handles multiple resolution paths:
 * 1. **Condition signal** — lightweight `conditionLT` signal via metadata.signal_id
 * 2. **Signal-routed** — full signal_routing via YAML engine or Durable handle
 * 3. **Strategy triage** — escalation strategy redirects to a triage workflow
 * 4. **Notification-only** — no workflow_type; acknowledge and close
 * 5. **Re-run** — restart the original workflow with resolver data injected
 *
 * Password fields in the resolver payload are replaced with ephemeral
 * tokens (15-minute TTL) so plaintext never enters the signal store.
 */
export async function resolveEscalation(
  input: { id: string; resolverPayload: Record<string, any>; metadata?: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { id, resolverPayload, metadata } = input;
    if (!resolverPayload) {
      return { status: 400, error: 'resolverPayload is required' };
    }

    const escalation = await escalationService.getEscalation(id);
    if (!escalation) return { status: 404, error: 'Escalation not found' };

    // RBAC parity with resolveBySignalKey: a role-scoped caller may only resolve
    // escalations whose role is visible to them. Global-access principals
    // (superadmin/admin/system) get `undefined` → no filter. 404 (not 403) so the
    // existence of out-of-scope escalations is not disclosed.
    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles && !visibleRoles.includes(escalation.role)) {
      return { status: 404, error: 'Escalation not found' };
    }

    if (escalation.status === 'cancelled') return { status: 409, error: 'Escalation is cancelled' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for resolution' };

    // `metadata` (the outcome patch) is never written separately — it rides WITH the
    // resolverPayload to whichever path performs the resolve, so it merges inside the
    // single status='pending'-guarded UPDATE (HotMesh `resolve(metadata)`). Paths that
    // resolve here pass it as the 3rd arg; paths that resume a workflow carry it on the
    // signal so the downstream resolve commits it atomically.

    // Path A: conditionLT signal
    const metadataSignalId = (escalation.metadata as any)?.signal_id;
    if (metadataSignalId && escalation.workflow_id && escalation.task_queue && escalation.workflow_type) {
      return resolveViaConditionSignal(escalation, resolverPayload, metadata);
    }

    // Path B: waitFor signal routing
    const signalRouting = (escalation.metadata as any)?.signal_routing;
    if (signalRouting?.signalId) {
      return resolveViaSignalRouting(escalation, resolverPayload, metadata);
    }

    // Path 0: efficient (atomic) escalation — signal_key resumes in place.
    // The row was written inside the workflow's Leg1 checkpoint via
    // `condition(signalId, config)`. The SDK's resolve marks it resolved AND
    // delivers the signal to `signal_key`, resuming THIS job — no re-run.
    if (escalation.signal_key) {
      return resolveViaSignalKey(escalation, resolverPayload, metadata);
    }

    // Path C: escalation strategy may redirect to triage
    const envelope = await reconstructEnvelope(escalation);
    const strategy = escalationStrategyRegistry.current;
    if (strategy) {
      const directive = await strategy.onResolution({ escalation, resolverPayload, envelope });
      if (directive.action === 'triage') {
        return resolveViaTriage(escalation, resolverPayload, directive.triageEnvelope, metadata);
      }
    }

    // Path D: notification-only — no workflow to restart. One atomic resolve.
    if (!escalation.workflow_type || !escalation.task_queue) {
      await escalationService.resolveEscalation(escalation.id, resolverPayload, metadata);
      return { status: 200, data: { acknowledged: true, escalationId: escalation.id } };
    }

    // Path E: standard re-run
    return resolveViaRerun(escalation, envelope, resolverPayload, metadata);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Resolve an efficient (atomic) escalation directly by its `signal_key` and
 * resume the waiting workflow in place. For webhook callers that know the
 * deterministic signal id (e.g. `signal-scan-ar-${orderId}`) and want to skip
 * the id lookup. RBAC-scoped to the caller's visible roles.
 */
export async function resolveBySignalKey(
  input: { signalKey: string; resolverPayload: Record<string, any>; metadata?: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { signalKey, resolverPayload, metadata } = input;
    if (!signalKey) return { status: 400, error: 'signalKey is required' };
    if (!resolverPayload) return { status: 400, error: 'resolverPayload is required' };

    const escalation = await escalationService.getEscalationBySignalKey(signalKey);
    if (!escalation) return { status: 404, error: 'Escalation not found' };
    if (escalation.status !== 'pending') return { status: 409, error: 'Escalation not available for resolution' };

    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles && !visibleRoles.includes(escalation.role)) {
      return { status: 404, error: 'Escalation not found' };
    }

    return resolveViaSignalKey(escalation, resolverPayload, metadata);
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

/**
 * Resolve a SET of escalations by id in one guarded statement (the public,
 * set-based sibling of {@link resolveEscalation}). Delegates to the SDK's
 * `client.resolveMany` via the service layer.
 *
 * RBAC: a scoped caller may only resolve rows whose role they hold. `role` is
 * immutable per escalation, so this authorization read (`getEscalationRoles`)
 * does not race the guarded `resolveMany` that follows — and global principals
 * skip it entirely. Use for bookkeeping rows woken collectively; it does NOT
 * deliver per-row signals (see services `resolveEscalationsByIds`).
 */
export async function resolveByIds(
  input: { ids: string[]; resolverPayload: Record<string, any>; metadata?: Record<string, any> },
  auth: LTApiAuth,
): Promise<LTApiResult> {
  try {
    const { ids, resolverPayload, metadata } = input;
    if (!Array.isArray(ids) || ids.length === 0) {
      return { status: 400, error: 'ids must be a non-empty array' };
    }
    if (!resolverPayload) return { status: 400, error: 'resolverPayload is required' };

    const visibleRoles = await getVisibleRoles(auth.userId);
    if (visibleRoles) {
      const roleSet = new Set(visibleRoles);
      const roles = await escalationService.getEscalationRoles(ids);
      if (roles.some((r) => !roleSet.has(r))) {
        return { status: 404, error: 'One or more escalations not found' };
      }
    }

    const resolved = await escalationService.resolveEscalationsByIds(ids, resolverPayload, metadata);
    return { status: 200, data: { resolved: resolved.length, escalationIds: resolved.map((e) => e.id) } };
  } catch (err: any) {
    return { status: 500, error: err.message };
  }
}

// ── Resolution paths ─────────────────────────────────────────────────────

/** Path A: lightweight conditionLT signal — inject $escalation_id and signal the running workflow. */
async function resolveViaConditionSignal(
  escalation: any,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
): Promise<LTApiResult> {
  const signalId = (escalation.metadata as any).signal_id;
  const client = createClient();
  const handle = await client.workflow.getHandle(
    escalation.task_queue,
    escalation.workflow_type,
    escalation.workflow_id,
  );
  // The row is resolved downstream by the workflow's `conditionLT` → `ltResolveEscalation`.
  // Carry the outcome patch on the signal ($escalation_metadata, symmetric to $escalation_id)
  // so it merges inside that single atomic resolve — never a separate write here.
  await handle.signal(signalId, {
    ...resolverPayload,
    $escalation_id: escalation.id,
    ...(metadata ? { $escalation_metadata: metadata } : {}),
  });

  // Event published by service layer (services/escalation/crud.ts)
  return signaledResult(escalation, escalation.workflow_id);
}

/**
 * Path 0: efficient escalation — resolve by `signal_key`. The SDK delivers the
 * signal to the waiting `condition()` AND marks the row resolved in one
 * transaction, so the original job resumes in place (no re-run, no separate
 * resolve activity). Password fields are redacted before they enter the signal.
 */
async function resolveViaSignalKey(
  escalation: any,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
): Promise<LTApiResult> {
  const signalPayload = await redactPasswords(resolverPayload, (escalation.metadata as any)?.form_schema);
  // One atomic call: status→resolved, signal delivered, and the outcome patch merged
  // into the GIN-indexed metadata — all inside the single WHERE-guarded UPDATE.
  const resolved = await escalationService.resolveEscalation(escalation.id, signalPayload, metadata);
  if (!resolved) {
    return { status: 409, error: 'Escalation not available for resolution' };
  }
  // Event published by service layer (services/escalation/crud.ts)
  return signaledResult(escalation, escalation.workflow_id || '');
}

/** Path B: waitFor signal escalation — signal via YAML engine or Durable handle. */
async function resolveViaSignalRouting(
  escalation: any,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
): Promise<LTApiResult> {
  const signalRouting = (escalation.metadata as any).signal_routing;
  const signalPayload = await redactPasswords(resolverPayload, (escalation.metadata as any)?.form_schema);

  if (signalRouting.engine === 'yaml' && signalRouting.hookTopic && signalRouting.appId) {
    // YAML resolves transactionally inside the workflow — carry the patch on the signal
    // so it commits with that resolve, never as a separate write.
    const engine = await getYamlEngine(signalRouting.appId);
    await engine.signal(signalRouting.hookTopic, {
      ...signalPayload,
      escalationId: escalation.id,
      job_id: signalRouting.jobId,
      ...(metadata ? { $escalation_metadata: metadata } : {}),
    });
  } else if (signalRouting.workflowId) {
    const client = createClient();
    const handle = await client.workflow.getHandle(
      signalRouting.taskQueue, signalRouting.workflowType, signalRouting.workflowId,
    );
    await handle.signal(signalRouting.signalId, signalPayload);
  }

  // Durable resolves here — one atomic call carries the outcome patch.
  // Persist the SAME redacted payload that was delivered to the signal: the raw
  // resolverPayload (with plaintext passwords) must never land in resolver_payload.
  // Ordering is crash-safe-forward: the signal is delivered BEFORE this resolve, so a
  // crash in between leaves the row `pending` and a retry re-signals (a no-op to an
  // already-resumed workflow) then resolves — never a resolved row with a stuck workflow.
  if (signalRouting.engine !== 'yaml') {
    await escalationService.resolveEscalation(escalation.id, signalPayload, metadata);
  }

  // Event published by service layer (services/escalation/crud.ts)
  return signaledResult(escalation, signalRouting.workflowId || signalRouting.appId);
}

/** Path C: escalation strategy directed triage — start a triage workflow. */
async function resolveViaTriage(
  escalation: any,
  resolverPayload: Record<string, any>,
  triageEnvelope: any,
  metadata?: Record<string, any>,
): Promise<LTApiResult> {
  // Deterministic id: an escalation is terminal-once, so `triage-<id>` is unique for
  // its lifetime. A retry after a mid-saga crash re-targets the SAME job key (HotMesh
  // upserts jobs by (workflowId, app_id)) instead of spawning a duplicate triage —
  // and the final resolve below is the `status='pending'`-guarded arbiter.
  const triageWorkflowId = `triage-${escalation.id}`;
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
    envelope: JSON.stringify(triageEnvelope),
  });

  await client.workflow.start({
    workflowName: 'mcpTriageRouter',
    args: [triageEnvelope],
    taskQueue: 'long-tail-system',
    workflowId: triageWorkflowId,
    expire: JOB_EXPIRE_SECS,
    entity: 'mcpTriageRouter',
    signalIn: false,
  } as any);

  await escalationService.resolveEscalation(escalation.id, {
    ...resolverPayload,
    _lt: { ...resolverPayload._lt, triaged: true, triageWorkflowId },
  }, metadata);

  // Event published by service layer (services/escalation/crud.ts)
  return {
    status: 200,
    data: { started: true, escalationId: escalation.id, workflowId: triageWorkflowId, triage: true },
  };
}

/** Path E: standard re-run — inject resolver data and restart the original workflow. */
async function resolveViaRerun(
  escalation: any,
  envelope: Record<string, any>,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
): Promise<LTApiResult> {
  envelope.resolver = resolverPayload;
  // Carry the outcome patch on the rerun envelope so the downstream resolve (when the
  // re-run completes) commits it atomically — not a separate write to the old row.
  envelope.lt = { ...envelope.lt, escalationId: escalation.id, escalationMetadata: metadata };

  // Deterministic id (see resolveViaTriage): `rerun-<id>` is unique per escalation
  // lifetime, so a retry re-targets the same job rather than spawning a duplicate
  // re-run. The old escalation is resolved downstream by the interceptor when the
  // re-run executes (services/interceptor/lifecycle.ts), which is `pending`-guarded.
  const newWorkflowId = `rerun-${escalation.id}`;
  const client = createClient();

  await client.workflow.start({
    workflowName: escalation.workflow_type,
    args: [envelope],
    taskQueue: escalation.task_queue,
    workflowId: newWorkflowId,
    expire: 180,
  });

  // Event published by service layer (services/escalation/crud.ts)
  return {
    status: 200,
    data: { started: true, escalationId: escalation.id, workflowId: newWorkflowId },
  };
}

// ── Shared helpers ───────────────────────────────────────────────────────

function signaledResult(escalation: any, workflowId: string): LTApiResult {
  return {
    status: 200,
    data: { signaled: true, escalationId: escalation.id, workflowId },
  };
}


/** Replace password fields with ephemeral tokens so plaintext never enters the signal store. */
async function redactPasswords(
  payload: Record<string, any>,
  formSchema: any,
): Promise<Record<string, any>> {
  if (!formSchema?.properties) return payload;
  const redacted = { ...payload };
  for (const [key, def] of Object.entries(formSchema.properties)) {
    if ((def as any)?.format === 'password' && typeof redacted[key] === 'string') {
      const uuid = await storeEphemeral(redacted[key], { ttlSeconds: 900, label: key });
      redacted[key] = formatEphemeralToken(uuid, key);
    }
  }
  return redacted;
}

/** Reconstruct the original envelope from the escalation record or its task. */
async function reconstructEnvelope(escalation: any): Promise<Record<string, any>> {
  if (escalation.envelope) {
    try { return JSON.parse(escalation.envelope); } catch { /* use empty */ }
  } else if (escalation.task_id) {
    const task = await taskService.getTask(escalation.task_id);
    if (task?.envelope) {
      try { return JSON.parse(task.envelope); } catch { /* use empty */ }
    }
  }
  return {};
}
