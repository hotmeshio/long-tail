// ── OAuth authorization server queries ─────────────────────────────────────

/** The grant owner's current memberships, as a JSON array. Expects alias `g`. */
const GRANT_ROLES = `
  COALESCE((
    SELECT json_agg(json_build_object(
      'role', r.role, 'type', r.type, 'read_scope', r.read_scope, 'write_scope', r.write_scope
    ) ORDER BY r.role)
    FROM lt_user_roles r WHERE r.user_id = g.user_id
  ), '[]'::json)`;

export const INSERT_CLIENT = `
  INSERT INTO lt_oauth_clients (client_id, client_name, redirect_uris)
  VALUES ($1, $2, $3)
  RETURNING client_id, client_name, redirect_uris, created_at`;

export const GET_CLIENT = `
  SELECT client_id, client_name, redirect_uris, created_at
  FROM lt_oauth_clients WHERE client_id = $1`;

/** Create the grant and its authorization code together. */
export const ISSUE_CODE = `
  WITH g AS (
    INSERT INTO lt_oauth_grants (user_id, client_id, policy, scope)
    VALUES ($1, $2, $3, $4)
    RETURNING id
  )
  INSERT INTO lt_oauth_codes (code_hash, grant_id, redirect_uri, code_challenge, resource, expires_at)
  SELECT $5, g.id, $6, $7, $8, NOW() + make_interval(secs => $9) FROM g
  RETURNING grant_id`;

/**
 * Consume a code and issue the first refresh token. The code must be unused,
 * unexpired, for this client and redirect URI, and match the PKCE challenge;
 * the grant must be live and its owner active.
 */
export const EXCHANGE_CODE = `
  WITH c AS (
    UPDATE lt_oauth_codes c SET used_at = NOW()
    FROM lt_oauth_grants g
    WHERE c.code_hash = $1 AND c.used_at IS NULL AND c.expires_at > NOW()
      AND c.redirect_uri = $3 AND c.code_challenge = $4
      AND g.id = c.grant_id AND g.client_id = $2 AND g.revoked_at IS NULL
    RETURNING c.grant_id, c.resource
  ),
  g AS (
    SELECT g.* FROM lt_oauth_grants g
    JOIN c ON c.grant_id = g.id
    JOIN lt_users u ON u.id = g.user_id AND u.status = 'active'
  ),
  rt AS (
    INSERT INTO lt_oauth_refresh_tokens (token_hash, grant_id, expires_at)
    SELECT $5, g.id, NOW() + make_interval(secs => $6) FROM g
    RETURNING grant_id
  )
  SELECT g.id AS grant_id, g.user_id, g.client_id, g.policy, g.scope, c.resource, ${GRANT_ROLES} AS roles
  FROM g JOIN rt ON rt.grant_id = g.id JOIN c ON c.grant_id = g.id`;

/**
 * The grant an access token names, as it stands now: only while the grant is
 * unrevoked and its owner active, with the owner's current memberships. One
 * primary-key lookup per /mcp request, so a revocation, a deactivation or a
 * role change takes effect on the next request in every process.
 */
export const GET_LIVE_GRANT = `
  SELECT g.id AS grant_id, g.user_id, g.client_id, g.policy, g.scope, ${GRANT_ROLES} AS roles
  FROM lt_oauth_grants g
  JOIN lt_users u ON u.id = g.user_id AND u.status = 'active'
  WHERE g.id = $1 AND g.user_id = $2 AND g.revoked_at IS NULL`;

/**
 * Rotate a refresh token: mark the old one used and issue its successor, only
 * for the client that holds it and while the grant is live and its owner
 * active. Returns current roles.
 */
export const ROTATE_REFRESH_TOKEN = `
  WITH old AS (
    UPDATE lt_oauth_refresh_tokens t SET used_at = NOW()
    FROM lt_oauth_grants og
    WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > NOW()
      AND og.id = t.grant_id AND og.client_id = $4
    RETURNING t.grant_id
  ),
  g AS (
    SELECT g.* FROM lt_oauth_grants g
    JOIN old ON old.grant_id = g.id
    JOIN lt_users u ON u.id = g.user_id AND u.status = 'active'
    WHERE g.revoked_at IS NULL
  ),
  rt AS (
    INSERT INTO lt_oauth_refresh_tokens (token_hash, grant_id, expires_at)
    SELECT $2, g.id, NOW() + make_interval(secs => $3) FROM g
    RETURNING grant_id
  )
  SELECT g.id AS grant_id, g.user_id, g.client_id, g.policy, g.scope, ${GRANT_ROLES} AS roles
  FROM g JOIN rt ON rt.grant_id = g.id`;

/**
 * Revoke the grant of a refresh token presented again after it was used,
 * outside the retry grace window: the token has leaked.
 */
export const REVOKE_ON_REFRESH_REUSE = `
  UPDATE lt_oauth_grants g SET revoked_at = NOW()
  FROM lt_oauth_refresh_tokens t
  WHERE t.token_hash = $1 AND t.used_at IS NOT NULL
    AND t.used_at < NOW() - make_interval(secs => $2)
    AND g.id = t.grant_id AND g.revoked_at IS NULL
  RETURNING g.id AS grant_id, g.user_id`;

/** Revoke the grant a refresh token belongs to, for the client presenting it. */
export const REVOKE_BY_REFRESH_TOKEN = `
  UPDATE lt_oauth_grants g SET revoked_at = NOW()
  FROM lt_oauth_refresh_tokens t
  WHERE t.token_hash = $1 AND g.id = t.grant_id AND g.client_id = $2 AND g.revoked_at IS NULL
  RETURNING g.id AS grant_id, g.user_id`;

/** Revoke a grant by id, optionally only when it belongs to the given user. */
export const REVOKE_GRANT = `
  UPDATE lt_oauth_grants SET revoked_at = NOW()
  WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2) AND revoked_at IS NULL
  RETURNING id AS grant_id, user_id`;

/** A person's live grants that a client has put to use, newest first. */
export const LIST_GRANTS = `
  SELECT g.id AS grant_id, g.client_id, c.client_name, g.policy, g.scope, g.created_at,
         (SELECT MAX(t.created_at) FROM lt_oauth_refresh_tokens t WHERE t.grant_id = g.id) AS last_used_at
  FROM lt_oauth_grants g
  JOIN lt_oauth_clients c ON c.client_id = g.client_id
  WHERE g.user_id = $1 AND g.revoked_at IS NULL
    AND EXISTS (SELECT 1 FROM lt_oauth_refresh_tokens t WHERE t.grant_id = g.id)
  ORDER BY g.created_at DESC`;
