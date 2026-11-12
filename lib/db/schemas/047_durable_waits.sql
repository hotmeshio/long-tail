-- Waits opened by workflows on a non-HotMesh durable engine (Temporal, DBOS).
-- One row per wait; escalation_id names its row in public.hmsh_escalations.
-- The relay delivers each terminal outcome once and records it here.

CREATE TABLE IF NOT EXISTS lt_durable_waits (
  escalation_id   UUID PRIMARY KEY,
  provider        TEXT NOT NULL,
  workflow_id     TEXT NOT NULL,
  run_scope       TEXT NOT NULL DEFAULT '',
  wait_key        TEXT NOT NULL,
  workflow_type   TEXT,
  delivered_at    TIMESTAMPTZ,
  delivery        TEXT,
  attempts        INT NOT NULL DEFAULT 0,
  lease_until     TIMESTAMPTZ,
  next_attempt_at TIMESTAMPTZ,
  last_error      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (provider, workflow_id, run_scope, wait_key)
);

CREATE INDEX IF NOT EXISTS idx_lt_durable_waits_undelivered
  ON lt_durable_waits (next_attempt_at NULLS FIRST)
  WHERE delivered_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_lt_durable_waits_workflow
  ON lt_durable_waits (provider, workflow_id);
