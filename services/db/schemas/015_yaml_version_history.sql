-- YAML workflow version history: tracks every content change for audit and rollback.

CREATE TABLE IF NOT EXISTS lt_yaml_workflow_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       UUID NOT NULL REFERENCES lt_yaml_workflows(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  yaml_content      TEXT NOT NULL,
  activity_manifest JSONB NOT NULL DEFAULT '[]'::JSONB,
  input_schema      JSONB NOT NULL DEFAULT '{}'::JSONB,
  output_schema     JSONB NOT NULL DEFAULT '{}'::JSONB,
  change_summary    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lt_yaml_wf_versions_workflow
  ON lt_yaml_workflow_versions (workflow_id, version DESC);

-- Track content version (increments on every YAML edit)
ALTER TABLE lt_yaml_workflows
  ADD COLUMN IF NOT EXISTS content_version INTEGER NOT NULL DEFAULT 1;

-- Track which content_version was last deployed
ALTER TABLE lt_yaml_workflows
  ADD COLUMN IF NOT EXISTS deployed_content_version INTEGER;

-- Backfill: deployed/active workflows are in sync
UPDATE lt_yaml_workflows
  SET deployed_content_version = 1
  WHERE status IN ('deployed', 'active');

-- Seed initial version snapshot for every existing workflow
INSERT INTO lt_yaml_workflow_versions (workflow_id, version, yaml_content, activity_manifest, input_schema, output_schema, change_summary)
  SELECT id, 1, yaml_content, activity_manifest, input_schema, output_schema, 'Initial version'
  FROM lt_yaml_workflows
ON CONFLICT DO NOTHING;
