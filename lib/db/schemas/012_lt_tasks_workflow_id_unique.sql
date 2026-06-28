-- ─── 012: lt_tasks.workflow_id uniqueness ─────────────────────────────────────
-- A task is 1:1 with its workflow_id. Every createTask caller keys the row by a
-- deterministic workflow_id (orchestrator childWorkflowId, interceptor
-- wf.workflowId, escalation triage-<id>), and createTask runs inside a
-- proxyActivity with retry { maximumAttempts: 3 }. Without a unique constraint a
-- retry — or a re-driven triage saga — double-inserts a task row. The unique
-- index lets createTask use ON CONFLICT (workflow_id) so retries converge instead
-- of duplicating, matching how HotMesh upserts the sibling job by (workflowId, app_id).

-- Collapse any pre-existing duplicates, keeping the most recent row per workflow_id
-- (tie-break on id so exactly one survives and the unique index can be built).
DELETE FROM lt_tasks a
USING lt_tasks b
WHERE a.workflow_id = b.workflow_id
  AND (a.created_at < b.created_at
       OR (a.created_at = b.created_at AND a.id < b.id));

-- Replace the non-unique lookup index with a unique one (it still serves lookups).
DROP INDEX IF EXISTS idx_lt_tasks_workflow_id;
CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_tasks_workflow_id ON lt_tasks (workflow_id);
