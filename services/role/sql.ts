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
 *
 * Schema versioning rides in the same statement: when a provided form_schema
 * or metadata_schema actually differs from the stored value (IS DISTINCT FROM,
 * evaluated against the pre-update row), current_schema_version advances and
 * the post-update schema pair is snapshotted into lt_role_schemas. A no-change
 * save leaves the version alone and the snapshot INSERT conflicts away.
 * $26 = optional change summary recorded on the snapshot.
 *
 * Upstream inputs ($27 = provided sentinel, $28 = replacement set) sync in the
 * same statement with replace semantics. The two CTEs deliberately avoid
 * touching the same row: the DELETE only removes rows leaving the set, and the
 * INSERT's ON CONFLICT DO NOTHING skips rows that stay (delete+insert of the
 * SAME key in one statement would silently drop it — CTEs share a snapshot).
 */
export const UPDATE_ROLE_METADATA = `
  WITH updated AS (
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
      worker_count    = CASE WHEN $20::boolean THEN $21::int                          ELSE worker_count    END,
      priority_threshold_minutes
                      = CASE WHEN $22::boolean THEN $23::numeric                      ELSE priority_threshold_minutes END,
      priority_facet  = CASE WHEN $24::boolean THEN $25                               ELSE priority_facet  END,
      current_schema_version = CASE
        WHEN ($6::boolean AND $7::jsonb IS DISTINCT FROM form_schema)
          OR ($8::boolean AND $9::jsonb IS DISTINCT FROM metadata_schema)
        THEN COALESCE(current_schema_version, 0) + 1
        ELSE current_schema_version END
    WHERE role = $1
    RETURNING
      role, title, description, form_schema, metadata_schema, properties,
      ops_visible, parent_role, sla_minutes, target_per_hour, worker_count,
      priority_threshold_minutes, priority_facet,
      current_schema_version
  ), snapshot AS (
    INSERT INTO lt_role_schemas (role, version, form_schema, metadata_schema, change_summary)
    SELECT role, current_schema_version, form_schema, metadata_schema, $26
    FROM updated
    WHERE ($6::boolean OR $8::boolean) AND current_schema_version IS NOT NULL
    ON CONFLICT (role, version) DO NOTHING
  ), upstream_prune AS (
    DELETE FROM lt_role_upstreams
    WHERE $27::boolean AND role = $1 AND upstream_role <> ALL($28::text[])
  ), upstream_add AS (
    INSERT INTO lt_role_upstreams (role, upstream_role)
    SELECT $1, u FROM unnest($28::text[]) AS u
    WHERE $27::boolean
    ON CONFLICT DO NOTHING
  )
  SELECT * FROM updated`;

export const GET_ROLE_FORM_SCHEMA = `
  SELECT form_schema FROM lt_roles WHERE role = $1`;

export const GET_ROLE_METADATA_SCHEMA = `
  SELECT metadata_schema FROM lt_roles WHERE role = $1`;

export const GET_ROLE_UPSTREAMS = `
  SELECT upstream_role FROM lt_role_upstreams WHERE role = $1 ORDER BY upstream_role`;

// ─── Versioned role schemas ─────────────────────────────────────────────────

export const LIST_ROLE_SCHEMA_VERSIONS = `
  SELECT
    s.version,
    s.form_schema IS NOT NULL     AS has_form_schema,
    s.metadata_schema IS NOT NULL AS has_metadata_schema,
    s.change_summary,
    s.created_at,
    s.version = r.current_schema_version AS is_current
  FROM lt_role_schemas s
  JOIN lt_roles r ON r.role = s.role
  WHERE s.role = $1
  ORDER BY s.version DESC`;

export const GET_ROLE_SCHEMA_VERSION = `
  SELECT s.role, s.version, s.form_schema, s.metadata_schema,
         s.change_summary, s.created_at, r.current_schema_version AS latest_version
  FROM lt_role_schemas s
  JOIN lt_roles r ON r.role = s.role
  WHERE s.role = $1 AND s.version = $2`;

/**
 * Latest schema resolves from the live lt_roles columns (a role that has never
 * versioned its schema still answers, with version NULL).
 */
export const GET_ROLE_SCHEMA_CURRENT = `
  SELECT r.role, r.current_schema_version AS version, r.form_schema,
         r.metadata_schema, s.change_summary, s.created_at,
         r.current_schema_version AS latest_version
  FROM lt_roles r
  LEFT JOIN lt_role_schemas s
    ON s.role = r.role AND s.version = r.current_schema_version
  WHERE r.role = $1`;

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
  ),
  upstreams AS (
    SELECT role, array_agg(upstream_role ORDER BY upstream_role) AS ups
    FROM lt_role_upstreams
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
    r.priority_threshold_minutes,
    r.priority_facet,
    r.current_schema_version,
    COALESCE(up.ups, '{}') AS upstream_roles,
    COALESCE(uc.cnt, 0) AS user_count,
    COALESCE(cc.cnt, 0) AS chain_count,
    COALESCE(wc.cnt, 0) AS workflow_count
  FROM lt_roles r
  LEFT JOIN user_counts uc ON uc.role = r.role
  LEFT JOIN chain_counts cc ON cc.role = r.role
  LEFT JOIN workflow_counts wc ON wc.role = r.role
  LEFT JOIN upstreams up ON up.role = r.role
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
