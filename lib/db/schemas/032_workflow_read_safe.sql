-- Migration 032: read-safe workflow flag
--
-- Marks a workflow as side-effect-free for external MCP callers: the
-- invoke_workflow_read_safe tool (manifest read_safe: true) starts only
-- workflows carrying this flag, extending the tool-manifest read-scope
-- contract to workflow invocation. Fail-closed: unset means not read-safe.

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS read_safe BOOLEAN NOT NULL DEFAULT false;
