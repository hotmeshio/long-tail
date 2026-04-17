import { getPool } from '../../lib/db';
import type { LTEscalationRecord, LTEscalationStatus } from '../../types';

import type { EscalationStats } from './types';
import { VALID_PERIODS, SORTABLE_COLUMNS } from './types';
import { LIST_DISTINCT_TYPES } from './sql';

function buildOrderBy(sortBy?: string, order?: string, fallback = 'priority ASC, created_at ASC'): string {
  if (!sortBy || !SORTABLE_COLUMNS.has(sortBy)) return fallback;
  const dir = order === 'asc' ? 'ASC' : 'DESC';
  return `${sortBy} ${dir}`;
}

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
  const { rows } = await pool.query(LIST_DISTINCT_TYPES);
  return rows.map((r: any) => r.type);
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
