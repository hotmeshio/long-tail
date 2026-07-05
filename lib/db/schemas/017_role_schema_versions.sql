-- Migration 017: Versioned role schemas
--
-- lt_role_schemas holds an immutable snapshot of a role's form_schema and
-- metadata_schema per version. lt_roles.form_schema / metadata_schema remain
-- the live "latest" copy (single-query reads stay cheap); every schema edit
-- also appends the next (role, version) snapshot and advances
-- lt_roles.current_schema_version — see UPDATE_ROLE_METADATA in
-- services/role/sql.ts, which does both in one atomic statement.
--
-- Why: an escalation can pin the exact schema it was created against
-- (metadata.schema_version, set via conditionLT's schemaVersion config field).
-- The resolver UI then renders the pinned version even after the role's
-- schema moves on. Escalations without a pin always use the latest.

CREATE TABLE IF NOT EXISTS lt_role_schemas (
  role            TEXT NOT NULL REFERENCES lt_roles(role) ON DELETE CASCADE,
  version         INTEGER NOT NULL,
  form_schema     JSONB,
  metadata_schema JSONB,
  change_summary  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, version)
);

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS current_schema_version INTEGER;

-- Seed version 1 from the live columns for roles that already carry a schema.
-- ON CONFLICT keeps re-runs (and multi-container boot races behind the
-- advisory lock) no-ops.
INSERT INTO lt_role_schemas (role, version, form_schema, metadata_schema, change_summary)
SELECT role, 1, form_schema, metadata_schema, 'Initial version (seeded from lt_roles)'
FROM lt_roles
WHERE form_schema IS NOT NULL OR metadata_schema IS NOT NULL
ON CONFLICT (role, version) DO NOTHING;

UPDATE lt_roles
SET current_schema_version = 1
WHERE current_schema_version IS NULL
  AND (form_schema IS NOT NULL OR metadata_schema IS NOT NULL);
