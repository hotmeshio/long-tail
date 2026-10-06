// ─── Ephemeral credentials ──────────────────────────────────────────────────

/** Build INSERT for ephemeral credentials. expiresExpr is a SQL expression like 'NULL' or "NOW() + N * INTERVAL '1 second'". */
export const INSERT_EPHEMERAL = (expiresExpr: string) => `
  INSERT INTO lt_ephemeral_credentials (value, label, max_uses, bind_on_use, expires_at)
  VALUES ($1, $2, $3, $4, ${expiresExpr})
  RETURNING token`;

export const EXCHANGE_EPHEMERAL = `
  UPDATE lt_ephemeral_credentials
  SET use_count = use_count + 1
  WHERE token = $1
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses = 0 OR use_count < max_uses)
  RETURNING value, use_count, max_uses`;

/** Validity check without spending a use. A bound grant stays live until its TTL. */
export const PEEK_EPHEMERAL = `
  SELECT value, use_count, max_uses, bound_ref
  FROM lt_ephemeral_credentials
  WHERE token = $1
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (bound_ref IS NOT NULL OR max_uses = 0 OR use_count < max_uses)`;

/**
 * Spend one use, binding a bind_on_use grant to $2 on its first spend.
 * A bound grant acts again on its own ref without counting, and never on
 * another ref. Without a ref ($2 NULL) the grant counts like any other.
 */
export const CONSUME_EPHEMERAL = `
  UPDATE lt_ephemeral_credentials
  SET use_count = CASE WHEN bound_ref IS NOT NULL THEN use_count ELSE use_count + 1 END,
      bound_ref = CASE WHEN bind_on_use AND bound_ref IS NULL THEN $2::text ELSE bound_ref END
  WHERE token = $1
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (
      (bound_ref IS NOT NULL AND bound_ref = $2::text)
      OR (bound_ref IS NULL AND (max_uses = 0 OR use_count < max_uses))
    )
  RETURNING value, use_count, max_uses, bound_ref`;

/** Return a use an act spent but did not land; $2 also undoes the binding that spend made. */
export const REFUND_EPHEMERAL = `
  UPDATE lt_ephemeral_credentials
  SET use_count = GREATEST(use_count - 1, 0),
      bound_ref = CASE WHEN $2::boolean THEN NULL ELSE bound_ref END
  WHERE token = $1`;

export const DELETE_EPHEMERAL = `
  DELETE FROM lt_ephemeral_credentials WHERE token = $1`;

export const CLEANUP_EXPIRED_EPHEMERAL = `
  DELETE FROM lt_ephemeral_credentials
  WHERE expires_at IS NOT NULL AND expires_at < NOW()`;

// ─── Bot accounts ───────────────────────────────────────────────────────────

// $3 = status (nullable), $4 = search (nullable) — free text over the bot's
// display fields, mirroring listUsers' search so the two Accounts tabs offer
// the same server-side filter surface.
export const LIST_BOTS = `
  SELECT * FROM lt_users
  WHERE account_type = 'bot'
    AND ($3::text IS NULL OR status = $3)
    AND ($4::text IS NULL
      OR display_name ILIKE '%' || $4 || '%'
      OR external_id ILIKE '%' || $4 || '%'
      OR metadata->>'description' ILIKE '%' || $4 || '%')
  ORDER BY created_at DESC
  LIMIT $1 OFFSET $2`;

export const COUNT_BOTS = `
  SELECT COUNT(*)::int AS total FROM lt_users
  WHERE account_type = 'bot'
    AND ($1::text IS NULL OR status = $1)
    AND ($2::text IS NULL
      OR display_name ILIKE '%' || $2 || '%'
      OR external_id ILIKE '%' || $2 || '%'
      OR metadata->>'description' ILIKE '%' || $2 || '%')`;

export const SET_ACCOUNT_TYPE_BOT = `
  UPDATE lt_users SET account_type = $1 WHERE id = $2`;

export const GET_USER_BY_EXTERNAL_ID = `
  SELECT id FROM lt_users WHERE external_id = $1`;

// ─── Principal resolution ───────────────────────────────────────────────────

export const GET_USER_WITH_ROLES_FLEXIBLE = `
  SELECT u.id, u.external_id, u.display_name, u.status, u.metadata,
         r.role, r.type AS role_type
  FROM lt_users u
  LEFT JOIN lt_user_roles r ON r.user_id = u.id
  WHERE u.external_id = $1 OR u.id::text = $1
  ORDER BY r.created_at`;
