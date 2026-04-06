-- 008_bot_accounts.sql
-- Bot/service account support for universal IAM.
-- Bots live in lt_users (account_type = 'bot') and authenticate via API keys.

-- Add account_type column to lt_users to distinguish human vs bot accounts.
ALTER TABLE lt_users ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'user';

-- Apply check constraint (idempotent: skip if already exists).
DO $$ BEGIN
  ALTER TABLE lt_users ADD CONSTRAINT lt_users_account_type_check
    CHECK (account_type IN ('user', 'bot'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Bot API keys — similar to lt_service_tokens but scoped to a user (bot) account.
CREATE TABLE IF NOT EXISTS lt_bot_api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  user_id      UUID NOT NULL REFERENCES lt_users(id) ON DELETE CASCADE,
  key_hash     TEXT NOT NULL,
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  expires_at   TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, name)
);

CREATE INDEX IF NOT EXISTS idx_bot_api_keys_user_id ON lt_bot_api_keys (user_id);
