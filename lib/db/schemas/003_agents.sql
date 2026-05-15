-- Long Tail: Agent data model
-- Agents are autonomous personas that compose identity, memory, capabilities,
-- behaviors, and goals atop existing primitives.

CREATE TABLE IF NOT EXISTS lt_agents (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT UNIQUE NOT NULL,
  description       TEXT,
  status            TEXT NOT NULL DEFAULT 'inactive'
                      CHECK (status IN ('inactive', 'active', 'paused', 'error')),

  -- Identity: links to a service account (bot user)
  user_id           UUID REFERENCES lt_users(id) ON DELETE SET NULL,

  -- Memory: knowledge domain this agent owns
  knowledge_domain  TEXT,

  -- Capabilities: which MCP servers/tools it can use
  capabilities      JSONB NOT NULL DEFAULT '[]'::JSONB,

  -- Behaviors: triggers, schedules, escalation patterns
  behaviors         JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Goals and guardrails (natural language)
  goals             TEXT,
  rules             TEXT,

  -- Workflow bindings (soft references)
  workflow_type     TEXT,
  pipeline_id       UUID,

  -- Metadata
  metadata          JSONB NOT NULL DEFAULT '{}'::JSONB,
  last_run_at       TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_agents_status ON lt_agents (status);
CREATE INDEX IF NOT EXISTS idx_lt_agents_user_id ON lt_agents (user_id);
CREATE INDEX IF NOT EXISTS idx_lt_agents_knowledge_domain ON lt_agents (knowledge_domain);
CREATE INDEX IF NOT EXISTS idx_lt_agents_capabilities ON lt_agents USING GIN (capabilities);

CREATE OR REPLACE TRIGGER trg_lt_agents_updated_at
  BEFORE UPDATE ON lt_agents
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();
