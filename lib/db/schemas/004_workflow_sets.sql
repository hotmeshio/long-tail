-- Workflow sets: groups of related workflows produced by plan mode.

CREATE TABLE IF NOT EXISTS lt_workflow_sets (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name               TEXT UNIQUE NOT NULL,
  description        TEXT,
  specification      TEXT NOT NULL,
  plan               JSONB NOT NULL DEFAULT '[]'::JSONB,
  namespaces         TEXT[] NOT NULL DEFAULT '{}',
  status             TEXT NOT NULL DEFAULT 'planning'
                       CHECK (status IN ('planning','planned','building','deploying','completed','failed')),
  source_workflow_id TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE TRIGGER trg_lt_workflow_sets_updated_at
  BEFORE UPDATE ON lt_workflow_sets
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- Extend lt_yaml_workflows with set membership columns
ALTER TABLE lt_yaml_workflows ADD COLUMN IF NOT EXISTS set_id UUID
  REFERENCES lt_workflow_sets(id) ON DELETE SET NULL;
ALTER TABLE lt_yaml_workflows ADD COLUMN IF NOT EXISTS set_role TEXT
  CHECK (set_role IN ('leaf', 'composition', 'router'));
ALTER TABLE lt_yaml_workflows ADD COLUMN IF NOT EXISTS set_build_order INTEGER;

CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_set_id
  ON lt_yaml_workflows (set_id) WHERE set_id IS NOT NULL;
