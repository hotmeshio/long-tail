-- Add 'capability' reaction type and server_id/tool_name columns
-- for late-binding MCP tool invocation via agent subscriptions.

ALTER TABLE lt_agent_subscriptions
  DROP CONSTRAINT IF EXISTS lt_agent_subscriptions_reaction_type_check;

ALTER TABLE lt_agent_subscriptions
  ADD CONSTRAINT lt_agent_subscriptions_reaction_type_check
  CHECK (reaction_type IN ('durable', 'pipeline', 'mcp_query', 'capability'));

ALTER TABLE lt_agent_subscriptions ADD COLUMN IF NOT EXISTS server_id TEXT;
ALTER TABLE lt_agent_subscriptions ADD COLUMN IF NOT EXISTS tool_name TEXT;
