-- Migration 035: workflow icon
--
-- A curated icon name for the workflow, chosen from WORKFLOW_ICONS. The
-- Invoke page and registry show it in place of the generic tier glyph so
-- an operator can tell tools apart at a glance. NULL keeps the tier glyph.

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS icon TEXT;
