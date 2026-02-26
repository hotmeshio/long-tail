-- Long Tail Workflows: Schema
-- Tasks track workflow executions; escalations track human interventions.

-- ─── updated_at trigger ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION lt_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── lt_tasks ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- workflow identification
  workflow_id     TEXT NOT NULL,
  workflow_type   TEXT NOT NULL,
  lt_type         TEXT NOT NULL,
  task_queue      TEXT,
  modality        TEXT,

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

CREATE INDEX IF NOT EXISTS idx_lt_tasks_status_type
  ON lt_tasks (status, workflow_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_parent
  ON lt_tasks (parent_workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_lt_type
  ON lt_tasks (lt_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_completed
  ON lt_tasks (completed_at, status);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_signal
  ON lt_tasks (signal_id);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_origin
  ON lt_tasks (origin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_workflow_id
  ON lt_tasks (workflow_id);

CREATE OR REPLACE TRIGGER trg_lt_tasks_updated_at
  BEFORE UPDATE ON lt_tasks
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ─── lt_escalations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- classification
  type              TEXT NOT NULL,
  subtype           TEXT NOT NULL,
  modality          TEXT NOT NULL,
  description       TEXT,

  -- state (claims are implicit: assigned_to + assigned_until > NOW())
  status            TEXT NOT NULL DEFAULT 'pending',
  priority          INTEGER NOT NULL DEFAULT 2,

  -- references
  task_id           UUID REFERENCES lt_tasks(id),
  origin_id         TEXT,
  parent_id         TEXT,

  -- routing
  workflow_id       TEXT,
  task_queue        TEXT,
  workflow_type     TEXT,

  -- ownership
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

CREATE INDEX IF NOT EXISTS idx_lt_escalations_available
  ON lt_escalations (status, role, assigned_until, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_available_v2
  ON lt_escalations (role, priority, created_at DESC)
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lt_escalations_assigned
  ON lt_escalations (assigned_to, assigned_until, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_expiry
  ON lt_escalations (assigned_until, assigned_to);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_role_type
  ON lt_escalations (role, status, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_role_subtype
  ON lt_escalations (role, status, type, subtype, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_status
  ON lt_escalations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_task
  ON lt_escalations (task_id);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_origin
  ON lt_escalations (origin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_workflow
  ON lt_escalations (workflow_id);

CREATE OR REPLACE TRIGGER trg_lt_escalations_updated_at
  BEFORE UPDATE ON lt_escalations
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ─── lt_users ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT UNIQUE NOT NULL,
  email         TEXT,
  display_name  TEXT,
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lt_users_updated_at
  BEFORE UPDATE ON lt_users
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_lt_users_status ON lt_users (status);

-- ─── lt_user_roles ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_user_roles (
  user_id    UUID NOT NULL REFERENCES lt_users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'member' CHECK (type IN ('superadmin', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_lt_user_roles_type ON lt_user_roles (type);
CREATE INDEX IF NOT EXISTS idx_lt_user_roles_user_id ON lt_user_roles (user_id);

-- ─── Workflow configuration ─────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_config_workflows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type    TEXT UNIQUE NOT NULL,
  is_lt            BOOLEAN NOT NULL DEFAULT true,
  is_container     BOOLEAN NOT NULL DEFAULT false,
  invocable        BOOLEAN NOT NULL DEFAULT false,
  task_queue       TEXT,
  default_role     TEXT NOT NULL DEFAULT 'reviewer',
  default_modality TEXT NOT NULL DEFAULT 'portal',
  description      TEXT,
  consumes         TEXT[] NOT NULL DEFAULT '{}',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lt_config_workflows_updated_at
  BEFORE UPDATE ON lt_config_workflows
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE TABLE IF NOT EXISTS lt_config_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, role)
);

CREATE TABLE IF NOT EXISTS lt_config_invocation_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, role)
);

CREATE TABLE IF NOT EXISTS lt_config_lifecycle (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type        TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  hook                 TEXT NOT NULL CHECK (hook IN ('onBefore', 'onAfter')),
  target_workflow_type TEXT NOT NULL,
  target_task_queue    TEXT,
  ordinal              INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, hook, target_workflow_type)
);

-- ─── Seed built-in workflows ────────────────────────────────────────────────

INSERT INTO lt_config_workflows (workflow_type, is_lt, is_container, task_queue, default_role, default_modality)
VALUES
  ('reviewContent',              true,  false, 'long-tail',        'reviewer', 'default'),
  ('reviewContentOrchestrator',  false, true,  'lt-review-orch',   'reviewer', 'default'),
  ('verifyDocument',             true,  false, 'long-tail-verify', 'reviewer', 'default'),
  ('verifyDocumentOrchestrator', false, true,  'lt-verify-orch',   'reviewer', 'default')
ON CONFLICT (workflow_type) DO NOTHING;
