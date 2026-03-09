import { getPool } from './db';
import type { LTTaskRecord, LTTaskStatus, LTMilestone } from '../types';

export interface ResolvedHandle {
  taskQueue: string;
  workflowName: string;
}

export interface CreateTaskInput {
  workflow_id: string;
  workflow_type: string;
  lt_type: string;
  task_queue?: string;
  modality?: string;
  signal_id: string;
  parent_workflow_id: string;
  origin_id?: string;
  parent_id?: string;
  envelope: string;
  metadata?: Record<string, any>;
  priority?: number;
  trace_id?: string;
  span_id?: string;
}

export interface UpdateTaskInput {
  status?: LTTaskStatus;
  completed_at?: Date;
  error?: string;
  milestones?: LTMilestone[];
  data?: string;
}

export async function createTask(input: CreateTaskInput): Promise<LTTaskRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO lt_tasks
       (workflow_id, workflow_type, lt_type, task_queue, modality, signal_id,
        parent_workflow_id, origin_id, parent_id, envelope, metadata, priority,
        trace_id, span_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING *`,
    [
      input.workflow_id,
      input.workflow_type,
      input.lt_type,
      input.task_queue || null,
      input.modality || null,
      input.signal_id,
      input.parent_workflow_id,
      input.origin_id || null,
      input.parent_id || null,
      input.envelope,
      input.metadata ? JSON.stringify(input.metadata) : null,
      input.priority || 2,
      input.trace_id || null,
      input.span_id || null,
    ],
  );
  return rows[0];
}

export async function updateTask(
  id: string,
  input: UpdateTaskInput,
): Promise<LTTaskRecord> {
  const pool = getPool();
  const sets: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (input.status !== undefined) {
    sets.push(`status = $${idx++}`);
    values.push(input.status);
  }
  if (input.completed_at !== undefined) {
    sets.push(`completed_at = $${idx++}`);
    values.push(input.completed_at);
  }
  if (input.error !== undefined) {
    sets.push(`error = $${idx++}`);
    values.push(input.error);
  }
  if (input.data !== undefined) {
    sets.push(`data = $${idx++}`);
    values.push(input.data);
  }
  if (input.milestones !== undefined) {
    sets.push(`milestones = $${idx++}`);
    values.push(JSON.stringify(input.milestones));
  }

  values.push(id);
  const { rows } = await pool.query(
    `UPDATE lt_tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  );
  return rows[0];
}

export async function appendMilestones(
  id: string,
  milestones: LTMilestone[],
): Promise<LTTaskRecord> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE lt_tasks
     SET milestones = milestones || $1::jsonb
     WHERE id = $2
     RETURNING *`,
    [JSON.stringify(milestones), id],
  );
  return rows[0];
}

export async function getTask(id: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM lt_tasks WHERE id = $1', [id]);
  return rows[0] || null;
}

export async function getTaskBySignalId(signalId: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_tasks WHERE signal_id = $1',
    [signalId],
  );
  return rows[0] || null;
}

export async function getTaskByWorkflowId(workflowId: string): Promise<LTTaskRecord | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    'SELECT * FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1',
    [workflowId],
  );
  return rows[0] || null;
}

export async function listTasks(filters: {
  status?: LTTaskStatus;
  lt_type?: string;
  workflow_type?: string;
  workflow_id?: string;
  parent_workflow_id?: string;
  origin_id?: string;
  limit?: number;
  offset?: number;
}): Promise<{ tasks: LTTaskRecord[]; total: number }> {
  const pool = getPool();
  const conditions: string[] = [];
  const values: any[] = [];
  let idx = 1;

  if (filters.status) {
    conditions.push(`status = $${idx++}`);
    values.push(filters.status);
  }
  if (filters.lt_type) {
    conditions.push(`lt_type = $${idx++}`);
    values.push(filters.lt_type);
  }
  if (filters.workflow_type) {
    conditions.push(`workflow_type = $${idx++}`);
    values.push(filters.workflow_type);
  }
  if (filters.workflow_id) {
    conditions.push(`workflow_id = $${idx++}`);
    values.push(filters.workflow_id);
  }
  if (filters.parent_workflow_id) {
    conditions.push(`parent_workflow_id = $${idx++}`);
    values.push(filters.parent_workflow_id);
  }
  if (filters.origin_id) {
    conditions.push(`origin_id = $${idx++}`);
    values.push(filters.origin_id);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = filters.limit || 50;
  const offset = filters.offset || 0;

  const [countResult, dataResult] = await Promise.all([
    pool.query(`SELECT COUNT(*) FROM lt_tasks ${where}`, values),
    pool.query(
      `SELECT * FROM lt_tasks ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    tasks: dataResult.rows,
    total: parseInt(countResult.rows[0].count, 10),
  };
}

