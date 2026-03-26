import { getPool } from '../db';
import { encrypt, decrypt } from './crypto';
import { getProvider, type OAuthTokens } from './providers';
import type { LTDecryptedToken } from '../../types/oauth';
import type { LTUserRecord } from '../../types/user';

// ── SQL ──────────────────────────────────────────────────────────────────────

const UPSERT_TOKEN = `
  INSERT INTO lt_oauth_tokens
    (user_id, provider, access_token_enc, refresh_token_enc, token_type, scopes,
     expires_at, provider_user_id, provider_email, metadata)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
  ON CONFLICT (user_id, provider) DO UPDATE SET
    access_token_enc = EXCLUDED.access_token_enc,
    refresh_token_enc = COALESCE(EXCLUDED.refresh_token_enc, lt_oauth_tokens.refresh_token_enc),
    token_type = EXCLUDED.token_type,
    scopes = EXCLUDED.scopes,
    expires_at = EXCLUDED.expires_at,
    provider_user_id = EXCLUDED.provider_user_id,
    provider_email = COALESCE(EXCLUDED.provider_email, lt_oauth_tokens.provider_email),
    metadata = COALESCE(EXCLUDED.metadata, lt_oauth_tokens.metadata)
  RETURNING id`;

const GET_TOKEN = `
  SELECT * FROM lt_oauth_tokens WHERE user_id = $1 AND provider = $2`;

const LIST_CONNECTIONS = `
  SELECT provider, provider_email, scopes, expires_at
  FROM lt_oauth_tokens WHERE user_id = $1 ORDER BY provider`;

const DELETE_TOKEN = `
  DELETE FROM lt_oauth_tokens WHERE user_id = $1 AND provider = $2`;

const GET_USER_BY_OAUTH = `
  SELECT * FROM lt_users WHERE oauth_provider = $1 AND oauth_provider_id = $2`;

// ── Database operations ──────────────────────────────────────────────────────

export async function upsertOAuthToken(
  userId: string,
  provider: string,
  tokens: OAuthTokens,
  scopes: string[],
  providerUserId: string,
  providerEmail: string | null,
  metadata?: Record<string, any>,
): Promise<string> {
  const pool = await getPool();
  const result = await pool.query(UPSERT_TOKEN, [
    userId,
    provider,
    encrypt(tokens.accessToken),
    tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
    'bearer',
    scopes,
    tokens.accessTokenExpiresAt,
    providerUserId,
    providerEmail,
    metadata ? JSON.stringify(metadata) : null,
  ]);
  return result.rows[0].id;
}

export async function getOAuthToken(
  userId: string,
  provider: string,
): Promise<LTDecryptedToken | null> {
  const pool = await getPool();
  const { rows } = await pool.query(GET_TOKEN, [userId, provider]);
  if (rows.length === 0) return null;
  const row = rows[0];
  return {
    accessToken: decrypt(row.access_token_enc),
    refreshToken: row.refresh_token_enc ? decrypt(row.refresh_token_enc) : null,
    expiresAt: row.expires_at ? new Date(row.expires_at) : null,
    scopes: row.scopes || [],
    provider: row.provider,
  };
}

/**
 * Get a fresh access token, refreshing if expired.
 * Returns the access token string ready for use in API calls.
 */
export async function getFreshAccessToken(
  userId: string,
  provider: string,
): Promise<LTDecryptedToken> {
  const token = await getOAuthToken(userId, provider);
  if (!token) {
    throw new Error(`No OAuth connection for provider "${provider}" and user "${userId}"`);
  }

  // If not expired (with 60s buffer), return as-is
  if (token.expiresAt && token.expiresAt.getTime() > Date.now() + 60_000) {
    return token;
  }
  // If no expiry set (e.g., GitHub), return as-is
  if (!token.expiresAt) {
    return token;
  }

  // Refresh the token
  if (!token.refreshToken) {
    throw new Error(`Token expired for provider "${provider}" and no refresh token available`);
  }
  const handler = getProvider(provider);
  if (!handler) {
    throw new Error(`OAuth provider "${provider}" not configured`);
  }

  const refreshed = await handler.refreshAccessToken(token.refreshToken);
  await upsertOAuthToken(
    userId,
    provider,
    refreshed,
    token.scopes,
    '', // providerUserId unchanged (ON CONFLICT UPDATE keeps existing)
    null,
  );

  return {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken,
    expiresAt: refreshed.accessTokenExpiresAt,
    scopes: token.scopes,
    provider,
  };
}

export async function listOAuthConnections(userId: string): Promise<
  Array<{ provider: string; email: string | null; scopes: string[]; expires_at: string | null }>
> {
  const pool = await getPool();
  const { rows } = await pool.query(LIST_CONNECTIONS, [userId]);
  return rows.map((r) => ({
    provider: r.provider,
    email: r.provider_email,
    scopes: r.scopes || [],
    expires_at: r.expires_at ? new Date(r.expires_at).toISOString() : null,
  }));
}

export async function deleteOAuthConnection(userId: string, provider: string): Promise<boolean> {
  const pool = await getPool();
  const result = await pool.query(DELETE_TOKEN, [userId, provider]);
  return (result.rowCount ?? 0) > 0;
}

export async function getUserByOAuthProvider(
  provider: string,
  providerUserId: string,
): Promise<LTUserRecord | null> {
  const pool = await getPool();
  const { rows } = await pool.query(GET_USER_BY_OAUTH, [provider, providerUserId]);
  return rows[0] || null;
}
