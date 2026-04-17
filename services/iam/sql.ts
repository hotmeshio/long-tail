// ─── Ephemeral credentials ──────────────────────────────────────────────────

/** Build INSERT for ephemeral credentials. expiresExpr is a SQL expression like 'NULL' or "NOW() + N * INTERVAL '1 second'". */
export const INSERT_EPHEMERAL = (expiresExpr: string) => `
  INSERT INTO lt_ephemeral_credentials (value, label, max_uses, expires_at)
  VALUES ($1, $2, $3, ${expiresExpr})
  RETURNING token`;

export const EXCHANGE_EPHEMERAL = `
  UPDATE lt_ephemeral_credentials
  SET use_count = use_count + 1
  WHERE token = $1
    AND (expires_at IS NULL OR expires_at > NOW())
    AND (max_uses = 0 OR use_count < max_uses)
  RETURNING value, use_count, max_uses`;

export const DELETE_EPHEMERAL = `
  DELETE FROM lt_ephemeral_credentials WHERE token = $1`;

export const CLEANUP_EXPIRED_EPHEMERAL = `
  DELETE FROM lt_ephemeral_credentials
  WHERE expires_at IS NOT NULL AND expires_at < NOW()`;

// ─── Bot accounts ───────────────────────────────────────────────────────────

export const LIST_BOTS = `
  SELECT * FROM lt_users
  WHERE account_type = 'bot'
  ORDER BY created_at DESC
  LIMIT $1 OFFSET $2`;

export const COUNT_BOTS = `
  SELECT COUNT(*)::int AS total FROM lt_users WHERE account_type = 'bot'`;

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
