// ---------------------------------------------------------------------------
// Task service — externalized SQL
// ---------------------------------------------------------------------------

// ---- crud.ts queries ------------------------------------------------------

export const CREATE_TASK = `
  INSERT INTO lt_tasks
    (workflow_id, workflow_type, lt_type, task_queue, signal_id,
     parent_workflow_id, origin_id, parent_id, envelope, metadata, priority,
     trace_id, span_id, initiated_by, principal_type, executing_as)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
  RETURNING *`;

export const APPEND_MILESTONES = `
  UPDATE lt_tasks
  SET milestones = milestones || $1::jsonb
  WHERE id = $2
  RETURNING *`;

export const GET_TASK = `SELECT * FROM lt_tasks WHERE id = $1`;

export const GET_TASK_BY_SIGNAL_ID = `SELECT * FROM lt_tasks WHERE signal_id = $1`;

export const GET_TASK_BY_WORKFLOW_ID = `SELECT * FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1`;

// ---- resolve.ts queries ---------------------------------------------------

export const RESOLVE_TASK_BY_WORKFLOW_ID = `SELECT workflow_type, task_queue FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1`;

export const RESOLVE_CONFIG_TASK_QUEUE = `SELECT task_queue FROM lt_config_workflows WHERE workflow_type = $1`;

export const RESOLVE_JOB_ENTITY = `SELECT entity FROM durable.jobs WHERE key = $1 LIMIT 1`;

// ---- process.ts queries ---------------------------------------------------

export const GET_PROCESS_TASKS = `SELECT * FROM lt_tasks WHERE origin_id = $1 ORDER BY created_at ASC`;

/**
 * Build the process-stats totals CTE query for a given interval.
 * The interval value MUST come from the VALID_PERIODS whitelist.
 */
export function processStatsTotals(interval: string): string {
  return `
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
    FROM process_stats`;
}

/**
 * Build the process-stats-by-type CTE query for a given interval.
 * The interval value MUST come from the VALID_PERIODS whitelist.
 */
export function processStatsByType(interval: string): string {
  return `
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
    ORDER BY COUNT(*) DESC`;
}
