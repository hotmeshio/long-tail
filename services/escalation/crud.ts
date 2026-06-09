import { getPool } from '../../lib/db';
import { publishEscalationEvent } from '../../lib/events/publish';
import { loggerRegistry } from '../../lib/logger';
import type { LTEscalationRecord } from '../../types';

import type { CreateEscalationInput, ClaimResult } from './types';
import {
  ENSURE_ROLE_EXISTS,
  CREATE_ESCALATION,
  CLAIM_ESCALATION,
  RESOLVE_ESCALATION,
  UPDATE_ESCALATION_METADATA,
  ENRICH_ESCALATION_ROUTING,
  UPDATE_ESCALATIONS_PRIORITY,
  GET_ESCALATION_ROLES,
  RELEASE_ESCALATION,
  RELEASE_EXPIRED_CLAIMS,
  ESCALATE_TO_ROLE,
  GET_ESCALATION,
  GET_ESCALATIONS_BY_TASK_ID,
  GET_ESCALATIONS_BY_WORKFLOW_ID,
  GET_ESCALATIONS_BY_ORIGIN_ID,
  FIND_BY_METADATA,
  CLAIM_BY_METADATA_GUARDED,
  RESOLVE_BY_METADATA_ATOMIC,
} from './sql';

export async function createEscalation(
  input: CreateEscalationInput,
): Promise<LTEscalationRecord> {
  loggerRegistry.info(`[escalation-crud] createEscalation called for wf=${input.workflow_id} type=${input.type} caller=${new Error().stack?.split('\n')[2]?.trim()}`);
  const pool = getPool();
  // Ensure the role exists in lt_roles (FK constraint)
  await pool.query(ENSURE_ROLE_EXISTS, [input.role]);
  const { rows } = await pool.query(
    CREATE_ESCALATION,
    [
      input.type,
      input.subtype,
      input.description || null,
      input.priority || 2,
      input.task_id || null,
      input.origin_id || null,
      input.parent_id || null,
      input.role,
      input.envelope,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.escalation_payload || null,
      input.workflow_id || null,
      input.task_queue || null,
      input.workflow_type || null,
      input.trace_id || null,
      input.span_id || null,
    ],
  );
  const escalation = rows[0];

  publishEscalationEvent({
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
 * Atomic claim operation. Does NOT change status — "claimed" is implicit
 * via assigned_to + assigned_until > NOW().
 *
 * Conditions:
 * - status = 'pending' (not resolved/cancelled)
 * - Either: unassigned, expired claim, or same user (extension)
 *
 * Uses a CTE to capture the previous state so callers can detect extensions.
 */
export async function claimEscalation(
  id: string,
  userId: string,
  durationMinutes: number = 30,
): Promise<ClaimResult | null> {
  const pool = getPool();

  const { rows } = await pool.query(
    CLAIM_ESCALATION,
    [id, userId, durationMinutes],
  );

  if (rows.length === 0) return null;

  const row = rows[0];
  const escalation = row as LTEscalationRecord;

  publishEscalationEvent({
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
    isExtension: row.prev_assigned_to === userId,
  };
}

export async function resolveEscalation(
  id: string,
  resolverPayload: Record<string, any>,
): Promise<LTEscalationRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    RESOLVE_ESCALATION,
    [id, JSON.stringify(resolverPayload)],
  );
  const escalation = rows[0] || null;

  if (escalation) {
    publishEscalationEvent({
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

  return escalation;
}

/**
 * Bulk update priority for a set of escalations.
 * Only updates pending escalations.
 */
export async function updateEscalationsPriority(
  ids: string[],
  priority: 1 | 2 | 3 | 4,
): Promise<number> {
  if (ids.length === 0) return 0;
  const pool = getPool();
  const { rowCount } = await pool.query(
    UPDATE_ESCALATIONS_PRIORITY,
    [priority, ids],
  );
  return rowCount ?? 0;
}

/**
 * Get the distinct roles for a set of escalation IDs.
 * Used for permission validation before bulk operations.
 */
export async function getEscalationRoles(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const pool = getPool();
  const { rows } = await pool.query(
    GET_ESCALATION_ROLES,
    [ids],
  );
  return rows.map((r: any) => r.role);
}

/**
 * Release a single escalation claim back to the available pool.
 * Only the assigned user (or superadmin via route) may release.
 */
export async function releaseEscalation(
  id: string,
  userId: string,
): Promise<LTEscalationRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    RELEASE_ESCALATION,
    [id, userId],
  );
  const released = rows[0] as LTEscalationRecord | undefined;
  if (released) {
    publishEscalationEvent({
      type: 'escalation.released',
      source: 'service',
      workflowId: released.workflow_id || '',
      workflowName: released.workflow_type || '',
      taskQueue: released.task_queue || '',
      escalationId: released.id,
      status: 'released',
      data: { released_by: userId },
    });
  }
  return released || null;
}

export async function releaseExpiredClaims(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(RELEASE_EXPIRED_CLAIMS);
  return rowCount || 0;
}

/**
 * Reassign an escalation to a different role.
 * Clears the current assignment so it becomes available to the new role.
 */
export async function escalateToRole(
  id: string,
  targetRole: string,
): Promise<LTEscalationRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    ESCALATE_TO_ROLE,
    [id, targetRole],
  );
  return rows[0] || null;
}

export async function getEscalation(id: string): Promise<LTEscalationRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ESCALATION, [id]);
  return rows[0] || null;
}

