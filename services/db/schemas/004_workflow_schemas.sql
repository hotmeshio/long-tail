-- Workflow config: add envelope_schema, resolver_schema, and cron_schedule.
--
-- envelope_schema: default envelope template (JSONB) pre-filled in the
--   Start Workflow editor. Stored on orchestrator configs (invocable = true).
--
-- resolver_schema: default resolver payload template (JSONB) pre-filled
--   when resolving escalations. Stored on leaf workflow configs.
--
-- cron_schedule: cron expression or interval string. When set, the system
--   auto-invokes the workflow on this schedule via Virtual.cron().

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS envelope_schema JSONB,
  ADD COLUMN IF NOT EXISTS resolver_schema JSONB,
  ADD COLUMN IF NOT EXISTS cron_schedule   TEXT;
