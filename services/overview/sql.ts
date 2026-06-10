/**
 * SQL for the system overview tool.
 *
 * All queries are SELECT-only, read-safe, and index-backed.
 * They target only lt_* tables — no HotMesh schema dependencies.
 * $1 is always the period interval (e.g., '24 hours').
 */

// ── Triage ──────────────────────────────────────────────────────────────────

/** Escalation queue pressure — aging buckets, claim status, period counts. */
export const OVERVIEW_ESCALATION_TRIAGE = `
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
    COUNT(*) FILTER (WHERE status = 'pending'
      AND assigned_to IS NOT NULL AND assigned_until > NOW())::int AS claimed,
    COUNT(*) FILTER (WHERE status = 'pending'
      AND (assigned_to IS NULL OR assigned_until <= NOW()))::int AS unclaimed,
    COUNT(*) FILTER (WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '30 minutes')::int AS aging_30m,
    COUNT(*) FILTER (WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '1 hour')::int AS aging_1h,
    COUNT(*) FILTER (WHERE status = 'pending'
      AND created_at < NOW() - INTERVAL '24 hours')::int AS aging_24h,
    COALESCE(
      EXTRACT(EPOCH FROM (NOW() - MIN(created_at) FILTER (
        WHERE status = 'pending'
        AND (assigned_to IS NULL OR assigned_until <= NOW())
      )))::int / 60, 0
    ) AS oldest_unclaimed_minutes,
    COUNT(*) FILTER (WHERE created_at > NOW() - $1::interval)::int AS created_period,
    COUNT(*) FILTER (WHERE resolved_at > NOW() - $1::interval)::int AS resolved_period
  FROM lt_escalations`;

/** Escalation breakdown by role (pending only). */
export const OVERVIEW_ESCALATION_BY_ROLE = `
  SELECT role,
    COUNT(*)::int AS pending,
    COUNT(*) FILTER (WHERE assigned_to IS NOT NULL AND assigned_until > NOW())::int AS claimed
  FROM lt_escalations
  WHERE status = 'pending'
  GROUP BY role
  ORDER BY COUNT(*) DESC
  LIMIT 10`;

// ── Throughput ───────────────────────────────────────────────────────────────

/** Task creation and completion counts for 1h and the configurable period. */
export const OVERVIEW_TASK_THROUGHPUT = `
  SELECT
    COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
    COUNT(*) FILTER (WHERE status = 'in_progress')::int AS in_progress,
    COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
    COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS created_1h,
    COUNT(*) FILTER (WHERE completed_at > NOW() - INTERVAL '1 hour')::int AS completed_1h,
    COUNT(*) FILTER (WHERE created_at > NOW() - $1::interval)::int AS created_period,
    COUNT(*) FILTER (WHERE completed_at > NOW() - $1::interval)::int AS completed_period,
    COUNT(*) FILTER (WHERE status = 'failed'
      AND created_at > NOW() - INTERVAL '1 hour')::int AS failed_1h
  FROM lt_tasks`;

// ── Trends ──────────────────────────────────────────────────────────────────

/** Hourly escalation creation within the period. */
export const OVERVIEW_ESCALATION_TRENDS = `
  SELECT date_trunc('hour', created_at) AS hour, COUNT(*)::int AS created
  FROM lt_escalations
  WHERE created_at > NOW() - $1::interval
  GROUP BY 1 ORDER BY 1`;

/** Hourly task completion within the period. */
export const OVERVIEW_TASK_TRENDS = `
  SELECT date_trunc('hour', completed_at) AS hour, COUNT(*)::int AS completed
  FROM lt_tasks
  WHERE completed_at IS NOT NULL AND completed_at > NOW() - $1::interval
  GROUP BY 1 ORDER BY 1`;

/** Hourly resolution velocity — created vs resolved. */
export const OVERVIEW_RESOLUTION_TRENDS = `
  SELECT
    gs AS hour,
    COALESCE(c.created, 0)::int AS created,
    COALESCE(r.resolved, 0)::int AS resolved
  FROM generate_series(
    date_trunc('hour', NOW() - $1::interval),
    date_trunc('hour', NOW()),
    INTERVAL '1 hour'
  ) AS gs
  LEFT JOIN (
    SELECT date_trunc('hour', created_at) AS h, COUNT(*)::int AS created
    FROM lt_escalations WHERE created_at > NOW() - $1::interval
    GROUP BY 1
  ) c ON c.h = gs
  LEFT JOIN (
    SELECT date_trunc('hour', resolved_at) AS h, COUNT(*)::int AS resolved
    FROM lt_escalations WHERE resolved_at > NOW() - $1::interval
    GROUP BY 1
  ) r ON r.h = gs
  ORDER BY gs`;

// ── Infrastructure ──────────────────────────────────────────────────────────

/** MCP server and tool counts. */
export const OVERVIEW_MCP_INFRASTRUCTURE = `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status = 'connected')::int AS connected,
    COALESCE(SUM(jsonb_array_length(tool_manifest)) FILTER (WHERE tool_manifest IS NOT NULL), 0)::int AS total_tools
  FROM lt_mcp_servers`;

/** Compiled workflow counts. */
export const OVERVIEW_COMPILED_WORKFLOWS = `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status = 'active')::int AS active
  FROM lt_yaml_workflows`;

/** Agent health snapshot. */
export const OVERVIEW_AGENT_HEALTH = `
  SELECT
    COUNT(*)::int AS total,
    COUNT(*) FILTER (WHERE status = 'active')::int AS active,
    COUNT(*) FILTER (WHERE status = 'paused')::int AS paused,
    COUNT(*) FILTER (WHERE status = 'error')::int AS error,
    COUNT(*) FILTER (WHERE last_run_at IS NULL
      OR last_run_at < NOW() - INTERVAL '7 days')::int AS stale
  FROM lt_agents`;

/** Registered workflow config count. */
export const OVERVIEW_WORKFLOW_CONFIGS = `
  SELECT COUNT(*)::int AS total FROM lt_config_workflows`;

// ── Processes ───────────────────────────────────────────────────────────────

/** Process summary — grouped by origin_id within the period. */
export const OVERVIEW_PROCESS_SUMMARY = `
  SELECT
    COUNT(DISTINCT origin_id)::int AS total,
    COUNT(DISTINCT origin_id) FILTER (
      WHERE status IN ('pending', 'in_progress'))::int AS active,
    COUNT(DISTINCT origin_id) FILTER (
      WHERE status = 'completed')::int AS completed,
    COUNT(DISTINCT origin_id) FILTER (
      WHERE status = 'needs_intervention')::int AS escalated
  FROM lt_tasks
  WHERE origin_id IS NOT NULL
    AND created_at > NOW() - $1::interval`;
