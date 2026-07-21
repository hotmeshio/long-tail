import { getPool } from '../../lib/db';
import { publishEscalationEvent } from '../../lib/events/publish';
import type { LTEscalationRecord, LTEscalationStatus } from '../../types';

import { escalations, ensureEscalationCompatView } from './client';
import { listEscalations, invalidateEscalationAggregates } from './queries';
import {
  toEscalationRecord,
  toEscalationRecords,
  toJsonObject,
  toEnvelopeObject,
} from './map';
import type { CreateEscalationInput, ClaimResult } from './types';
import { RESOLVE_BY_METADATA_ATOMIC, RELEASE_EXPIRED_CLAIMS } from './sql';

/**
 * Every escalation write publishes an event AND drops this container's cached
 * aggregates — the event triggers a dashboard refetch, which must observe the
 * write rather than a pre-change aggregate held for up to a cache TTL.
 */
function publishEscalationChange(
  ...args: Parameters<typeof publishEscalationEvent>
): Promise<void> {
  invalidateEscalationAggregates();
  return publishEscalationEvent(...args);
}

// All escalation state lives in `public.hmsh_escalations` (HotMesh 0.22.3),
// reached through `client.escalations.*`. The function signatures and return
// shapes below are the frozen public surface — only the storage path changed.

// Generous upper bound for the "all escalations for X" lookups, which the
// legacy SQL returned without a LIMIT. Escalations per workflow/origin/task are
// few; this avoids a silent page cap without an unbounded scan.
const LOOKUP_LIMIT = 1000;

export async function createEscalation(
  input: CreateEscalationInput,
): Promise<LTEscalationRecord> {
  const client = await escalations();
  const entry = await client.create({
    type: input.type,
    subtype: input.subtype,
    description: input.description,
    priority: input.priority ?? 2,
    role: input.role,
    taskId: input.task_id,
    originId: input.origin_id,
    parentId: input.parent_id,
    workflowId: input.workflow_id,
    taskQueue: input.task_queue,
    workflowType: input.workflow_type,
    traceId: input.trace_id,
    spanId: input.span_id,
    envelope: toEnvelopeObject(input.envelope),
    metadata: input.metadata,
    escalationPayload: toJsonObject(input.escalation_payload),
  });
  const escalation = toEscalationRecord(entry);

  publishEscalationChange({
    type: 'escalation.created',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    status: 'pending',
    data: { type: input.type, role: input.role },
  });

  return escalation;
}

/**
 * Atomic claim. Implicit model — status stays 'pending'; "claimed" is
 * assigned_to + assigned_until > NOW(). `isExtension` is true when the same
 * user re-claims (extends expiry). Returns null when the row is not claimable.
 */
export async function claimEscalation(
  id: string,
  userId: string,
  durationMinutes: number = 30,
): Promise<ClaimResult | null> {
  const client = await escalations();
  const result = await client.claim({ id, assignee: userId, durationMinutes });
  if (!result.ok) return null;

  const escalation = toEscalationRecord(result.entry);
  publishEscalationChange({
    type: 'escalation.claimed',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    status: 'claimed',
    data: { assigned_to: userId },
  });

  return { escalation, isExtension: result.isExtension };
}

/**
 * Mark an escalation resolved. Signal delivery is owned by the resolution
 * orchestrator (api/escalations/resolve.ts); service-created rows have no
 * signal_key, so this never delivers a signal itself. Returns null when the
 * row is missing or already terminal.
 *
 * `metadata` (optional) is merged — not replaced — into the resolved row's
 * GIN-indexed `metadata` in the same atomic UPDATE, and only on the winning
 * resolve. It records "what actually happened" (outcome, duration, measured
 * results) into the `@>`-queryable surface alongside the creation metadata
 * ("what was intended"). Distinct from `resolverPayload`, which is delivered to
 * the waiting workflow as `condition()`'s return value and is not GIN-indexed.
 */
