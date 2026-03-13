import { getPool } from '../db';
import type { LTTaskRecord } from '../../types';
import type { ProcessSummary, ProcessStats } from './types';
import { VALID_PERIODS } from './types';
import {
  GET_PROCESS_TASKS,
  processStatsTotals,
  processStatsByType,
} from './sql';

export async function listProcesses(filters: {
  limit?: number;
  offset?: number;
  workflow_type?: string;
  status?: string;
  search?: string;
}): Promise<{ processes: ProcessSummary[]; total: number }> {
  const pool = getPool();
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  // Build WHERE conditions that restrict which origin_ids are included
  const conditions: string[] = ['origin_id IS NOT NULL'];
  const filterParams: any[] = [];
  let idx = 1;

  if (filters.workflow_type) {
    conditions.push(`origin_id IN (
      SELECT origin_id FROM lt_tasks
      WHERE origin_id IS NOT NULL AND workflow_type = $${idx++}
    )`);
    filterParams.push(filters.workflow_type);
  }

  if (filters.search) {
    const pattern = `%${filters.search}%`;
    conditions.push(`origin_id IN (
      SELECT DISTINCT origin_id FROM lt_tasks
      WHERE origin_id IS NOT NULL
        AND (origin_id ILIKE $${idx} OR workflow_id ILIKE $${idx} OR trace_id ILIKE $${idx})
    )`);
    filterParams.push(pattern);
    idx++;
  }

  const where = `WHERE ${conditions.join(' AND ')}`;

  // Status filter uses HAVING on aggregated counts
  let having = '';
  if (filters.status === 'completed') {
    having = 'HAVING COUNT(*) = COUNT(*) FILTER (WHERE status = \'completed\')';
  } else if (filters.status === 'escalated') {
    having = 'HAVING COUNT(*) FILTER (WHERE status = \'needs_intervention\') > 0';
  } else if (filters.status === 'active') {
    having = `HAVING COUNT(*) > COUNT(*) FILTER (WHERE status = 'completed')
              AND COUNT(*) FILTER (WHERE status = 'needs_intervention') = 0`;
  }

  // Count query — wrap in subquery because of HAVING
  const countSql = having
    ? `SELECT COUNT(*) FROM (
         SELECT origin_id FROM lt_tasks ${where}
         GROUP BY origin_id ${having}
       ) sub`
    : `SELECT COUNT(DISTINCT origin_id) FROM lt_tasks ${where}`;

  const dataSql = `SELECT
       origin_id,
       COUNT(*)::int AS task_count,
       COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
       COUNT(*) FILTER (WHERE status = 'needs_intervention')::int AS escalated,
       array_agg(DISTINCT workflow_type) AS workflow_types,
       MIN(created_at) AS started_at,
       MAX(COALESCE(completed_at, created_at)) AS last_activity
     FROM lt_tasks
     ${where}
     GROUP BY origin_id
     ${having}
     ORDER BY MAX(created_at) DESC
     LIMIT $${idx++} OFFSET $${idx++}`;

  const dataParams = [...filterParams, limit, offset];

  const [countResult, dataResult] = await Promise.all([
    pool.query(countSql, filterParams),
    pool.query(dataSql, dataParams),
  ]);

  return {
    processes: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

export async function getProcessStats(
  period?: string,
): Promise<ProcessStats> {
  const pool = getPool();

  const interval = VALID_PERIODS[period ?? '24h'] ?? '24 hours';

  // Aggregate process summaries within the time window
  const { rows } = await pool.query(processStatsTotals(interval));

  const totals = rows[0];

  // By workflow type (most active types in the period)
  const { rows: byType } = await pool.query(processStatsByType(interval));

  return {
    total: totals.total,
    active: totals.active,
    completed: totals.completed,
    escalated: totals.escalated,
    by_workflow_type: byType,
  };
}

export async function getProcessTasks(
  originId: string,
): Promise<LTTaskRecord[]> {
  const pool = getPool();
  const { rows } = await pool.query(GET_PROCESS_TASKS, [originId]);
  return rows;
}
