import { getPool } from './db';
import type { LTEscalationRecord, LTEscalationStatus } from '../types';

export interface CreateEscalationInput {
  type: string;
  subtype: string;
  modality: string;
  description?: string;
  priority?: number;
  task_id?: string;
  origin_id?: string;
  parent_id?: string;
  role: string;
  envelope: string;
  metadata?: Record<string, any>;
  escalation_payload?: string;
  workflow_id?: string;
  task_queue?: string;
  workflow_type?: string;
}

export interface ClaimResult {
  escalation: LTEscalationRecord;
  isExtension: boolean;
}

export async function createEscalation(
  input: CreateEscalationInput,
): Promise<LTEscalationRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO lt_escalations
       (type, subtype, modality, description, priority, task_id,
        origin_id, parent_id, role, envelope, metadata, escalation_payload,
        workflow_id, task_queue, workflow_type)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
     RETURNING *`,
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
    `WITH prev AS (
       SELECT assigned_to, assigned_until
       FROM lt_escalations
       WHERE id = $1
     ),
     updated AS (
       UPDATE lt_escalations
       SET assigned_to = $2,
           claimed_at = NOW(),
           assigned_until = NOW() + INTERVAL '1 minute' * $3
       WHERE id = $1
         AND status = 'pending'
         AND (
           assigned_to IS NULL
           OR assigned_until <= NOW()
           OR assigned_to = $2
         )
       RETURNING *
     )
     SELECT updated.*,
            prev.assigned_to AS prev_assigned_to
     FROM updated
     CROSS JOIN prev`,
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
    `UPDATE lt_escalations
     SET status = 'resolved',
         resolved_at = NOW(),
         resolver_payload = $2
     WHERE id = $1
       AND status = 'pending'
     RETURNING *`,
    [id, JSON.stringify(resolverPayload)],
  );
  return rows[0] || null;
}

/**
 * Optional cleanup: clear stale assignment data on expired claims.
 * Not strictly required — expired claims are implicitly available
 * since queries check assigned_until <= NOW().
 */
export async function releaseExpiredClaims(): Promise<number> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE lt_escalations
     SET assigned_to = NULL,
         assigned_until = NULL,
         claimed_at = NULL
     WHERE status = 'pending'
       AND assigned_to IS NOT NULL
       AND assigned_until < NOW()`,
  );
  return rowCount || 0;
}

export async function getEscalation(id: string): Promise<LTEscalationRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_escalations WHERE id = $1',
    [id],
  );
  return rows[0] || null;
}

export async function getEscalationsByTaskId(
  taskId: string,
): Promise<LTEscalationRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_escalations WHERE task_id = $1 ORDER BY created_at DESC',
    [taskId],
  );
  return rows;
}

export async function getEscalationsByWorkflowId(
  workflowId: string,
): Promise<LTEscalationRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_escalations WHERE workflow_id = $1 ORDER BY created_at DESC',
    [workflowId],
  );
  return rows;
}

export async function listEscalations(filters: {
  status?: LTEscalationStatus;
  role?: string;
  type?: string;
  subtype?: string;
  assigned_to?: string;
  limit?: number;
  offset?: number;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.role) {
    conditions.push(`role = $${idx++}`);
    values.push(filters.role);
  }
  if (filters.type) {
    conditions.push(`type = $${idx++}`);
    values.push(filters.type);
  }
  if (filters.subtype) {
    conditions.push(`subtype = $${idx++}`);
    values.push(filters.subtype);
  }
  if (filters.assigned_to) {
    conditions.push(`assigned_to = $${idx++}`);
    values.push(filters.assigned_to);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_escalations ${where}`, values),
    pool.query(
      `SELECT * FROM lt_escalations ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    escalations: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * List available escalations: pending AND (unassigned OR expired claim).
 */
export async function listAvailableEscalations(filters: {
  role?: string;
  type?: string;
  subtype?: string;
  limit?: number;
  offset?: number;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [
    "status = 'pending'",
    '(assigned_to IS NULL OR assigned_until <= NOW())',
  ];
  const values: any[] = [];
  let idx = 1;

  if (filters.role) {
    conditions.push(`role = $${idx++}`);
    values.push(filters.role);
  }
  if (filters.type) {
    conditions.push(`type = $${idx++}`);
    values.push(filters.type);
  }
  if (filters.subtype) {
    conditions.push(`subtype = $${idx++}`);
    values.push(filters.subtype);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_escalations ${where}`, values),
    pool.query(
      `SELECT * FROM lt_escalations ${where}
       ORDER BY priority ASC, created_at ASC
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    escalations: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}
