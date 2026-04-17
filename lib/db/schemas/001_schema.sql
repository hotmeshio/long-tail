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

-- ─── lt_roles (canonical role registry) ────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_roles (
  role       TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lt_roles (role) VALUES
  ('reviewer'),
  ('engineer'),
  ('admin'),
  ('superadmin')
ON CONFLICT DO NOTHING;

-- ─── lt_tasks ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_tasks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id     TEXT NOT NULL,
  workflow_type   TEXT NOT NULL,
  lt_type         TEXT NOT NULL,
  task_queue      TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  priority        INTEGER NOT NULL DEFAULT 2,
  signal_id       TEXT NOT NULL,
  parent_workflow_id TEXT NOT NULL,
  origin_id       TEXT,
  parent_id       TEXT,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  envelope        TEXT NOT NULL,
  metadata        JSONB,
  error           TEXT,
  milestones      JSONB NOT NULL DEFAULT '[]'::JSONB,
  data            TEXT,
  trace_id        TEXT,
  span_id         TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_tasks_status_type ON lt_tasks (status, workflow_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_parent ON lt_tasks (parent_workflow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_lt_type ON lt_tasks (lt_type, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_completed ON lt_tasks (completed_at, status);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_signal ON lt_tasks (signal_id);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_origin ON lt_tasks (origin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_workflow_id ON lt_tasks (workflow_id);
CREATE INDEX IF NOT EXISTS idx_lt_tasks_origin_id ON lt_tasks (origin_id) WHERE origin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lt_tasks_trace ON lt_tasks (trace_id) WHERE trace_id IS NOT NULL;

CREATE OR REPLACE TRIGGER trg_lt_tasks_updated_at
  BEFORE UPDATE ON lt_tasks
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ─── lt_escalations ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_escalations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type              TEXT NOT NULL,
  subtype           TEXT NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'pending',
  priority          INTEGER NOT NULL DEFAULT 2,
  task_id           UUID REFERENCES lt_tasks(id),
  origin_id         TEXT,
  parent_id         TEXT,
  workflow_id       TEXT,
  task_queue        TEXT,
  workflow_type     TEXT,
  role              TEXT NOT NULL REFERENCES lt_roles(role),
  assigned_to       TEXT,
  assigned_until    TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,
  claimed_at        TIMESTAMPTZ,
  envelope          TEXT NOT NULL,
  metadata          JSONB,
  escalation_payload TEXT,
  resolver_payload  TEXT,
  trace_id          TEXT,
  span_id           TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_escalations_available ON lt_escalations (status, role, assigned_until, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_available_v2 ON lt_escalations (role, priority, created_at DESC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lt_escalations_assigned ON lt_escalations (assigned_to, assigned_until, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_expiry ON lt_escalations (assigned_until, assigned_to);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_role_type ON lt_escalations (role, status, type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_role_subtype ON lt_escalations (role, status, type, subtype, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_status ON lt_escalations (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_task ON lt_escalations (task_id);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_origin ON lt_escalations (origin_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_workflow ON lt_escalations (workflow_id);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_type ON lt_escalations (type);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_pending_sort ON lt_escalations (priority ASC, created_at ASC) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_lt_escalations_origin_id ON lt_escalations (origin_id) WHERE origin_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lt_escalations_trace ON lt_escalations (trace_id) WHERE trace_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_lt_escalations_created_desc ON lt_escalations (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_updated_desc ON lt_escalations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_priority_desc ON lt_escalations (priority DESC, created_at DESC);

CREATE OR REPLACE TRIGGER trg_lt_escalations_updated_at
  BEFORE UPDATE ON lt_escalations
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ─── lt_users ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT UNIQUE NOT NULL,
  email         TEXT,
  display_name  TEXT,
  password_hash TEXT,
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
  role       TEXT NOT NULL REFERENCES lt_roles(role),
  type       TEXT NOT NULL DEFAULT 'member' CHECK (type IN ('superadmin', 'admin', 'member')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_lt_user_roles_type ON lt_user_roles (type);
CREATE INDEX IF NOT EXISTS idx_lt_user_roles_user_id ON lt_user_roles (user_id);

-- ─── lt_config_workflows ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_config_workflows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type    TEXT UNIQUE NOT NULL,
  invocable        BOOLEAN NOT NULL DEFAULT false,
  task_queue       TEXT,
  default_role     TEXT NOT NULL DEFAULT 'reviewer' REFERENCES lt_roles(role),
  description      TEXT,
  consumes         TEXT[] NOT NULL DEFAULT '{}',
  tool_tags        TEXT[] NOT NULL DEFAULT '{}',
  envelope_schema  JSONB,
  resolver_schema  JSONB,
  cron_schedule    TEXT,
  execute_as       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lt_config_workflows_updated_at
  BEFORE UPDATE ON lt_config_workflows
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_config_workflows_tool_tags
  ON lt_config_workflows USING GIN (tool_tags);

CREATE TABLE IF NOT EXISTS lt_config_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  role          TEXT NOT NULL REFERENCES lt_roles(role),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, role)
);

CREATE TABLE IF NOT EXISTS lt_config_invocation_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  role          TEXT NOT NULL REFERENCES lt_roles(role),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, role)
);

-- ─── lt_mcp_servers ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_mcp_servers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT UNIQUE NOT NULL,
  description       TEXT,
  transport_type    TEXT NOT NULL CHECK (transport_type IN ('stdio', 'sse')),
  transport_config  JSONB NOT NULL DEFAULT '{}'::JSONB,
  auto_connect      BOOLEAN NOT NULL DEFAULT false,
  tool_manifest     JSONB,
  status            TEXT NOT NULL DEFAULT 'registered'
                      CHECK (status IN ('registered', 'connected', 'error', 'disconnected')),
  last_connected_at TIMESTAMPTZ,
  metadata          JSONB,
  tags              TEXT[] NOT NULL DEFAULT '{}',
  compile_hints     TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_mcp_servers_name ON lt_mcp_servers (name);
CREATE INDEX IF NOT EXISTS idx_lt_mcp_servers_status ON lt_mcp_servers (status);
CREATE INDEX IF NOT EXISTS idx_lt_mcp_servers_auto_connect ON lt_mcp_servers (auto_connect) WHERE auto_connect = true;
CREATE INDEX IF NOT EXISTS idx_lt_mcp_servers_tags ON lt_mcp_servers USING GIN (tags);

CREATE OR REPLACE TRIGGER trg_lt_mcp_servers_updated_at
  BEFORE UPDATE ON lt_mcp_servers
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ─── lt_config_role_escalations ─────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_config_role_escalations (
  source_role TEXT NOT NULL REFERENCES lt_roles(role),
  target_role TEXT NOT NULL REFERENCES lt_roles(role),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_role, target_role)
);

CREATE INDEX IF NOT EXISTS idx_lt_config_role_escalations_source
  ON lt_config_role_escalations (source_role);

-- ─── lt_yaml_workflows ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_yaml_workflows (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name                     TEXT UNIQUE NOT NULL,
  description              TEXT,
  app_id                   TEXT NOT NULL,
  app_version              TEXT NOT NULL DEFAULT '1',
  source_workflow_id       TEXT,
  source_workflow_type     TEXT,
  yaml_content             TEXT NOT NULL,
  graph_topic              TEXT NOT NULL,
  input_schema             JSONB NOT NULL DEFAULT '{}'::JSONB,
  output_schema            JSONB NOT NULL DEFAULT '{}'::JSONB,
  activity_manifest        JSONB NOT NULL DEFAULT '[]'::JSONB,
  status                   TEXT NOT NULL DEFAULT 'draft'
                             CHECK (status IN ('draft', 'deployed', 'active', 'archived')),
  deployed_at              TIMESTAMPTZ,
  activated_at             TIMESTAMPTZ,
  content_version          INTEGER NOT NULL DEFAULT 1,
  deployed_content_version INTEGER,
  tags                     TEXT[] NOT NULL DEFAULT '{}',
  input_field_meta         JSONB NOT NULL DEFAULT '[]'::JSONB,
  metadata                 JSONB,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_status ON lt_yaml_workflows (status);
CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_app_id ON lt_yaml_workflows (app_id);
CREATE INDEX IF NOT EXISTS idx_lt_yaml_workflows_tags ON lt_yaml_workflows USING GIN (tags);

CREATE OR REPLACE TRIGGER trg_lt_yaml_workflows_updated_at
  BEFORE UPDATE ON lt_yaml_workflows
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ─── lt_yaml_workflow_versions ──────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_yaml_workflow_versions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id       UUID NOT NULL REFERENCES lt_yaml_workflows(id) ON DELETE CASCADE,
  version           INTEGER NOT NULL,
  yaml_content      TEXT NOT NULL,
  activity_manifest JSONB NOT NULL DEFAULT '[]'::JSONB,
  input_schema      JSONB NOT NULL DEFAULT '{}'::JSONB,
  output_schema     JSONB NOT NULL DEFAULT '{}'::JSONB,
  input_field_meta  JSONB NOT NULL DEFAULT '[]'::JSONB,
  change_summary    TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (workflow_id, version)
);

CREATE INDEX IF NOT EXISTS idx_lt_yaml_wf_versions_workflow
  ON lt_yaml_workflow_versions (workflow_id, version DESC);

-- ─── lt_namespaces ──────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS lt_namespaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  schema_name TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lt_namespaces (name, schema_name, is_default, description)
VALUES ('longtail', 'longtail', true, 'Default Long Tail namespace')
ON CONFLICT (name) DO NOTHING;