/**
 * Resolve a workflowId to the (taskQueue, workflowName) pair that
 * HotMesh needs to get a workflow handle.
 *
 * 1. Look up lt_tasks by workflow_id — returns workflow_type and task_queue.
 * 2. If no task record (e.g., orchestrators/containers), fall back to
 *    durable.jobs (entity) + lt_config_workflows (task_queue).
 * 3. If task_queue is null (pre-migration record), fall back to lt_config_workflows.
 * 4. Throws if the workflow cannot be resolved.
 */
export async function resolveWorkflowHandle(
  workflowId: string,
): Promise<ResolvedHandle> {
  const pool = getPool();

  // 1. Try lt_tasks first (leaf workflows)
  const { rows } = await pool.query(
    'SELECT workflow_type, task_queue FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1',
    [workflowId],
  );

  if (rows.length > 0) {
    const { workflow_type, task_queue } = rows[0];

    if (task_queue) {
      return { taskQueue: task_queue, workflowName: workflow_type };
    }

    // Fallback: resolve task_queue from config (pre-migration records)
    const { rows: configRows } = await pool.query(
      'SELECT task_queue FROM lt_config_workflows WHERE workflow_type = $1',
      [workflow_type],
    );

    if (configRows.length > 0 && configRows[0].task_queue) {
      return { taskQueue: configRows[0].task_queue, workflowName: workflow_type };
    }
  }

  // 2. Fall back to durable.jobs — handles orchestrators/containers that
  //    have no lt_tasks record but do have a job with an entity tag.
  const { rows: jobRows } = await pool.query(
    `SELECT entity FROM durable.jobs WHERE key = $1 LIMIT 1`,
    [`hmsh:durable:j:${workflowId}`],
  );

  if (jobRows.length > 0 && jobRows[0].entity) {
    const entity = jobRows[0].entity;
    const { rows: configRows } = await pool.query(
      'SELECT task_queue FROM lt_config_workflows WHERE workflow_type = $1',
      [entity],
    );

    if (configRows.length > 0 && configRows[0].task_queue) {
      return { taskQueue: configRows[0].task_queue, workflowName: entity };
    }
  }

  throw new Error(
    `Cannot resolve workflow "${workflowId}" — no task record or job entity found`,
  );
}

// ── Process queries ──────────────────────────────────────────────────────────

export interface ProcessSummary {
  origin_id: string;
  task_count: number;
  completed: number;
  escalated: number;
  workflow_types: string[];
  started_at: string;
  last_activity: string;
}

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

export interface ProcessStats {
  total: number;
  active: number;
  completed: number;
  escalated: number;
  by_workflow_type: {
    workflow_type: string;
    total: number;
    active: number;
    completed: number;
    escalated: number;
  }[];
}

const VALID_PERIODS: Record<string, string> = {
  '1h': '1 hour',
  '24h': '24 hours',
  '7d': '7 days',
  '30d': '30 days',
};

export async function getProcessStats(
  period?: string,
): Promise<ProcessStats> {
  const pool = getPool();

  const interval = VALID_PERIODS[period ?? '24h'] ?? '24 hours';

  // Aggregate process summaries within the time window
  const { rows } = await pool.query(`
    WITH process_stats AS (
      SELECT
        origin_id,
        COUNT(*)::int AS task_count,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
        COUNT(*) FILTER (WHERE status = 'needs_intervention')::int AS escalated_count
      FROM lt_tasks
      WHERE origin_id IS NOT NULL
        AND created_at > NOW() - INTERVAL '${interval}'
      GROUP BY origin_id
    )
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE completed_count = task_count AND task_count > 0)::int AS completed,
      COUNT(*) FILTER (WHERE escalated_count > 0)::int AS escalated,
      COUNT(*) FILTER (
        WHERE completed_count < task_count
          AND escalated_count = 0
      )::int AS active
    FROM process_stats
  `);

  const totals = rows[0];

  // By workflow type (most active types in the period)
  const { rows: byType } = await pool.query(`
    WITH task_window AS (
      SELECT
        origin_id,
        workflow_type,
        status
      FROM lt_tasks
      WHERE origin_id IS NOT NULL
        AND created_at > NOW() - INTERVAL '${interval}'
    ),
    per_origin AS (
      SELECT
        origin_id,
        COUNT(*)::int AS task_count,
        COUNT(*) FILTER (WHERE status = 'completed')::int AS completed_count,
        COUNT(*) FILTER (WHERE status = 'needs_intervention')::int AS escalated_count,
        (array_agg(DISTINCT workflow_type))[1] AS primary_workflow_type
      FROM task_window
      GROUP BY origin_id
    )
    SELECT
      primary_workflow_type AS workflow_type,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE completed_count < task_count AND escalated_count = 0)::int AS active,
      COUNT(*) FILTER (WHERE completed_count = task_count AND task_count > 0)::int AS completed,
      COUNT(*) FILTER (WHERE escalated_count > 0)::int AS escalated
    FROM per_origin
    GROUP BY primary_workflow_type
    ORDER BY COUNT(*) DESC
  `);

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
  const { rows } = await pool.query(
    'SELECT * FROM lt_tasks WHERE origin_id = $1 ORDER BY created_at ASC',
    [originId],
  );
  return rows;
}