export async function resolveEscalation(
  id: string,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
  assertClaim?: string,
): Promise<LTEscalationRecord | null> {
  const client = await escalations();
  // `assertClaim` rides the SDK's guarded UPDATE: no active claim lock may
  // stand against this assignee, or the resolve blocks (claim-expired /
  // claimed-by-other). The API layer's advisory pre-check (assertLiveClaimant)
  // rejects early; this assertion is the atomic arbiter.
  const result = await client.resolve({ id, resolverPayload, metadata, assertClaim });
  if (!result.ok) return null;

  const escalation = toEscalationRecord(result.entry);
  publishEscalationChange({
    type: 'escalation.resolved',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    status: 'resolved',
    data: {},
  });

  return escalation;
}

/**
 * Resolve a SET of escalations by id in ONE guarded statement
 * (`UPDATE … WHERE id = ANY($ids) AND status='pending'`). Returns the rows that
 * won the resolve (already-terminal ids are excluded by the guard), and publishes
 * a resolved event per winner.
 *
 * Use this over a per-row `resolveEscalation` loop when every row takes the SAME
 * resolverPayload and the rows are woken collectively (or are bookkeeping rows with
 * no signal_key). NOTE: unlike the single `resolve`, this does NOT deliver per-row
 * signals — `resolveMany` is UPDATE-only, and the store enforces it: rows with
 * `signal_key` set (live `condition()` waiters) are skipped, stay `pending`, and
 * drop out of the return set. Waking a parked workflow requires the per-row
 * `resolveEscalation` (which delivers the signal).
 */
export async function resolveEscalationsByIds(
  ids: string[],
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
): Promise<LTEscalationRecord[]> {
  if (ids.length === 0) return [];
  const client = await escalations();
  const rows = await client.resolveMany({ ids, resolverPayload, metadata });
  const records = toEscalationRecords(rows);
  for (const escalation of records) {
    publishEscalationChange({
      type: 'escalation.resolved',
      source: 'service',
      workflowId: escalation.workflow_id || '',
      workflowName: escalation.workflow_type || '',
      taskQueue: escalation.task_queue || '',
      escalationId: escalation.id,
      status: 'resolved',
      data: {},
    });
  }
  return records;
}

/**
 * Resolve a SET of escalations atomically — every listed row resolves, each
 * with its OWN resolverPayload, or none do. One SQL statement locks the rows
 * in deterministic id order, applies per-row payloads, and commits each
 * waiter's wake WITH its resolve. Unlike {@link resolveEscalationsByIds},
 * rows backing a live `condition()` waiter are first-class here: each is
 * woken with its own payload as the condition's return value.
 *
 * On failure NOTHING is written and `failed` names exactly the rows that
 * blocked the batch (`not-found`, `already-resolved`, `already-cancelled`,
 * `already-expired`, `assignee-mismatch`) — rows that were themselves
 * resolvable stay pending and are not listed.
 *
 * `assertAssignee` (optional) additionally requires every row to be assigned
 * to that principal, asserted inside the same guarded statement — closing the
 * claim-race window for claim-then-resolve flows.
 */
export async function resolveEscalationsAllOrNone(
  items: Array<{ id: string; resolverPayload: Record<string, any> }>,
  metadata?: Record<string, any>,
  assertAssignee?: string,
): Promise<
  | { ok: true; escalations: LTEscalationRecord[] }
  | { ok: false; failed: Array<{ id: string; reason: string }> }
> {
  if (items.length === 0) return { ok: true, escalations: [] };
  const client = await escalations();
  const result = await client.resolveAllOrNone({ items, metadata, assertAssignee });
  if (!result.ok) return { ok: false, failed: result.failed };

  const records = toEscalationRecords(result.entries);
  for (const escalation of records) {
    publishEscalationChange({
      type: 'escalation.resolved',
      source: 'service',
      workflowId: escalation.workflow_id || '',
      workflowName: escalation.workflow_type || '',
      taskQueue: escalation.task_queue || '',
      escalationId: escalation.id,
      status: 'resolved',
      data: {},
    });
  }
  return { ok: true, escalations: records };
}

/**
 * Fetch full records for a set of escalation IDs in one indexed query.
 * Used by bulk orchestrators that need per-row context beyond the scope
 * fields — signal routing shape, `metadata.form_schema` for redaction.
 */
