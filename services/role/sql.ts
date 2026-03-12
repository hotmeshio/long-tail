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
