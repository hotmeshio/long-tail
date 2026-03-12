-- Add tags to YAML workflows for efficient capability-based discovery.
-- When mcpQuery converts an execution to a compiled workflow, it stores
-- searchable tags so the workflow can be found quickly on future queries
-- without scanning all tools.

ALTER TABLE lt_yaml_workflows
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_tags
  ON lt_yaml_workflows USING GIN (tags);