export async function getEscalationsByIds(
  ids: string[],
): Promise<LTEscalationRecord[]> {
  if (ids.length === 0) return [];
  const client = await escalations();
  const rows = await client.list({ ids, limit: LOOKUP_LIMIT });
  return toEscalationRecords(rows);
}

/**
 * Look up an efficient (atomic) escalation by its `signal_key` — the signal id
 * passed to `conditionLT(signalId, config)` / `condition(signalId, config)`.
 * Returns null when no row carries that key.
 */
export async function getEscalationBySignalKey(
  signalKey: string,
): Promise<LTEscalationRecord | null> {
  const client = await escalations();
  const entry = await client.getBySignalKey(signalKey);
  return entry ? toEscalationRecord(entry) : null;
}

/**
 * Resolve an efficient (atomic) escalation by its `signal_key` and resume the
 * waiting workflow in place. Convenience for webhook callers that know the
 * deterministic signal id (e.g. `signal-scan-ar-${orderId}`) and want to skip
 * the id lookup. Returns null when the key is unknown or already terminal.
 *
 * Race-free: `signal_key → id` is an immutable mapping, and the state mutation
 * is delegated to `resolveEscalation`, whose `client.resolve` uses FOR UPDATE +
 * `WHERE status = 'pending'` so exactly one concurrent caller commits. No status
 * pre-check (that would be a TOCTOU window) — the atomic resolve is the arbiter.
 *
 * `metadata` (optional) records the resolution outcome into the row's
 * GIN-indexed metadata atomically — see {@link resolveEscalation}.
 */
export async function resolveEscalationBySignalKey(
  signalKey: string,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
): Promise<LTEscalationRecord | null> {
  const escalation = await getEscalationBySignalKey(signalKey);
  if (!escalation) return null;
  return resolveEscalation(escalation.id, resolverPayload, metadata);
}

/**
 * Mark an escalation cancelled — used when the tied workflow has terminated and
 * can never receive the resolution signal. The escalation is removed from the
 * active queue but preserved for audit. Returns null when the row is missing or
 * already terminal.
 */
export async function cancelEscalation(
  id: string,
): Promise<LTEscalationRecord | null> {
  const client = await escalations();
  const result = await client.cancel(id);
  if (!result.ok) return null;

  const cancelled = toEscalationRecord(result.entry);
  publishEscalationChange({
    type: 'escalation.cancelled',
    source: 'service',
    workflowId: cancelled.workflow_id || '',
    workflowName: cancelled.workflow_type || '',
    taskQueue: cancelled.task_queue || '',
    escalationId: cancelled.id,
    status: 'cancelled',
    data: { reason: 'workflow_terminated' },
  });
  return cancelled;
}

/**
 * Bulk update priority for a set of escalations. Only pending escalations are
 * updated.
 */
export async function updateEscalationsPriority(
  ids: string[],
  priority: 1 | 2 | 3 | 4,
): Promise<number> {
  if (ids.length === 0) return 0;
  const client = await escalations();
  return client.updateManyPriority({ ids, priority });
}

/**
 * Get the distinct roles for a set of escalation IDs.
 * Used for permission validation before bulk operations.
 */
export async function getEscalationRoles(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const client = await escalations();
  const rows = await client.list({ ids, limit: LOOKUP_LIMIT });
  return [...new Set(rows.map(r => r.role).filter((r): r is string => !!r))];
}

/**
 * Fetch (id, role, assigned_to) for a set of escalation IDs — the minimal fields a
 * write-scope gate needs to authorize a BULK action per item: write_all by role,
 * write_self by ownership (assigned_to = caller). One query, no N+1.
 */
export async function getEscalationScopeRows(
  ids: string[],
): Promise<{ id: string; role: string; assigned_to: string | null }[]> {
  if (ids.length === 0) return [];
  const client = await escalations();
  const rows = await client.list({ ids, limit: LOOKUP_LIMIT });
  return rows.map((r) => ({
    id: r.id as string,
    role: r.role as string,
    assigned_to: (r.assigned_to as string | null) ?? null,
  }));
}

/**
 * Release a single escalation claim back to the available pool.
 * Only the assigned user (or superadmin via route) may release.
 */
