// ------------------------------------------------------------------ //
// Read queries                                                       //
// ------------------------------------------------------------------ //

export const GET_WORKFLOW = `\
SELECT * FROM lt_config_workflows WHERE workflow_type = $1`;

export const GET_WORKFLOW_ROLES = `\
SELECT role FROM lt_config_roles WHERE workflow_type = $1 ORDER BY role`;

export const GET_WORKFLOW_INVOCATION_ROLES = `\
SELECT role FROM lt_config_invocation_roles WHERE workflow_type = $1 ORDER BY role`;

export const GET_WORKFLOW_LIFECYCLE = `\
SELECT hook, target_workflow_type, target_task_queue, ordinal
  FROM lt_config_lifecycle
 WHERE workflow_type = $1
 ORDER BY hook, ordinal`;

export const LIST_ALL_WORKFLOWS = `\
SELECT * FROM lt_config_workflows ORDER BY workflow_type`;

export const LIST_ALL_ROLES = `\
SELECT * FROM lt_config_roles ORDER BY workflow_type, role`;

export const LIST_ALL_INVOCATION_ROLES = `\
SELECT * FROM lt_config_invocation_roles ORDER BY workflow_type, role`;

export const LIST_ALL_LIFECYCLE = `\
SELECT * FROM lt_config_lifecycle ORDER BY workflow_type, hook, ordinal`;

// ------------------------------------------------------------------ //
// Write / upsert queries                                             //
// ------------------------------------------------------------------ //

export const ENSURE_ROLE_EXISTS = `\
INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING`;

export const UPSERT_WORKFLOW = `\
INSERT INTO lt_config_workflows
  (workflow_type, is_lt, is_container, invocable, task_queue, default_role, default_modality, description, consumes, envelope_schema, resolver_schema, cron_schedule, tool_tags)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
ON CONFLICT (workflow_type) DO UPDATE SET
  is_lt = EXCLUDED.is_lt,
  is_container = EXCLUDED.is_container,
  invocable = EXCLUDED.invocable,
  task_queue = EXCLUDED.task_queue,
  default_role = EXCLUDED.default_role,
  default_modality = EXCLUDED.default_modality,
  description = EXCLUDED.description,
  consumes = EXCLUDED.consumes,
  envelope_schema = EXCLUDED.envelope_schema,
  resolver_schema = EXCLUDED.resolver_schema,
  cron_schedule = EXCLUDED.cron_schedule,
  tool_tags = EXCLUDED.tool_tags`;

export const DELETE_CONFIG_ROLES = `\
DELETE FROM lt_config_roles WHERE workflow_type = $1`;

export const INSERT_CONFIG_ROLE = `\
INSERT INTO lt_config_roles (workflow_type, role) VALUES ($1, $2)`;

export const DELETE_INVOCATION_ROLES = `\
DELETE FROM lt_config_invocation_roles WHERE workflow_type = $1`;

export const INSERT_INVOCATION_ROLE = `\
INSERT INTO lt_config_invocation_roles (workflow_type, role) VALUES ($1, $2)`;

export const DELETE_LIFECYCLE = `\
DELETE FROM lt_config_lifecycle WHERE workflow_type = $1`;

export const INSERT_LIFECYCLE_BEFORE = `\
INSERT INTO lt_config_lifecycle (workflow_type, hook, target_workflow_type, target_task_queue, ordinal)
VALUES ($1, 'onBefore', $2, $3, $4)`;

export const INSERT_LIFECYCLE_AFTER = `\
INSERT INTO lt_config_lifecycle (workflow_type, hook, target_workflow_type, target_task_queue, ordinal)
VALUES ($1, 'onAfter', $2, $3, $4)`;

export const DELETE_WORKFLOW = `\
DELETE FROM lt_config_workflows WHERE workflow_type = $1`;

// ------------------------------------------------------------------ //
// Provider queries                                                   //
// ------------------------------------------------------------------ //

export const GET_PROVIDER_DATA = `\
SELECT workflow_type, data, completed_at
  FROM lt_tasks
 WHERE origin_id = $1
   AND workflow_type = ANY($2)
   AND status = 'completed'
 ORDER BY completed_at DESC`;
