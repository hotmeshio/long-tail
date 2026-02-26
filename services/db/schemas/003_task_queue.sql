-- Add task_queue to lt_tasks for workflow ID resolution.
-- Allows observation/export endpoints to resolve a workflowId
-- without requiring the caller to provide taskQueue and workflowName.

ALTER TABLE lt_tasks
  ADD COLUMN IF NOT EXISTS task_queue TEXT;

CREATE INDEX IF NOT EXISTS idx_lt_tasks_workflow_id
  ON lt_tasks (workflow_id);

-- Backfill from config for existing rows
UPDATE lt_tasks t
  SET task_queue = c.task_queue
  FROM lt_config_workflows c
  WHERE t.workflow_type = c.workflow_type
    AND t.task_queue IS NULL;
