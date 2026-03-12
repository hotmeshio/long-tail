import { getPool } from '../db';
import type { LTEscalationRecord } from '../../types';

import type { CreateEscalationInput, ClaimResult } from './types';
import {
  ENSURE_ROLE_EXISTS,
  CREATE_ESCALATION,
  CLAIM_ESCALATION,
  RESOLVE_ESCALATION,
  UPDATE_ESCALATIONS_PRIORITY,
  GET_ESCALATION_ROLES,
  RELEASE_ESCALATION,
  RELEASE_EXPIRED_CLAIMS,
  ESCALATE_TO_ROLE,
  GET_ESCALATION,
  GET_ESCALATIONS_BY_TASK_ID,
  GET_ESCALATIONS_BY_WORKFLOW_ID,
  GET_ESCALATIONS_BY_ORIGIN_ID,
} from './sql';

export async function createEscalation(
  input: CreateEscalationInput,
): Promise<LTEscalationRecord> {
  const pool = getPool();
  // Ensure the role exists in lt_roles (FK constraint)
  await pool.query(ENSURE_ROLE_EXISTS, [input.role]);
  const { rows } = await pool.query(
    CREATE_ESCALATION,
    [
      input.type,
      input.subtype,
      input.modality,
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
  return rows[0];
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
  return {
    escalation: row as LTEscalationRecord,
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
  return rows[0] || null;
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
  return rows[0] || null;
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

export async function getEscalationsByOriginId(
  originId: string,
): Promise<LTEscalationRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_ESCALATIONS_BY_ORIGIN_ID, [originId]);
  return rows;
}
