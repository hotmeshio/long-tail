-- ─── Workflow configuration tables ────────────────────────────────────────────

-- Core workflow configuration (one row per workflow type)
CREATE TABLE IF NOT EXISTS lt_config_workflows (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type    TEXT UNIQUE NOT NULL,
  is_lt            BOOLEAN NOT NULL DEFAULT true,
  is_container     BOOLEAN NOT NULL DEFAULT false,
  task_queue       TEXT,
  default_role     TEXT NOT NULL DEFAULT 'reviewer',
  default_modality TEXT NOT NULL DEFAULT 'portal',
  description      TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lt_config_workflows_updated_at
  BEFORE UPDATE ON lt_config_workflows
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- Allowed escalation roles per workflow
CREATE TABLE IF NOT EXISTS lt_config_roles (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  role          TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, role)
);

-- Lifecycle hooks (onBefore / onAfter)
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

-- Provider/consumer dependencies
CREATE TABLE IF NOT EXISTS lt_config_consumers (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_type          TEXT NOT NULL REFERENCES lt_config_workflows(workflow_type) ON DELETE CASCADE,
  provider_name          TEXT NOT NULL,
  provider_workflow_type TEXT NOT NULL,
  ordinal                INTEGER NOT NULL DEFAULT 0,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workflow_type, provider_name)
);

-- ─── Seed existing workflows for backward compatibility ──────────────────────

INSERT INTO lt_config_workflows (workflow_type, is_lt, is_container, task_queue, default_role, default_modality)
VALUES
  ('reviewContent',              true,  false, 'long-tail',        'reviewer', 'default'),
  ('reviewContentOrchestrator',  false, true,  'lt-review-orch',   'reviewer', 'default'),
  ('verifyDocument',             true,  false, 'long-tail-verify', 'reviewer', 'default'),
  ('verifyDocumentOrchestrator', false, true,  'lt-verify-orch',   'reviewer', 'default')
ON CONFLICT (workflow_type) DO NOTHING;
