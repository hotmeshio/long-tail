-- Migration 035: workflow input lookups
--
-- One opt-in column on the workflow registration:
--   input_lookups: versioned knowledge refs ({ domain, key, version, as? }[])
--                   the invoke form reads under the `lookup.<as ?? key>`
--                   context domain. NULL renders the form with no lookups.

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS input_lookups JSONB;
