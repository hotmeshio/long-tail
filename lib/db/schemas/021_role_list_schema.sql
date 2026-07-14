-- Migration 021: Role escalations LIST schema
--
-- list_schema is the list-page analog of form_schema: it richly formats the
-- escalation LIST page when the list is scoped to exactly one role that owns a
-- list_schema (opt-in — absent leaves the engineer table unchanged). Unlike
-- form_schema it is NOT pinned per-escalation; the list always renders the
-- role's latest.
--
-- It versions INDEPENDENTLY of form_schema / metadata_schema: its own snapshot
-- table (lt_role_list_schemas) and its own counter (current_list_schema_version),
-- so editing the list view never advances the resolve form's version. The write
-- rides the same atomic UPDATE_ROLE_METADATA statement (services/role/sql.ts),
-- which bumps current_list_schema_version and appends a snapshot only when the
-- provided list_schema actually differs.

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS list_schema JSONB,
  ADD COLUMN IF NOT EXISTS current_list_schema_version INTEGER;

CREATE TABLE IF NOT EXISTS lt_role_list_schemas (
  role           TEXT NOT NULL REFERENCES lt_roles(role) ON DELETE CASCADE,
  version        INTEGER NOT NULL,
  list_schema    JSONB,
  change_summary TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, version)
);
