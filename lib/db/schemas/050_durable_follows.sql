-- Workflows on a non-HotMesh durable engine whose completion Long Tail has
-- yet to publish. One row per workflow, written when the workflow is started
-- or an outcome is delivered to it. The relay asks the engine about each due
-- row and removes the row as it publishes workflow.completed or
-- workflow.failed, so one container publishes each completion.

CREATE TABLE IF NOT EXISTS lt_durable_follows (
  provider      TEXT NOT NULL,
  workflow_id   TEXT NOT NULL,
  workflow_type TEXT,
  checks        INT NOT NULL DEFAULT 0,
  next_check_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (provider, workflow_id)
);

CREATE INDEX IF NOT EXISTS idx_lt_durable_follows_due
  ON lt_durable_follows (provider, next_check_at);
