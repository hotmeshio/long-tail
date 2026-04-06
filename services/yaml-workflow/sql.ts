// ─── YAML workflow CRUD ─────────────────────────────────────────────────────

export const CREATE_YAML_WORKFLOW = `
  INSERT INTO lt_yaml_workflows
    (name, description, app_id, app_version, source_workflow_id,
     source_workflow_type, yaml_content, graph_topic,
     input_schema, output_schema, activity_manifest, input_field_meta,
     original_prompt, category, tags, metadata, content_version)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, 1)
  RETURNING *`;

export const GET_YAML_WORKFLOW = `
  SELECT * FROM lt_yaml_workflows WHERE id = $1`;

export const GET_YAML_WORKFLOW_BY_NAME = `
  SELECT * FROM lt_yaml_workflows WHERE name = $1`;

export const UPDATE_YAML_WORKFLOW_VERSION = `
  UPDATE lt_yaml_workflows SET app_version = $2 WHERE id = $1`;

export const DELETE_YAML_WORKFLOW = `
  DELETE FROM lt_yaml_workflows WHERE id = $1`;

// ─── Status and deployment ──────────────────────────────────────────────────

export const GET_ACTIVE_YAML_WORKFLOWS = `
  SELECT * FROM lt_yaml_workflows
  WHERE status = 'active'
  ORDER BY name`;

export const LIST_BY_APP_ID = `
  SELECT * FROM lt_yaml_workflows
  WHERE app_id = $1 AND status != 'archived'
  ORDER BY name`;

export const GET_DISTINCT_APP_IDS = `
  SELECT DISTINCT app_id FROM lt_yaml_workflows
  WHERE status != 'archived'
  ORDER BY app_id`;

export const MARK_CONTENT_DEPLOYED = `
  UPDATE lt_yaml_workflows
  SET deployed_content_version = content_version
  WHERE id = $1`;

export const MARK_APP_ID_CONTENT_DEPLOYED = `
  UPDATE lt_yaml_workflows
  SET deployed_content_version = content_version
  WHERE app_id = $1 AND status != 'archived'`;

// ─── Version history ────────────────────────────────────────────────────────

export const CREATE_VERSION_SNAPSHOT = `
  INSERT INTO lt_yaml_workflow_versions
    (workflow_id, version, yaml_content, activity_manifest, input_schema, output_schema, input_field_meta, change_summary)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
  ON CONFLICT (workflow_id, version) DO NOTHING
  RETURNING *`;

export const COUNT_VERSIONS = `
  SELECT COUNT(*) FROM lt_yaml_workflow_versions WHERE workflow_id = $1`;

export const LIST_VERSIONS = `
  SELECT * FROM lt_yaml_workflow_versions
  WHERE workflow_id = $1
  ORDER BY version DESC
  LIMIT $2 OFFSET $3`;

// ─── Discovery ─────────────────────────────────────────────────────────────

export const DISCOVER_WORKFLOWS = `
  SELECT *,
    ts_rank_cd(search_vector, plainto_tsquery('english', $1), 32) AS fts_rank
  FROM lt_yaml_workflows
  WHERE status = 'active'
    AND (
      search_vector @@ plainto_tsquery('english', $1)
      OR tags && $2::text[]
      OR ($3::text IS NOT NULL AND category = $3)
    )
  ORDER BY fts_rank DESC, activated_at DESC NULLS LAST
  LIMIT $4`;

export const GET_VERSION_SNAPSHOT = `
  SELECT * FROM lt_yaml_workflow_versions
  WHERE workflow_id = $1 AND version = $2`;

// ─── Status updates ─────────────────────────────────────────────────────────

export const UPDATE_STATUS_BASE = `UPDATE lt_yaml_workflows SET status = $2`;
export const UPDATE_STATUS_SUFFIX = ` WHERE id = $1 RETURNING *`;

// ─── Tag-based lookup ────────────────────────────────────────────────────────

export const FIND_BY_TAGS_ANY = `
  SELECT * FROM lt_yaml_workflows
  WHERE status = 'active' AND tags && $1::text[]
  ORDER BY name`;

export const FIND_BY_TAGS_ALL = `
  SELECT * FROM lt_yaml_workflows
  WHERE status = 'active' AND tags @> $1::text[]
  ORDER BY name`;