export async function releaseEscalation(
  id: string,
  userId: string,
): Promise<LTEscalationRecord | null> {
  const client = await escalations();
  const result = await client.release({ id, assignee: userId });
  if (!result.ok) return null;

  const released = toEscalationRecord(result.entry);
  publishEscalationChange({
    type: 'escalation.released',
    source: 'service',
    workflowId: released.workflow_id || '',
    workflowName: released.workflow_type || '',
    taskQueue: released.task_queue || '',
    escalationId: released.id,
    status: 'released',
    data: { released_by: userId },
  });
  return released;
}

/**
 * Sweep expired claims back to the available pool, returning the count cleared.
 * Availability is already query-time in the implicit model, but long-tail's
 * public contract clears `assigned_to` and returns a count, so this runs as a
 * single direct UPDATE on the shared table (the SDK's releaseExpired is a no-op).
 */
export async function releaseExpiredClaims(): Promise<number> {
  await ensureEscalationCompatView();
  const pool = getPool();
  const { rowCount } = await pool.query(RELEASE_EXPIRED_CLAIMS);
  return rowCount ?? 0;
}

/**
 * Reassign an escalation to a different role.
 * Clears the current assignment so it becomes available to the new role.
 */
export async function escalateToRole(
  id: string,
  targetRole: string,
): Promise<LTEscalationRecord | null> {
  const client = await escalations();
  const entry = await client.escalateToRole({ id, targetRole });
  return entry ? toEscalationRecord(entry) : null;
}

export async function getEscalation(id: string): Promise<LTEscalationRecord | null> {
  const client = await escalations();
  const entry = await client.get(id);
  return entry ? toEscalationRecord(entry) : null;
}

export async function getEscalationsByTaskId(
  taskId: string,
): Promise<LTEscalationRecord[]> {
  const client = await escalations();
  const rows = await client.list({
    taskId,
    sortBy: 'created_at',
    sortOrder: 'desc',
    limit: LOOKUP_LIMIT,
  });
  return toEscalationRecords(rows);
}

export async function getEscalationsByWorkflowId(
  workflowId: string,
): Promise<LTEscalationRecord[]> {
  const client = await escalations();
  const rows = await client.list({
    workflowId,
    sortBy: 'created_at',
    sortOrder: 'desc',
    limit: LOOKUP_LIMIT,
  });
  return toEscalationRecords(rows);
}

/**
 * Cancel all pending escalations tied to a workflow in one atomic UPDATE.
 * Called after workflow termination so escalations don't remain in the queue.
 *
 * HotMesh's interrupt() is supposed to do this atomically, but it filters by
 * `app_id = <engine-appId>`. Long-tail's Durable client uses app_id='durable'
 * while escalations are stored with app_id='hmsh' — the WHERE never matches.
 * This single UPDATE bypasses the SDK entirely and closes that gap.
 */
export async function cancelEscalationsByWorkflowId(
  workflowId: string,
): Promise<number> {
  await ensureEscalationCompatView();
  const pool = getPool();
  const { rows } = await pool.query<{
    id: string; workflow_id: string | null; workflow_type: string | null;
    task_queue: string | null;
  }>(
    `UPDATE public.hmsh_escalations
        SET status = 'cancelled', updated_at = NOW()
      WHERE workflow_id = $1
        AND status = 'pending'
      RETURNING id, workflow_id, workflow_type, task_queue`,
    [workflowId],
  );

  for (const row of rows) {
    publishEscalationChange({
      type: 'escalation.cancelled',
      source: 'service',
      workflowId: row.workflow_id || '',
      workflowName: row.workflow_type || '',
      taskQueue: row.task_queue || '',
      escalationId: row.id,
      status: 'cancelled',
      data: { reason: 'workflow_terminated' },
    });
  }
  return rows.length;
}

export async function enrichEscalationRouting(
  id: string,
  metadataPatch: Record<string, any>,
  workflowFields: {
    workflowType?: string;
    workflowId?: string;
    taskQueue?: string;
    taskId?: string;
  },
): Promise<LTEscalationRecord | null> {
  const client = await escalations();
  const entry = await client.update({
    id,
    metadata: metadataPatch,
    workflowType: workflowFields.workflowType,
    workflowId: workflowFields.workflowId,
    taskQueue: workflowFields.taskQueue,
    taskId: workflowFields.taskId,
  });
  return entry ? toEscalationRecord(entry) : null;
}

