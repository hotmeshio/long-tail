-- Add execute_as to workflow configs: proxy invocation identity.
-- When set, workflows run as the named bot instead of the invoking user.

ALTER TABLE lt_config_workflows ADD COLUMN IF NOT EXISTS execute_as TEXT;

-- Add executing_as to tasks: records the actual executing principal
-- (may differ from initiated_by when proxy invocation is used).

ALTER TABLE lt_tasks ADD COLUMN IF NOT EXISTS executing_as TEXT;
