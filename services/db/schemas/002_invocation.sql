-- Add workflow invocation support: invocable flag and invocation roles.

ALTER TABLE lt_config_workflows
  ADD COLUMN IF NOT EXISTS invocable BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS lt_config_invocation_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, role)
);
