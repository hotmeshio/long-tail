-- Ephemeral credential store for sensitive fields in waitFor signal payloads.
-- Supports max_uses (0 = unlimited) and TTL-based expiry.

CREATE TABLE IF NOT EXISTS lt_ephemeral_credentials (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  value       BYTEA NOT NULL,
  label       TEXT,
  max_uses    INTEGER NOT NULL DEFAULT 0,
  use_count   INTEGER NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_ephemeral_expiry
  ON lt_ephemeral_credentials (expires_at)
  WHERE expires_at IS NOT NULL;
