-- 009_audit_trail.sql
-- Add IAM audit columns to lt_tasks for identity traceability.

ALTER TABLE lt_tasks ADD COLUMN IF NOT EXISTS initiated_by UUID REFERENCES lt_users(id) ON DELETE SET NULL;
ALTER TABLE lt_tasks ADD COLUMN IF NOT EXISTS principal_type TEXT DEFAULT 'user';

CREATE INDEX IF NOT EXISTS idx_lt_tasks_initiated_by ON lt_tasks (initiated_by) WHERE initiated_by IS NOT NULL;
