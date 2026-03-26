-- ── Service tokens for external MCP servers ─────────────────────────────────
CREATE TABLE IF NOT EXISTS lt_service_tokens (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT UNIQUE NOT NULL,
  token_hash   TEXT NOT NULL,
  server_id    UUID REFERENCES lt_mcp_servers(id) ON DELETE CASCADE,
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_service_tokens_server
  ON lt_service_tokens (server_id);

CREATE OR REPLACE TRIGGER trg_lt_service_tokens_updated_at
  BEFORE UPDATE ON lt_service_tokens
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ── Audit: who initiated escalations ────────────────────────────────────────
ALTER TABLE lt_escalations ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES lt_users(id);
CREATE INDEX IF NOT EXISTS idx_lt_escalations_created_by
  ON lt_escalations (created_by) WHERE created_by IS NOT NULL;

-- ── Scope declarations for MCP servers ──────────────────────────────────────
ALTER TABLE lt_mcp_servers ADD COLUMN IF NOT EXISTS required_scopes TEXT[] NOT NULL DEFAULT '{}';
