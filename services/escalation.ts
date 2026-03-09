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
  trace_id?: string;
  span_id?: string;
}

export interface ClaimResult {
  escalation: LTEscalationRecord;
  isExtension: boolean;
}

export async function createEscalation(
  input: CreateEscalationInput,
): Promise<LTEscalationRecord> {
  const pool = getPool();
  // Ensure the role exists in lt_roles (FK constraint)
  await pool.query(
    'INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING',
    [input.role],
  );
  const { rows } = await pool.query(
    `INSERT INTO lt_escalations
       (type, subtype, modality, description, priority, task_id,
        origin_id, parent_id, role, envelope, metadata, escalation_payload,
        workflow_id, task_queue, workflow_type, trace_id, span_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
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
    `UPDATE lt_escalations
     SET priority = $1, updated_at = NOW()
     WHERE id = ANY($2::uuid[])
       AND status = 'pending'`,
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
    `SELECT DISTINCT role FROM lt_escalations WHERE id = ANY($1::uuid[])`,
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
    `UPDATE lt_escalations
     SET assigned_to = NULL,
         assigned_until = NULL,
         claimed_at = NULL
     WHERE id = $1
       AND status = 'pending'
       AND assigned_to = $2
     RETURNING *`,
    [id, userId],
  );
  return rows[0] || null;
}

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

/**
 * Bulk claim escalations for a user.
 * Items already claimed by another active user are skipped.
 */
export async function bulkClaimEscalations(
  ids: string[],
  userId: string,
  durationMinutes: number = 30,
): Promise<{ claimed: number; skipped: number }> {
  if (ids.length === 0) return { claimed: 0, skipped: 0 };
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE lt_escalations
     SET assigned_to = $1,
         claimed_at = NOW(),
         assigned_until = NOW() + INTERVAL '1 minute' * $2
     WHERE id = ANY($3::uuid[])
       AND status = 'pending'
       AND (
         assigned_to IS NULL
         OR assigned_until <= NOW()
         OR assigned_to = $1
       )`,
    [userId, durationMinutes, ids],
  );
  const claimed = rowCount ?? 0;
  return { claimed, skipped: ids.length - claimed };
}

/**
 * Bulk assign escalations to a specific user (admin action).
 * Items already claimed by another active user are skipped.
 */
export async function bulkAssignEscalations(
  ids: string[],
  targetUserId: string,
  durationMinutes: number = 30,
): Promise<{ assigned: number; skipped: number }> {
  if (ids.length === 0) return { assigned: 0, skipped: 0 };
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE lt_escalations
     SET assigned_to = $1,
         claimed_at = NOW(),
         assigned_until = NOW() + INTERVAL '1 minute' * $2
     WHERE id = ANY($3::uuid[])
       AND status = 'pending'
       AND (
         assigned_to IS NULL
         OR assigned_until <= NOW()
         OR assigned_to = $1
       )`,
    [targetUserId, durationMinutes, ids],
  );
  const assigned = rowCount ?? 0;
  return { assigned, skipped: ids.length - assigned };
}

/**
 * Bulk reassign escalations to a different role.
 * Clears assignment on all affected rows.
 */
export async function bulkEscalateToRole(
  ids: string[],
  targetRole: string,
): Promise<number> {
  if (ids.length === 0) return 0;
  const pool = getPool();
  const { rowCount } = await pool.query(
    `UPDATE lt_escalations
     SET role = $1,
         assigned_to = NULL,
         assigned_until = NULL,
         claimed_at = NULL,
         updated_at = NOW()
     WHERE id = ANY($2::uuid[])
       AND status = 'pending'`,
    [targetRole, ids],
  );
  return rowCount ?? 0;
}

/**
 * Bulk resolve escalations for AI triage.
 * Returns full records so the caller can start triage workflows.
 */
export async function bulkResolveForTriage(
  ids: string[],
  hint?: string,
): Promise<LTEscalationRecord[]> {
  if (ids.length === 0) return [];
  const pool = getPool();
  const resolverPayload = JSON.stringify({
    _lt: { needsTriage: true, ...(hint ? { hint } : {}) },
  });
  const { rows } = await pool.query(
    `UPDATE lt_escalations
     SET status = 'resolved',
         resolved_at = NOW(),
         resolver_payload = $1
     WHERE id = ANY($2::uuid[])
       AND status = 'pending'
     RETURNING *`,
    [resolverPayload, ids],
  );
  return rows;
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
    `UPDATE lt_escalations
     SET role = $2,
         assigned_to = NULL,
         assigned_until = NULL,
         claimed_at = NULL,
         updated_at = NOW()
     WHERE id = $1
       AND status = 'pending'
     RETURNING *`,
    [id, targetRole],
  );
  return rows[0] || null;
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

export async function getEscalationsByOriginId(
  originId: string,
): Promise<LTEscalationRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_escalations WHERE origin_id = $1 ORDER BY created_at DESC',
    [originId],
  );
  return rows;
}

export interface EscalationStats {
  pending: number;
  claimed: number;
  created: number;
  resolved: number;
  by_role: { role: string; pending: number; claimed: number }[];
  by_type: { type: string; pending: number; claimed: number; resolved: number }[];
}

const VALID_PERIODS: Record<string, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export async function getEscalationStats(
  visibleRoles?: string[],
  period?: string,
): Promise<EscalationStats> {
  const pool = getPool();

  const interval = VALID_PERIODS[period ?? '24h'] ?? '24 hours';

  // Build optional RBAC filter
  const roleFilter = visibleRoles ? `WHERE role = ANY($1::text[])` : '';
  const roleFilterAnd = visibleRoles ? `AND role = ANY($1::text[])` : '';
  const params = visibleRoles ? [visibleRoles] : [];

  // Global counts
  const { rows: [totals] } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'pending' AND assigned_to IS NOT NULL AND assigned_until > NOW()) AS claimed,
       COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '${interval}') AS created,
       COUNT(*) FILTER (WHERE resolved_at > NOW() - INTERVAL '${interval}') AS resolved
     FROM lt_escalations ${roleFilter}`,
    params,
  );

  // By-role breakdown (pending only)
  const { rows: byRole } = await pool.query(
    `SELECT role,
       COUNT(*) AS pending,
       COUNT(*) FILTER (WHERE assigned_to IS NOT NULL AND assigned_until > NOW()) AS claimed
     FROM lt_escalations
     WHERE status = 'pending' ${roleFilterAnd}
     GROUP BY role
     ORDER BY COUNT(*) DESC`,
    params,
  );

  // By-type breakdown (within the time period)
  const { rows: byType } = await pool.query(
    `SELECT type,
       COUNT(*) FILTER (WHERE status = 'pending') AS pending,
       COUNT(*) FILTER (WHERE status = 'pending' AND assigned_to IS NOT NULL AND assigned_until > NOW()) AS claimed,
       COUNT(*) FILTER (WHERE resolved_at IS NOT NULL) AS resolved
     FROM lt_escalations
     WHERE created_at > NOW() - INTERVAL '${interval}' ${roleFilterAnd}
     GROUP BY type
     ORDER BY COUNT(*) DESC`,
    params,
  );

  return {
    pending: parseInt(totals.pending),
    claimed: parseInt(totals.claimed),
    created: parseInt(totals.created),
    resolved: parseInt(totals.resolved),
    by_role: byRole.map((r: any) => ({
      role: r.role,
      pending: parseInt(r.pending),
      claimed: parseInt(r.claimed),
    })),
    by_type: byType.map((r: any) => ({
      type: r.type,
      pending: parseInt(r.pending),
      claimed: parseInt(r.claimed),
      resolved: parseInt(r.resolved),
    })),
  };
}

