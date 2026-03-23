-- Workflow discovery: full-text search, original prompt, and category.

-- Original prompt that spawned this workflow (richest semantic signal)
ALTER TABLE lt_yaml_workflows ADD COLUMN IF NOT EXISTS original_prompt TEXT;

-- Capability category derived from tool usage patterns
ALTER TABLE lt_yaml_workflows ADD COLUMN IF NOT EXISTS category TEXT;

-- Full-text search vector, auto-maintained by trigger
ALTER TABLE lt_yaml_workflows ADD COLUMN IF NOT EXISTS search_vector TSVECTOR;

-- GIN index on search_vector for fast full-text search
CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_search
  ON lt_yaml_workflows USING GIN (search_vector);

-- Index on category for filtered queries
CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_category
  ON lt_yaml_workflows (category) WHERE category IS NOT NULL;

-- Trigger: rebuild search_vector from name, description, tags, original_prompt, category
CREATE OR REPLACE FUNCTION lt_yaml_workflows_search_vector_update()
RETURNS TRIGGER AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.original_prompt, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.category, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.tags, ' '), '')), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_lt_yaml_workflows_search_vector
  BEFORE INSERT OR UPDATE ON lt_yaml_workflows
  FOR EACH ROW EXECUTE FUNCTION lt_yaml_workflows_search_vector_update();

-- Backfill search_vector for existing rows
UPDATE lt_yaml_workflows SET updated_at = NOW();
