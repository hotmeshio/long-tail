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

/**
 * PATCH semantics in ONE atomic statement: each column has a boolean
 * "provided" sentinel — when false the column keeps its current value, when
 * true the paired value is written (null clears; properties resets to '{}').
 * This is what lets the dashboard's per-tab saves and single-field MCP calls
 * coexist on the same row without read-modify-write.
 */
export const UPDATE_ROLE_METADATA = `
  UPDATE lt_roles SET
    title           = CASE WHEN $2::boolean  THEN $3                                ELSE title           END,
    description     = CASE WHEN $4::boolean  THEN $5                                ELSE description     END,
    form_schema     = CASE WHEN $6::boolean  THEN $7::jsonb                         ELSE form_schema     END,
    metadata_schema = CASE WHEN $8::boolean  THEN $9::jsonb                         ELSE metadata_schema END,
    properties      = CASE WHEN $10::boolean THEN COALESCE($11::jsonb, '{}'::jsonb) ELSE properties      END,
    ops_visible     = CASE WHEN $12::boolean THEN $13::boolean                      ELSE ops_visible     END,
    parent_role     = CASE WHEN $14::boolean THEN $15                               ELSE parent_role     END,
    sla_minutes     = CASE WHEN $16::boolean THEN $17::numeric                      ELSE sla_minutes     END,
    target_per_hour = CASE WHEN $18::boolean THEN $19::numeric                      ELSE target_per_hour END,
    worker_count    = CASE WHEN $20::boolean THEN $21::int                          ELSE worker_count    END
  WHERE role = $1
  RETURNING
    role, title, description, form_schema, metadata_schema, properties,
    ops_visible, parent_role, sla_minutes, target_per_hour, worker_count`;

export const GET_ROLE_FORM_SCHEMA = `
  SELECT form_schema FROM lt_roles WHERE role = $1`;

export const GET_ROLE_METADATA_SCHEMA = `
  SELECT metadata_schema FROM lt_roles WHERE role = $1`;

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
    r.title,
    r.description,
    r.form_schema,
    r.metadata_schema,
    r.properties,
    r.ops_visible,
    r.parent_role,
    r.sla_minutes,
    r.target_per_hour,
    r.worker_count,
    COALESCE(uc.cnt, 0) AS user_count,
    COALESCE(cc.cnt, 0) AS chain_count,
    COALESCE(wc.cnt, 0) AS workflow_count
  FROM lt_roles r
  LEFT JOIN user_counts uc ON uc.role = r.role
  LEFT JOIN chain_counts cc ON cc.role = r.role
  LEFT JOIN workflow_counts wc ON wc.role = r.role
  ORDER BY r.role`;

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