export async function listDistinctTypes(): Promise<string[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT DISTINCT type FROM lt_escalations ORDER BY type`,
  );
  return rows.map((r: any) => r.type);
}

/** Columns allowed for user-chosen ORDER BY. */
const SORTABLE_COLUMNS = new Set([
  'created_at', 'updated_at', 'priority', 'resolved_at', 'role', 'type',
]);

function buildOrderBy(sortBy?: string, order?: string, fallback = 'priority ASC, created_at ASC'): string {
  if (!sortBy || !SORTABLE_COLUMNS.has(sortBy)) return fallback;
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return `${sortBy} ${dir}`;
}

export async function listEscalations(filters: {
  status?: LTEscalationStatus;
  role?: string;
  type?: string;
  subtype?: string;
  assigned_to?: string;
  priority?: number;
  limit?: number;
  offset?: number;
  visibleRoles?: string[];
  sort_by?: string;
  order?: string;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  // RBAC: scope to roles the user is a member of
  if (filters.visibleRoles) {
    conditions.push(`role = ANY($${idx++}::text[])`);
    values.push(filters.visibleRoles);
  }

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
  if (filters.priority) {
    conditions.push(`priority = $${idx++}`);
    values.push(filters.priority);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const orderBy = buildOrderBy(filters.sort_by, filters.order);

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_escalations ${where}`, values),
    pool.query(
      `SELECT * FROM lt_escalations ${where} ORDER BY ${orderBy} LIMIT $${idx++} OFFSET $${idx++}`,
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
  priority?: number;
  limit?: number;
  offset?: number;
  visibleRoles?: string[];
  sort_by?: string;
  order?: string;
}): Promise<{ escalations: LTEscalationRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [
    "status = 'pending'",
    '(assigned_to IS NULL OR assigned_until <= NOW())',
  ];
  const values: any[] = [];
  let idx = 1;

  // RBAC: scope to roles the user is a member of
  if (filters.visibleRoles) {
    conditions.push(`role = ANY($${idx++}::text[])`);
    values.push(filters.visibleRoles);
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
  if (filters.priority) {
    conditions.push(`priority = $${idx++}`);
    values.push(filters.priority);
  }

  const where = `WHERE ${conditions.join(' AND ')}`;
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const orderBy = buildOrderBy(filters.sort_by, filters.order);

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_escalations ${where}`, values),
    pool.query(
      `SELECT * FROM lt_escalations ${where}
       ORDER BY ${orderBy}
       LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    escalations: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}
