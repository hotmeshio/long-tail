// ---------------------------------------------------------------------------
// Task service — externalized SQL
// ---------------------------------------------------------------------------

// ---- crud.ts queries ------------------------------------------------------

// A task is 1:1 with its workflow_id. ON CONFLICT (workflow_id) makes createTask
// idempotent under proxyActivity retry (maximumAttempts: 3) and re-driven sagas:
// a retry re-targets the SAME row instead of inserting a duplicate. The no-op
// DO UPDATE is required so RETURNING yields the existing row on conflict; the
// `(xmax = 0)` flag tells the caller whether this call actually inserted (so the
// `task.created` event fires exactly once). Requires the unique index from
// migration 012.
export const CREATE_TASK = `
  INSERT INTO lt_tasks
    (workflow_id, workflow_type, lt_type, task_queue, signal_id,
     parent_workflow_id, origin_id, parent_id, envelope, metadata, priority,
     trace_id, span_id, initiated_by, principal_type, executing_as, status)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, COALESCE($17, 'pending'))
  ON CONFLICT (workflow_id) DO UPDATE SET workflow_id = lt_tasks.workflow_id
  RETURNING *, (xmax = 0) AS _inserted`;

export const APPEND_MILESTONES = `
  UPDATE lt_tasks
  SET milestones = milestones || $1::jsonb
  WHERE id = $2
  RETURNING *`;

export const GET_TASK = `SELECT * FROM lt_tasks WHERE id = $1`;

export const GET_TASK_BY_SIGNAL_ID = `SELECT * FROM lt_tasks WHERE signal_id = $1`;

export const GET_TASK_BY_WORKFLOW_ID = `SELECT * FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1`;

/**
 * Build the partial-update statement for updateTask. The caller assembles the
 * `SET` clause from whichever fields are present (each as a `$n` placeholder) and
 * passes the placeholder index of the trailing `id` bind. One guarded UPDATE by
 * primary key — no read-then-write.
 */
export function updateTaskById(setClause: string, idIdx: number): string {
  return `UPDATE lt_tasks SET ${setClause} WHERE id = $${idIdx} RETURNING *`;
}

/** Count query for listTasks. `where` is the caller-built `WHERE …` clause (or ''). */
export function listTasksCount(where: string): string {
  return `SELECT COUNT(*) FROM lt_tasks ${where}`;
}

/** Page query for listTasks. limit/offset placeholder indices follow the filter binds. */
export function listTasksData(where: string, limitIdx: number, offsetIdx: number): string {
  return `SELECT * FROM lt_tasks ${where} ORDER BY created_at DESC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
}

// ---- resolve.ts queries ---------------------------------------------------

export const RESOLVE_TASK_BY_WORKFLOW_ID = `SELECT workflow_type, task_queue FROM lt_tasks WHERE workflow_id = $1 ORDER BY created_at DESC LIMIT 1`;

export const RESOLVE_CONFIG_TASK_QUEUE = `SELECT task_queue FROM lt_config_workflows WHERE workflow_type = $1`;

/**
 * Look up a job's entity tag in a specific HotMesh namespace. The namespace is a
 * Postgres schema name, so it is interpolated (not a bind param) — same pattern
 * as the diagnostics queries. Callers pass the trusted app_id from config.
 */
export const RESOLVE_JOB_ENTITY = (appId: string): string =>
  `SELECT entity FROM "${appId}".jobs WHERE key = $1 LIMIT 1`;

// ---- process.ts queries ---------------------------------------------------

export const GET_PROCESS_TASKS = `SELECT * FROM lt_tasks WHERE origin_id = $1 ORDER BY created_at ASC`;

/**
 * Count query for listProcesses. `where` restricts which origin_ids are in scope;
 * `having` (empty string when no status filter) aggregates per-origin counts, so the
 * count must wrap the grouped set in a subquery. Both fragments carry only `$n` binds.
 */
export function listProcessesCount(where: string, having: string): string {
  return having
    ? `SELECT COUNT(*) FROM (
         SELECT origin_id FROM lt_tasks ${where}
         GROUP BY origin_id ${having}
       ) sub`
    : `SELECT COUNT(DISTINCT origin_id) FROM lt_tasks ${where}`;
}

/**
 * Page query for listProcesses — one row per origin_id with rolled-up task counts,
 * workflow types, and activity window. limit/offset placeholder indices follow the
 * filter binds.
 */
export function listProcessesData(
  where: string,
  having: string,
  limitIdx: number,
  offsetIdx: number,
): string {
  return `SELECT
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
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
}

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
