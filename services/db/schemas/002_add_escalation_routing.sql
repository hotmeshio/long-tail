-- Add workflow routing fields to lt_escalations.
-- These allow the escalation resolve route to signal the correct
-- workflow without needing a task lookup + hardcoded queue/name.

ALTER TABLE lt_escalations ADD COLUMN IF NOT EXISTS workflow_id TEXT;
ALTER TABLE lt_escalations ADD COLUMN IF NOT EXISTS task_queue TEXT;
ALTER TABLE lt_escalations ADD COLUMN IF NOT EXISTS workflow_type TEXT;

CREATE INDEX IF NOT EXISTS idx_lt_escalations_workflow
  ON lt_escalations (workflow_id);
