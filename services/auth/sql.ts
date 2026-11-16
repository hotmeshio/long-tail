// ── Bot API key queries ─────────────────────────────────────────────────────

export const INSERT_BOT_KEY = `
  INSERT INTO lt_bot_api_keys (name, user_id, key_hash, key_digest, scopes, expires_at)
  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;

/**
 * The key a digest names, as it stands now: only while the key is unexpired
 * and its bot active, with the bot's current memberships. One indexed read per
 * request, so a revocation, a deactivation or a role change takes effect on
 * the next request in every process. $2 is the last-used stamp interval.
 */
export const GET_LIVE_BOT_KEY = `
  SELECT k.id, k.name, k.user_id, k.scopes,
         (k.last_used_at IS NULL OR k.last_used_at < NOW() - make_interval(secs => $2)) AS stamp_due,
         COALESCE((
           SELECT json_agg(json_build_object('role', r.role, 'type', r.type) ORDER BY r.role)
           FROM lt_user_roles r WHERE r.user_id = k.user_id
         ), '[]'::json) AS roles
  FROM lt_bot_api_keys k
  JOIN lt_users u ON u.id = k.user_id AND u.status = 'active'
  WHERE k.key_digest = $1 AND (k.expires_at IS NULL OR k.expires_at > NOW())`;

/** Unexpired keys that have no digest yet. */
export const GET_BOT_KEYS_WITHOUT_DIGEST = `
  SELECT id, key_hash AS hash FROM lt_bot_api_keys
  WHERE key_digest IS NULL AND (expires_at IS NULL OR expires_at > NOW())`;

export const SET_BOT_KEY_DIGEST = `
  UPDATE lt_bot_api_keys SET key_digest = $2 WHERE id = $1 AND key_digest IS NULL`;

/** Stamp last use at most once per interval ($2, seconds). */
export const STAMP_BOT_KEY_LAST_USED = `
  UPDATE lt_bot_api_keys SET last_used_at = NOW()
  WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - make_interval(secs => $2))`;

export const DELETE_BOT_KEY = `
  DELETE FROM lt_bot_api_keys WHERE id = $1`;

export const GET_BOT_KEY_OWNER = `
  SELECT user_id FROM lt_bot_api_keys WHERE id = $1`;

export const LIST_BOT_KEYS_BY_USER = `
  SELECT id, name, user_id, scopes, expires_at, last_used_at, created_at, updated_at
  FROM lt_bot_api_keys WHERE user_id = $1 ORDER BY created_at`;

// ── Service token queries ───────────────────────────────────────────────────

export const INSERT_SERVICE_TOKEN = `
  INSERT INTO lt_service_tokens (name, token_hash, token_digest, server_id, scopes, expires_at)
  VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`;

/** The unexpired token a digest names. $2 is the last-used stamp interval. */
export const GET_LIVE_SERVICE_TOKEN = `
  SELECT id, name, server_id, scopes, expires_at, last_used_at, created_at, updated_at,
         (last_used_at IS NULL OR last_used_at < NOW() - make_interval(secs => $2)) AS stamp_due
  FROM lt_service_tokens
  WHERE token_digest = $1 AND (expires_at IS NULL OR expires_at > NOW())`;

/** Unexpired tokens that have no digest yet. */
export const GET_SERVICE_TOKENS_WITHOUT_DIGEST = `
  SELECT id, token_hash AS hash FROM lt_service_tokens
  WHERE token_digest IS NULL AND (expires_at IS NULL OR expires_at > NOW())`;

export const SET_SERVICE_TOKEN_DIGEST = `
  UPDATE lt_service_tokens SET token_digest = $2 WHERE id = $1 AND token_digest IS NULL`;

/** Stamp last use at most once per interval ($2, seconds). */
export const STAMP_SERVICE_TOKEN_LAST_USED = `
  UPDATE lt_service_tokens SET last_used_at = NOW()
  WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < NOW() - make_interval(secs => $2))`;

export const DELETE_SERVICE_TOKEN = `
  DELETE FROM lt_service_tokens WHERE id = $1`;

export const LIST_SERVICE_TOKENS_BY_SERVER = `
  SELECT id, name, server_id, scopes, expires_at, last_used_at, created_at, updated_at
  FROM lt_service_tokens WHERE server_id = $1 ORDER BY created_at`;
