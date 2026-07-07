-- Migration 020: Explicit workflow certification
--
-- Certification becomes a declared property of the workflow registration,
-- stored on the row. Before this, the tier was derived: a registered workflow
-- counted as certified whenever it had escalation roles or consumes — so
-- demoting a certified workflow to plain registered meant deleting its
-- escalation roles and provider references. With the explicit flag, the three
-- tiers are direct states:
--
--   default    — no row in lt_config_workflows (ad-hoc durable workflow)
--   registered — row exists, certified = false (invocation + entry schema)
--   certified  — row exists, certified = true  (interceptor: task tracking,
--                escalation handling, re-run detection)
--
-- Escalation formalization (who resolves, with what schema) belongs to the
-- escalation and its role — roles carry the versioned escalation schema and
-- take precedence. The workflow-level roles/resolver_schema remain as
-- interceptor defaults only.
--
-- The backfill runs once (schema_migrations tracked): rows that were
-- implicitly certified under the derived rule keep their tier.

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS certified BOOLEAN NOT NULL DEFAULT false;

UPDATE lt_config_workflows w
SET certified = true
WHERE certified = false
  AND (
    cardinality(w.consumes) > 0
    OR EXISTS (
      SELECT 1 FROM lt_config_roles r WHERE r.workflow_type = w.workflow_type
    )
  );
