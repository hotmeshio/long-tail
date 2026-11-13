-- The cron job that runs each workflow's schedule. Every arming gets a fresh
-- job id, since an interrupted HotMesh job id can't be armed again. A
-- workflow with no row runs under the original id, lt-cron-<workflow_type>.
-- schedule is the expression job_id was armed with; NULL means stopped.

CREATE TABLE IF NOT EXISTS lt_workflow_crons (
  workflow_type TEXT PRIMARY KEY,
  job_id        TEXT NOT NULL,
  schedule      TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
