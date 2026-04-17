-- Long Tail Knowledge Store
-- Persistent JSONB memory for autonomous agents. Each entry lives in a domain
-- (lightweight namespace) and is keyed by a human-readable string.

CREATE TABLE IF NOT EXISTS lt_knowledge (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  domain      TEXT NOT NULL,
  key         TEXT NOT NULL,
  data        JSONB NOT NULL DEFAULT '{}',
  tags        TEXT[] NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(domain, key)
);

CREATE INDEX IF NOT EXISTS idx_lt_knowledge_domain ON lt_knowledge (domain);
CREATE INDEX IF NOT EXISTS idx_lt_knowledge_tags ON lt_knowledge USING GIN (tags);
CREATE INDEX IF NOT EXISTS idx_lt_knowledge_data ON lt_knowledge USING GIN (data);

DROP TRIGGER IF EXISTS lt_knowledge_updated_at ON lt_knowledge;
CREATE TRIGGER lt_knowledge_updated_at
  BEFORE UPDATE ON lt_knowledge
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();
