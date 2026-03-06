-- YAML Workflows: deterministic HotMesh YAML workflows generated from MCP tool call sequences.

CREATE TABLE IF NOT EXISTS lt_yaml_workflows (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- identification
  name                 TEXT UNIQUE NOT NULL,
  description          TEXT,
  app_id               TEXT NOT NULL,
  app_version          TEXT NOT NULL DEFAULT '1',

  -- source provenance
  source_workflow_id   TEXT,
  source_workflow_type TEXT,

  -- YAML content + graph metadata
  yaml_content         TEXT NOT NULL,
  graph_topic          TEXT NOT NULL,

  -- schemas
  input_schema         JSONB NOT NULL DEFAULT '{}'::JSONB,
  output_schema        JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- activity manifest (tool names, topics, mappings)
  activity_manifest    JSONB NOT NULL DEFAULT '[]'::JSONB,

  -- lifecycle
  status               TEXT NOT NULL DEFAULT 'draft'
                         CHECK (status IN ('draft', 'deployed', 'active', 'archived')),
  deployed_at          TIMESTAMPTZ,
  activated_at         TIMESTAMPTZ,

  metadata             JSONB,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_status ON lt_yaml_workflows (status);
CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_app_id ON lt_yaml_workflows (app_id);

CREATE OR REPLACE TRIGGER trg_lt_yaml_workflows_updated_at
  BEFORE UPDATE ON lt_yaml_workflows
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();
