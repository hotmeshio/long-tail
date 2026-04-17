-- Add credential_providers column to lt_mcp_servers
-- Declares which credential providers a server's tools need
ALTER TABLE lt_mcp_servers
  ADD COLUMN IF NOT EXISTS credential_providers TEXT[] NOT NULL DEFAULT '{}';
