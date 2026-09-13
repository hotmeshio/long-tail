-- Migration 034: workflow input schema
--
-- Opt-in rich invoke form: an x-lt-* JSON Schema the dashboard renders and
-- the invoke API validates submitted data against. NULL keeps the legacy
-- envelope_schema template form, so existing registrations are untouched.

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS input_schema JSONB;
