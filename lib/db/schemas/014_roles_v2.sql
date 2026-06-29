-- Migration 014: Elevate lt_roles with rich metadata and process dependency graph
--
-- New columns:
--   title        — display name separate from the technical role key
--   description  — human-readable summary for card layout
--   form_schema  — role-level template for rendering/validating escalation data
--                  (used as default; workflow-level resolver_schema overrides)
--   properties   — open bag for SLA targets, icon, color, station location, etc.
--   ops_visible  — flag controlling COO /operations view visibility
--   parent_role  — nullable self-referencing FK for the process dependency graph
--                  (child references parent; roots have NULL)

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS title       TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS form_schema JSONB,
  ADD COLUMN IF NOT EXISTS properties  JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS ops_visible BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS parent_role TEXT REFERENCES lt_roles(role);
