-- Long Tail Workflows: Initial Schema
-- Tasks track workflow executions; escalations track human interventions.

-- ─── lt_tasks ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- workflow identification
  workflow_id     TEXT NOT NULL,
  workflow_type   TEXT NOT NULL,
  lt_type         TEXT NOT NULL,
  modality         TEXT,

  -- state
  status          TEXT NOT NULL DEFAULT 'pending',
  priority        INTEGER NOT NULL DEFAULT 2,

  -- execution context
  signal_id       TEXT NOT NULL,
  parent_workflow_id TEXT NOT NULL,
  origin_id       TEXT,
  parent_id       TEXT,

  -- timeline
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,

  -- payload & context
  envelope        TEXT NOT NULL,
  metadata        JSONB,
  error           TEXT,
  milestones      JSONB NOT NULL DEFAULT '[]'::JSONB,
  data            TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- monitoring: status + type + recency
CREATE INDEX IF NOT EXISTS idx_lt_tasks_status_type
  ON lt_tasks (status, workflow_type, created_at DESC);

-- find tasks by parent workflow
CREATE INDEX IF NOT EXISTS idx_lt_tasks_parent
  ON lt_tasks (parent_workflow_id, created_at DESC);

-- lt type analysis
CREATE INDEX IF NOT EXISTS idx_lt_tasks_lt_type
  ON lt_tasks (lt_type, status, created_at DESC);

-- completion tracking
CREATE INDEX IF NOT EXISTS idx_lt_tasks_completed
  ON lt_tasks (completed_at, status);

-- signal lookup for coordination
CREATE INDEX IF NOT EXISTS idx_lt_tasks_signal
  ON lt_tasks (signal_id);

-- hierarchy reconstruction
CREATE INDEX IF NOT EXISTS idx_lt_tasks_origin
  ON lt_tasks (origin_id, created_at DESC);


-- ─── lt_escalations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- classification
  type              TEXT NOT NULL,
  subtype           TEXT NOT NULL,
  modality           TEXT NOT NULL,
  description       TEXT,

  -- state
  status            TEXT NOT NULL DEFAULT 'pending',
  priority          INTEGER NOT NULL DEFAULT 2,

  -- references
  task_id           UUID REFERENCES lt_tasks(id),
  origin_id         TEXT,
  parent_id         TEXT,

  -- routing / ownership
  role              TEXT NOT NULL,
  assigned_to       TEXT,
  assigned_until    TIMESTAMPTZ,

  -- timeline
  resolved_at       TIMESTAMPTZ,
  claimed_at        TIMESTAMPTZ,

  -- payload & context
  envelope          TEXT NOT NULL,
  metadata          JSONB,
  escalation_payload TEXT,
  resolver_payload  TEXT,

  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- available work: status + role + expiry + recency
CREATE INDEX IF NOT EXISTS idx_lt_escalations_available
  ON lt_escalations (status, role, assigned_until, created_at DESC);

-- active user claims
CREATE INDEX IF NOT EXISTS idx_lt_escalations_assigned
  ON lt_escalations (assigned_to, assigned_until, created_at DESC);

-- expired claims needing release
CREATE INDEX IF NOT EXISTS idx_lt_escalations_expiry
  ON lt_escalations (assigned_until, assigned_to);

-- role + status + type drilldown
CREATE INDEX IF NOT EXISTS idx_lt_escalations_role_type
  ON lt_escalations (role, status, type, created_at DESC);

-- role + status + type + subtype drilldown
CREATE INDEX IF NOT EXISTS idx_lt_escalations_role_subtype
  ON lt_escalations (role, status, type, subtype, created_at DESC);

-- status + recency
CREATE INDEX IF NOT EXISTS idx_lt_escalations_status
  ON lt_escalations (status, created_at DESC);

-- task relationship
CREATE INDEX IF NOT EXISTS idx_lt_escalations_task
  ON lt_escalations (task_id);

-- hierarchy reconstruction
CREATE INDEX IF NOT EXISTS idx_lt_escalations_origin
  ON lt_escalations (origin_id, created_at DESC);


-- ─── updated_at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lt_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER trg_lt_tasks_updated_at
  BEFORE UPDATE ON lt_tasks
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE OR REPLACE TRIGGER trg_lt_escalations_updated_at
  BEFORE UPDATE ON lt_escalations
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();
