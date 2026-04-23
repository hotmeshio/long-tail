-- Enforce unique graph_topic per app_id for non-archived workflows.
-- Two active/deployed/draft workflows in the same namespace must not
-- share a subscribes topic — deploying them would cause routing collisions.

CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_yaml_workflows_app_topic_unique
  ON lt_yaml_workflows (app_id, graph_topic)
  WHERE status != 'archived';