export async function getEscalationsByTaskId(
  taskId: string,
): Promise<LTEscalationRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ESCALATIONS_BY_TASK_ID, [taskId]);
  return rows;
}

export async function getEscalationsByWorkflowId(
  workflowId: string,
): Promise<LTEscalationRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ESCALATIONS_BY_WORKFLOW_ID, [workflowId]);
  return rows;
}

export async function updateEscalationMetadata(
  id: string,
  patch: Record<string, any>,
): Promise<LTEscalationRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    UPDATE_ESCALATION_METADATA,
    [id, JSON.stringify(patch)],
  );
  return rows[0] || null;
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
  const pool = getPool();
  const { rows } = await pool.query(
    ENRICH_ESCALATION_ROUTING,
    [
      id,
      JSON.stringify(metadataPatch),
      workflowFields.workflowType || null,
      workflowFields.workflowId || null,
      workflowFields.taskQueue || null,
      workflowFields.taskId || null,
    ],
  );
  return rows[0] || null;
}

export async function getEscalationsByOriginId(
  originId: string,
): Promise<LTEscalationRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ESCALATIONS_BY_ORIGIN_ID, [originId]);
  return rows;
}

// --- Metadata candidate key lookups -----------------------------------------

export async function findByMetadata(
  key: string,
  value: string,
  status?: string,
  limit = 50,
  offset = 0,
): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const pool = getPool();
  const filter = JSON.stringify({ [key]: value });
  const { rows } = await pool.query(FIND_BY_METADATA, [filter, status || null, limit, offset]);
  const total = rows.length > 0 ? parseInt(rows[0]._total, 10) : 0;
  // Strip the window function column from results
  const escalations = rows.map(({ _total, ...rest }) => rest as LTEscalationRecord);
  return { escalations, total };
}

/**
 * Atomic claim by metadata with inline RBAC.
 * The SQL WHERE clause enforces role membership — if the caller
 * doesn't have an allowed role, zero rows match and the claim
 * never happens. No pre-flight find, no TOCTOU.
 *
 * @param allowedRoles — roles the caller can claim (null = no filter / global access)
 * @returns `{ escalation, isExtension, candidatesExist }` or null
 */
export async function claimByMetadata(
  key: string,
  value: string,
  userId: string,
  durationMinutes = 30,
  metadata?: Record<string, any>,
  allowedRoles?: string[] | null,
): Promise<(ClaimResult & { candidatesExist: number }) | null> {
  const pool = getPool();
  const filter = JSON.stringify({ [key]: value });
  const metaPatch = metadata ? JSON.stringify(metadata) : null;
  const roles = allowedRoles ?? null;
  const { rows } = await pool.query(CLAIM_BY_METADATA_GUARDED, [filter, userId, durationMinutes, metaPatch, roles]);
  if (rows.length === 0) return null;
  const row = rows[0];
  const { candidates_exist, prev_assigned_to, _total, ...rest } = row;
  const escalation = rest as LTEscalationRecord;

  publishEscalationEvent({
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
    isExtension: prev_assigned_to === userId,
    candidatesExist: parseInt(candidates_exist, 10),
  };
}

export interface ResolveByMetadataResult {
  /** 'resolved' = done atomically. 'signal_required' = signal_id present, caller must signal. */
  outcome: 'resolved' | 'signal_required' | 'not_found';
  /** The resolved escalation (when outcome = 'resolved') */
  escalation?: LTEscalationRecord;
  /** Signal info (when outcome = 'signal_required') */
  signalId?: string;
  escalationId?: string;
  workflowId?: string;
  workflowType?: string;
  taskQueue?: string;
}

/**
 * Atomic resolve by metadata with signal guard.
 *
 * Single query, two outcomes:
 * 1. No signal_id → claim + resolve atomically. Returns { outcome: 'resolved', escalation }.
 * 2. signal_id present → resolve skipped. Returns { outcome: 'signal_required', signalId, escalationId, ... }
 *    so the caller can signal the workflow. conditionLT handles the rest.
 */
export async function resolveByMetadataAtomic(
  key: string,
  value: string,
  userId: string,
  resolverPayload: Record<string, any>,
  metadata?: Record<string, any>,
  allowedRoles?: string[] | null,
): Promise<ResolveByMetadataResult> {
  const pool = getPool();
  const filter = JSON.stringify({ [key]: value });
  const payloadJson = JSON.stringify(resolverPayload);
  const metaPatch = metadata ? JSON.stringify(metadata) : null;
  const roles = allowedRoles ?? null;
  const { rows } = await pool.query(RESOLVE_BY_METADATA_ATOMIC, [filter, userId, payloadJson, metaPatch, roles]);

  if (rows.length === 0) return { outcome: 'not_found' };

  const row = rows[0];

  if (row.outcome === 'resolved') {
    const { target_id, signal_id, target_workflow_id, target_workflow_type, target_task_queue, outcome, ...rest } = row;
    const escalation = rest as LTEscalationRecord;

    publishEscalationEvent({
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

  // Signal-backed escalation — return the signal info for the caller
  return {
    outcome: 'signal_required',
    signalId: row.signal_id,
    escalationId: row.target_id,
    workflowId: row.target_workflow_id,
    workflowType: row.target_workflow_type,
    taskQueue: row.target_task_queue,
  };
}
