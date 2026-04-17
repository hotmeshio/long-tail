// ─── OAuth token CRUD ───────────────────────────────────────────────────────

export const UPSERT_TOKEN = `
  INSERT INTO lt_oauth_tokens
    (user_id, provider, label, access_token_enc, refresh_token_enc, token_type, scopes,
     expires_at, provider_user_id, provider_email, metadata)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
  ON CONFLICT (user_id, provider, label) DO UPDATE SET
    access_token_enc = EXCLUDED.access_token_enc,
    refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, lt_oauth_tokens.refresh_token_enc),
    token_type = EXCLUDED.token_type,
    scopes = EXCLUDED.scopes,
    expires_at = EXCLUDED.expires_at,
    provider_user_id = EXCLUDED.provider_user_id,
    provider_email = COALESCE(EXCLUDED.provider_email, lt_oauth_tokens.provider_email),
    metadata = COALESCE(EXCLUDED.metadata, lt_oauth_tokens.metadata)
  RETURNING id`;

export const GET_TOKEN = `
  SELECT * FROM lt_oauth_tokens WHERE user_id = $1 AND provider = $2 AND label = $3`;

export const GET_TOKEN_DEFAULT = `
  SELECT * FROM lt_oauth_tokens WHERE user_id = $1 AND provider = $2 AND label = 'default'`;

export const LIST_CONNECTIONS = `
  SELECT provider, label, provider_email, scopes, expires_at, metadata
  FROM lt_oauth_tokens WHERE user_id = $1 ORDER BY provider, label`;

export const DELETE_TOKEN = `
  DELETE FROM lt_oauth_tokens WHERE user_id = $1 AND provider = $2 AND label = $3`;

export const DELETE_TOKEN_DEFAULT = `
  DELETE FROM lt_oauth_tokens WHERE user_id = $1 AND provider = $2 AND label = 'default'`;

export const GET_USER_BY_OAUTH = `
  SELECT * FROM lt_users WHERE oauth_provider = $1 AND oauth_provider_id = $2`;
