-- Migration 034: workflow input form and icon
--
-- Two opt-in columns on the workflow registration:
--   input_schema — an x-lt-* JSON Schema the dashboard renders as the invoke
--                  form and the invoke API validates submitted data against.
--                  NULL keeps the legacy envelope_schema template form.
--   icon         — a curated icon name (WORKFLOW_ICONS) shown in place of the
--                  tier glyph on the Invoke page and registry. NULL keeps the
--                  tier glyph.

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS input_schema JSONB,
  ADD COLUMN IF NOT EXISTS icon TEXT;