export async function getEscalationsByOriginId(
  originId: string,
): Promise<LTEscalationRecord[]> {
  const client = await escalations();
  const rows = await client.list({
    originId,
    sortBy: 'created_at',
    sortOrder: 'desc',
    limit: LOOKUP_LIMIT,
  });
  return toEscalationRecords(rows);
}

// --- Metadata candidate key lookups -----------------------------------------

/**
 * Find escalations by a metadata key/value, RBAC-scoped IN SQL.
 *
 * `allowedRoles` flows into BOTH the page query and the count: `undefined` =
 * global (no role filter); a `string[]` filters `role = ANY(...)` (an empty array
 * matches nothing). Filtering in SQL — never client-side over a fetched page — is
 * what keeps `total` correct and pagination intact (a client-side filter shrinks a
 * page and reports the wrong total).
 */
export async function findByMetadata(
  key: string,
  value: string,
  status?: string,
  limit = 50,
  offset = 0,
  scope?: { allRoles?: string[]; selfRoles?: string[]; meUserId?: string },
): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  // Route through the scoped list query so BOTH the role-scope filter
  // (role ∈ allRoles OR (role ∈ selfRoles AND assigned_to = me)) AND the count
  // run in SQL — never a client-side filter over a fetched page. allRoles travel
  // as the flat `roles` filter; selfRoles + meUserId engage the raw-SQL scoped path.
  return listEscalations({
    metadata: { [key]: value },
    status: status as LTEscalationStatus | undefined,
    visibleRoles: scope?.allRoles,
    selfRoles: scope?.selfRoles,
    meUserId: scope?.meUserId,
    sort_by: 'priority',
    order: 'asc',
    limit,
    offset,
  });
}

/**
 * Atomic claim by metadata with inline RBAC and optional metadata merge.
 * The SDK enforces the role filter in SQL — callers without an allowed role
 * match zero rows. Returns `{ escalation, isExtension, candidatesExist }` or
 * null when nothing was claimed.
 *
 * @param allowedRoles — write_all roles the caller can claim (null = global / no
 *   filter). The SDK applies a flat `role = ANY` filter and cannot express the
 *   write_self ownership predicate, so self-scope members are intentionally
 *   excluded from claim-by-metadata (their items are pre-claimed and resolved
 *   by id). Self-scope claim-by-metadata would require a HotMesh SDK predicate.
 */
export async function claimByMetadata(
  key: string,
  value: string,
  userId: string,
  durationMinutes = 30,
  metadata?: Record<string, any>,
  allowedRoles?: string[] | null,
): Promise<(ClaimResult & { candidatesExist: number }) | null> {
  const client = await escalations();
  const result = await client.claimByMetadata({
    key,
    value,
    assignee: userId,
    durationMinutes,
    roles: allowedRoles === null ? undefined : allowedRoles,
    metadata,
  });
  if (!result.ok) return null;

  const escalation = toEscalationRecord(result.entry);
  publishEscalationChange({
    type: 'escalation.claimed',
    source: 'service',
    workflowId: escalation.workflow_id || '',
    workflowName: escalation.workflow_type || '',
    taskQueue: escalation.task_queue || '',
    escalationId: escalation.id,
    status: 'claimed',
    data: { assigned_to: userId },
  });

  return {
    escalation,
    isExtension: result.isExtension,
    candidatesExist: result.candidatesExist,
  };
}

