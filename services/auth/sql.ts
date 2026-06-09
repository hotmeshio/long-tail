// ── Bot API key queries ─────────────────────────────────────────────────────

export const INSERT_BOT_KEY = `
  INSERT INTO lt_bot_api_keys (name, user_id, key_hash, scopes, expires_at)
  VALUES ($1, $2, $3, $4, $5) RETURNING id`;

export const GET_BOT_KEYS_BY_USER = `
  SELECT id, name, user_id, key_hash, scopes
  FROM lt_bot_api_keys
  WHERE user_id = $1
    AND (expires_at IS NULL OR expires_at > NOW())`;

export const GET_ALL_ACTIVE_BOT_KEYS = `
  SELECT id, name, user_id, key_hash, scopes
  FROM lt_bot_api_keys
  WHERE (expires_at IS NULL OR expires_at > NOW())`;

export const UPDATE_BOT_KEY_LAST_USED = `
  UPDATE lt_bot_api_keys SET last_used_at = NOW() WHERE id = $1`;

export const DELETE_BOT_KEY = `
  DELETE FROM lt_bot_api_keys WHERE id = $1`;

export const LIST_BOT_KEYS_BY_USER = `
  SELECT id, name, user_id, scopes, expires_at, last_used_at, created_at, updated_at
  FROM lt_bot_api_keys WHERE user_id = $1 ORDER BY created_at`;

// ── Service token queries ───────────────────────────────────────────────────

export const INSERT_SERVICE_TOKEN = `
  INSERT INTO lt_service_tokens (name, token_hash, server_id, scopes, expires_at)
  VALUES ($1, $2, $3, $4, $5) RETURNING id`;

export const GET_ALL_ACTIVE_SERVICE_TOKENS = `
  SELECT id, name, token_hash FROM lt_service_tokens
  WHERE (expires_at IS NULL OR expires_at > NOW())`;

export const UPDATE_SERVICE_TOKEN_LAST_USED = `
  UPDATE lt_service_tokens SET last_used_at = NOW() WHERE id = $1`;

export const DELETE_SERVICE_TOKEN = `
  DELETE FROM lt_service_tokens WHERE id = $1`;

export const LIST_SERVICE_TOKENS_BY_SERVER = `
  SELECT id, name, server_id, scopes, expires_at, last_used_at, created_at, updated_at
  FROM lt_service_tokens WHERE server_id = $1 ORDER BY created_at`;
