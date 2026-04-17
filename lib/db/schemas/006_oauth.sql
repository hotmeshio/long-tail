-- ── OAuth token storage ─────────────────────────────────────────────────────
-- Encrypted per-user, per-provider OAuth tokens for identity and resource OAuth.

CREATE TABLE IF NOT EXISTS lt_oauth_tokens (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES lt_users(id) ON DELETE CASCADE,
  provider          TEXT NOT NULL,
  label             TEXT NOT NULL DEFAULT 'default',
  access_token_enc  TEXT NOT NULL,
  refresh_token_enc TEXT,
  token_type        TEXT NOT NULL DEFAULT 'bearer',
  scopes            TEXT[] NOT NULL DEFAULT '{}',
  expires_at        TIMESTAMPTZ,
  provider_user_id  TEXT NOT NULL,
  provider_email    TEXT,
  metadata          JSONB,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, provider, label)
);

-- Migration: add label column for multiple credentials per provider per user.
-- Existing rows get 'default'. The unique constraint moves from (user_id, provider)
-- to (user_id, provider, label).
ALTER TABLE lt_oauth_tokens ADD COLUMN IF NOT EXISTS label TEXT NOT NULL DEFAULT 'default';

-- Drop old unique constraint if it exists (safe no-op if already migrated)
DO $$ BEGIN
  ALTER TABLE lt_oauth_tokens DROP CONSTRAINT IF EXISTS lt_oauth_tokens_user_id_provider_key;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

-- Create the new composite unique constraint (idempotent via IF NOT EXISTS on index)
CREATE UNIQUE INDEX IF NOT EXISTS lt_oauth_tokens_user_id_provider_label_key
  ON lt_oauth_tokens (user_id, provider, label);

CREATE INDEX IF NOT EXISTS idx_lt_oauth_tokens_provider
  ON lt_oauth_tokens (provider, user_id);

CREATE OR REPLACE TRIGGER trg_lt_oauth_tokens_updated_at
  BEFORE UPDATE ON lt_oauth_tokens
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ── Identity link columns on lt_users ──────────────────────────────────────
ALTER TABLE lt_users ADD COLUMN IF NOT EXISTS oauth_provider TEXT;
ALTER TABLE lt_users ADD COLUMN IF NOT EXISTS oauth_provider_id TEXT;

CREATE INDEX IF NOT EXISTS idx_lt_users_oauth
  ON lt_users (oauth_provider, oauth_provider_id)
  WHERE oauth_provider IS NOT NULL;
