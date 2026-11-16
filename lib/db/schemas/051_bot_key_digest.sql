-- Bot API keys and service tokens are found by the SHA-256 digest of the raw
-- secret: one indexed read per request. A row minted before this column
-- existed gains its digest the first time its key is presented.

ALTER TABLE lt_bot_api_keys ADD COLUMN IF NOT EXISTS key_digest TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_bot_api_keys_digest
  ON lt_bot_api_keys (key_digest) WHERE key_digest IS NOT NULL;

-- Rows still waiting for a digest. Empty once every key has been presented.
CREATE INDEX IF NOT EXISTS idx_lt_bot_api_keys_no_digest
  ON lt_bot_api_keys (id) WHERE key_digest IS NULL;

ALTER TABLE lt_service_tokens ADD COLUMN IF NOT EXISTS token_digest TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lt_service_tokens_digest
  ON lt_service_tokens (token_digest) WHERE token_digest IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lt_service_tokens_no_digest
  ON lt_service_tokens (id) WHERE token_digest IS NULL;
