-- Migration 037: OAuth authorization server for /mcp
--
-- MCP clients register, a person consents to a grant, and the client holds a
-- refresh token for that grant. Access tokens are self-contained JWTs and are
-- never stored. Codes and refresh tokens are stored as SHA-256 hashes.

CREATE TABLE IF NOT EXISTS lt_oauth_clients (
  client_id     TEXT PRIMARY KEY,
  client_name   TEXT,
  redirect_uris TEXT[] NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A grant is one person's consent for one client. The policy is the rights
-- the person chose (a preset today); the scope is its coarse summary.
CREATE TABLE IF NOT EXISTS lt_oauth_grants (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES lt_users(id) ON DELETE CASCADE,
  client_id  TEXT NOT NULL REFERENCES lt_oauth_clients(client_id) ON DELETE CASCADE,
  policy     JSONB NOT NULL,
  scope      TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lt_oauth_grants_user ON lt_oauth_grants (user_id);

CREATE TABLE IF NOT EXISTS lt_oauth_codes (
  code_hash      TEXT PRIMARY KEY,
  grant_id       UUID NOT NULL REFERENCES lt_oauth_grants(id) ON DELETE CASCADE,
  redirect_uri   TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  resource       TEXT,
  expires_at     TIMESTAMPTZ NOT NULL,
  used_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS lt_oauth_refresh_tokens (
  token_hash TEXT PRIMARY KEY,
  grant_id   UUID NOT NULL REFERENCES lt_oauth_grants(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_oauth_refresh_tokens_grant ON lt_oauth_refresh_tokens (grant_id);
