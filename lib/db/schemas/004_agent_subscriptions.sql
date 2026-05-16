-- Agent event subscriptions — reactive wiring from events to workflows.
-- Each row maps a topic pattern to a workflow reaction for a specific agent.

CREATE TABLE IF NOT EXISTS lt_agent_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        UUID NOT NULL REFERENCES lt_agents(id) ON DELETE CASCADE,

  -- What to listen for
  topic           TEXT NOT NULL,
  filter          JSONB,

  -- How to react
  reaction_type   TEXT NOT NULL CHECK (reaction_type IN ('durable', 'pipeline', 'mcp_query')),
  workflow_type   TEXT,
  pipeline_id     UUID,
  mcp_prompt      TEXT,

  -- Input mapping: transform event payload → workflow envelope
  input_mapping   JSONB NOT NULL DEFAULT '{}'::JSONB,

  -- Identity for the reaction execution
  execute_as      TEXT,

  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_agent_subs_agent ON lt_agent_subscriptions (agent_id);
CREATE INDEX IF NOT EXISTS idx_lt_agent_subs_topic ON lt_agent_subscriptions (topic);
CREATE INDEX IF NOT EXISTS idx_lt_agent_subs_enabled ON lt_agent_subscriptions (enabled) WHERE enabled = true;

CREATE OR REPLACE TRIGGER trg_lt_agent_subs_updated_at
  BEFORE UPDATE ON lt_agent_subscriptions
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- Add GIN index on agent behaviors for efficient trigger queries
CREATE INDEX IF NOT EXISTS idx_lt_agents_behaviors ON lt_agents USING GIN (behaviors);
