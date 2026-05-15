-- Add category column to MCP servers for capability grouping.
-- Replaces the tag-derived category mapping with an explicit, configurable value.

ALTER TABLE lt_mcp_servers ADD COLUMN IF NOT EXISTS category TEXT;

CREATE INDEX IF NOT EXISTS idx_lt_mcp_servers_category ON lt_mcp_servers (category) WHERE category IS NOT NULL;