export interface ResolveByMetadataResult {
  /**
   * 'resolved'            = done atomically in SQL (no signal backing).
   * 'signal_required'     = signal backing present, caller must deliver the signal.
   * 'conflict'            = signal_id row already claimed by a concurrent caller; skip re-signal.
   * 'not_found'           = no pending escalation matched the metadata filter.
   * 'validation_required' = the target's role enforces its schema; NOTHING was
   *                         written. The caller validates the payload against
   *                         `row`, then re-invokes with assertId = row.id (and
   *                         no enforcing set) to claim + resolve.
   */
  outcome: 'resolved' | 'signal_required' | 'conflict' | 'not_found' | 'validation_required';
  /** The resolved escalation (when outcome = 'resolved') */
  escalation?: LTEscalationRecord;
  /** Legacy conditionLT signal info (when signalId is set, caller uses handle.signal) */
  signalId?: string;
  /** Atomic conditionLT signal key (when signalKey is set, caller uses SDK resolve to atomically mark+signal) */
  signalKey?: string;
  escalationId?: string;
  workflowId?: string;
  workflowType?: string;
  taskQueue?: string;
  /** The unmodified target row fields the schema gate validates against (when outcome = 'validation_required') */
  row?: {
    id: string;
    role: string | null;
    metadata: Record<string, any> | null;
    envelope: string | null;
    escalation_payload: string | null;
  };
}

/**
 * Atomic resolve by metadata with signal guard, in a single CTE.
 *
 * Signal-backed rows (those carrying `metadata.signal_id`) are NOT resolved
 * here — long-tail signals the paused workflow and the workflow interceptor
 * resolves durably. If the workflow is gone the signal fails and the row stays
 * pending, which is the contract the route suite pins. This guard is long-tail
 * business logic over the shared table, so it runs as one atomic statement on
 * `hmsh_escalations` rather than through the generic SDK resolve.
 */
export async function resolveByMetadataAtomic(
  key: string,
  value: string,
  userId: string,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
  writeAllRoles?: string[] | null,
  writeSelfRoles?: string[] | null,
  enforcingRoles?: string[] | null,
  assertId?: string | null,
): Promise<ResolveByMetadataResult> {
  await ensureEscalationCompatView();
  const pool = getPool();
  const filter = JSON.stringify({ [key]: value });
  const payloadJson = JSON.stringify(resolverPayload);
  const metaPatch = metadata ? JSON.stringify(metadata) : null;
  // null write_all roles = global (no filter). A scoped caller passes its arrays
  // (possibly empty); the write_self branch matches only rows assigned to userId.
  const allRoles = writeAllRoles ?? null;
  const selfRoles = writeSelfRoles ?? null;
  const { rows } = await pool.query(
    RESOLVE_BY_METADATA_ATOMIC,
    [filter, userId, payloadJson, metaPatch, allRoles, selfRoles,
      enforcingRoles?.length ? enforcingRoles : null, assertId ?? null],
  );

  if (rows.length === 0) return { outcome: 'not_found' };

  const row = rows[0];

  // Enforcing-role target — nothing written; hand the row's validation surface
  // back so the API layer can run the schema gate and re-invoke with assertId.
  if (row.outcome === 'validation_required') {
    return {
      outcome: 'validation_required',
      escalationId: row.target_id,
      row: {
        id: row.target_id,
        role: row.target_role ?? null,
        metadata: row.target_metadata ?? null,
        envelope: row.target_envelope ?? null,
        escalation_payload: row.target_escalation_payload ?? null,
      },
    };
  }

  if (row.outcome === 'resolved') {
    const escalation = toEscalationRecord(row);

    publishEscalationChange({
      type: 'escalation.resolved',
      source: 'service',
      workflowId: escalation.workflow_id || '',
      workflowName: escalation.workflow_type || '',
      taskQueue: escalation.task_queue || '',
      escalationId: escalation.id,
      status: 'resolved',
      data: { resolved_by: userId },
    });

    return { outcome: 'resolved', escalation };
  }

  // Signal_id row already claimed by a concurrent caller — skip re-signal to prevent duplicate delivery.
  if (row.signal_id && row.signal_already_claimed) {
    return { outcome: 'conflict', escalationId: row.target_id };
  }

  // Signal-backed escalation — return the signal info for the caller to deliver.
  return {
    outcome: 'signal_required',
    signalId: row.signal_id ?? undefined,
    signalKey: row.signal_key ?? undefined,
    escalationId: row.target_id,
    workflowId: row.target_workflow_id,
    workflowType: row.target_workflow_type,
    taskQueue: row.target_task_queue,
  };
}
