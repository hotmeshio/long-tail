-- Topic catalog — persistent registry of known event topics with metadata.
-- Each row describes a topic: what it means, what payload shape it carries,
-- and who publishes it. System topics are seeded at startup; app topics
-- are auto-registered on first publish.

CREATE TABLE IF NOT EXISTS lt_topic_catalog (
  topic           TEXT PRIMARY KEY,
  description     TEXT,
  category        TEXT NOT NULL CHECK (category IN (
    'task','workflow','escalation','activity','knowledge','agent','app','milestone'
  )),
  payload_schema  JSONB,
  example_payload JSONB,
  source          TEXT NOT NULL DEFAULT 'system',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  managed         BOOLEAN NOT NULL DEFAULT false,
  last_seen_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_topic_catalog_category ON lt_topic_catalog (category);
CREATE INDEX IF NOT EXISTS idx_lt_topic_catalog_tags ON lt_topic_catalog USING GIN (tags);

CREATE OR REPLACE TRIGGER trg_lt_topic_catalog_updated_at
  BEFORE UPDATE ON lt_topic_catalog
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();
