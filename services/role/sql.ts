// ─── Escalation chain queries ───────────────────────────────────────────────

export const GET_ESCALATION_TARGETS = `
  SELECT target_role
  FROM lt_config_role_escalations
  WHERE source_role = $1
  ORDER BY target_role`;

export const GET_ALL_ESCALATION_CHAINS = `
  SELECT source_role, target_role
  FROM lt_config_role_escalations
  ORDER BY source_role, target_role`;

export const INSERT_ESCALATION_CHAIN = `
  INSERT INTO lt_config_role_escalations (source_role, target_role)
  VALUES ($1, $2)
  ON CONFLICT DO NOTHING`;

/**
 * Add an escalation chain in ONE atomic statement: ensure both role FK targets
 * exist, then insert the source→target link. Postgres checks the chain's FK to
 * lt_roles at statement end (after the sibling ensure CTEs run), so brand-new
 * roles are valid targets. Replaces the former ensure+ensure+insert three-call
 * saga, which had no transaction guarding the writes together.
 */
export const ADD_ESCALATION_CHAIN = `
  WITH ensured_source AS (
    INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING
  ), ensured_target AS (
    INSERT INTO lt_roles (role) VALUES ($2) ON CONFLICT DO NOTHING
  )
  INSERT INTO lt_config_role_escalations (source_role, target_role)
  VALUES ($1, $2)
  ON CONFLICT DO NOTHING`;

export const DELETE_ESCALATION_CHAIN = `
  DELETE FROM lt_config_role_escalations
  WHERE source_role = $1 AND target_role = $2`;

export const DELETE_ESCALATION_CHAINS_BY_SOURCE = `
  DELETE FROM lt_config_role_escalations
  WHERE source_role = $1`;

export const CHECK_ESCALATION_CHAIN_EXISTS = `
  SELECT 1
  FROM lt_config_role_escalations
  WHERE source_role = $1 AND target_role = $2`;

// ─── Role CRUD ──────────────────────────────────────────────────────────────

export const ENSURE_ROLE_EXISTS = `
  INSERT INTO lt_roles (role) VALUES ($1)
  ON CONFLICT DO NOTHING`;

export const LIST_ROLES = `
  SELECT role FROM lt_roles ORDER BY role`;

export const DELETE_ROLE = `
  DELETE FROM lt_roles WHERE role = $1`;

// ─── Role detail aggregation ────────────────────────────────────────────────

export const LIST_ROLES_WITH_DETAILS = `
  WITH
  user_counts AS (
    SELECT role, COUNT(DISTINCT user_id)::int AS cnt
    FROM lt_user_roles
    GROUP BY role
  ),
  chain_counts AS (
    SELECT role, COUNT(*)::int AS cnt
    FROM (
      SELECT source_role AS role FROM lt_config_role_escalations
      UNION ALL
      SELECT target_role AS role FROM lt_config_role_escalations
    ) c
    GROUP BY role
  ),
  workflow_counts AS (
    SELECT role, COUNT(*)::int AS cnt
    FROM lt_config_roles
    GROUP BY role
  )
  SELECT
    r.role,
    COALESCE(uc.cnt, 0) AS user_count,
    COALESCE(cc.cnt, 0) AS chain_count,
    COALESCE(wc.cnt, 0) AS workflow_count
  FROM lt_roles r
  LEFT JOIN user_counts uc ON uc.role = r.role
  LEFT JOIN chain_counts cc ON cc.role = r.role
  LEFT JOIN workflow_counts wc ON wc.role = r.role
  ORDER BY r.role`;

// ─── Role surface config (title / purpose / schema / home_view) ────────────

export const GET_ROLE_CONFIG = `
  SELECT role, title, purpose, metadata_schema, home_view
  FROM lt_roles
  WHERE role = $1`;

/**
 * Upsert a role's self-describing config in ONE atomic statement. On a new role
 * it inserts with the provided values; on an existing role COALESCE keeps the
 * current value wherever the patch is NULL — so a partial patch never clobbers
 * unrelated fields. EXCLUDED is the proposed insert row.
 *
 * Note: a data-modifying CTE that inserts the role would NOT be visible to a
 * sibling UPDATE's scan in the same statement, so a single INSERT … ON CONFLICT
 * (not ensure-CTE + UPDATE) is the correct atomic form here.
 */
export const UPSERT_ROLE_META = `
  INSERT INTO lt_roles (role, title, purpose, metadata_schema, home_view)
  VALUES ($1, $2, $3, $4::jsonb, $5)
  ON CONFLICT (role) DO UPDATE SET
    title           = COALESCE(EXCLUDED.title, lt_roles.title),
    purpose         = COALESCE(EXCLUDED.purpose, lt_roles.purpose),
    metadata_schema = COALESCE(EXCLUDED.metadata_schema, lt_roles.metadata_schema),
    home_view       = COALESCE(EXCLUDED.home_view, lt_roles.home_view)`;

// ─── Role dials (declared per-unit TAT target per station) ─────────────────

// NUMERIC casts to float8 so the driver returns JS numbers, not strings.
export const GET_ROLE_DIALS = `
  SELECT
    role,
    station_key,
    target_tat_seconds::float8 AS target_tat_seconds,
    created_at,
    updated_at
  FROM lt_role_dials
  WHERE role = $1
  ORDER BY station_key`;

/**
 * Upsert a dial in ONE atomic statement: ensure the role FK target exists, then
 * insert/update the per-unit TAT target. Postgres checks the dial's FK to
 * lt_roles at statement end (after the ensure CTE runs), so a brand-new role is a
 * valid target — the same pattern as ADD_ESCALATION_CHAIN.
 */
export const UPSERT_ROLE_DIAL = `
  WITH ensured AS (
    INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING
  )
  INSERT INTO lt_role_dials (role, station_key, target_tat_seconds)
  VALUES ($1, $2, $3)
  ON CONFLICT (role, station_key) DO UPDATE SET
    target_tat_seconds = EXCLUDED.target_tat_seconds`;

export const DELETE_ROLE_DIAL = `
  DELETE FROM lt_role_dials WHERE role = $1 AND station_key = $2`;

// ─── Reference checks (used before role deletion) ──────────────────────────

export const COUNT_USER_ROLE_REFS = `
  SELECT COUNT(*)::int AS cnt FROM lt_user_roles WHERE role = $1`;

export const COUNT_CHAIN_REFS = `
  SELECT COUNT(*)::int AS cnt
  FROM lt_config_role_escalations
  WHERE source_role = $1 OR target_role = $1`;

export const COUNT_WORKFLOW_REFS = `
  SELECT COUNT(*)::int AS cnt FROM lt_config_roles WHERE role = $1`;

export const COUNT_ACTIVE_ESCALATION_REFS = `
  SELECT COUNT(*)::int AS cnt
  FROM lt_escalations
  WHERE role = $1 AND status IN ('pending', 'claimed')`;
