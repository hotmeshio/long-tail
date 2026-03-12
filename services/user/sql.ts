// ─── Shared queries (used by multiple modules) ──────────────────────────────

/** Ensure a role name exists in the lt_roles lookup table (FK target). */
export const ENSURE_ROLE_EXISTS =
  'INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING';

/** Fetch roles for a single user, ordered by creation time. */
export const GET_ROLES_BY_USER_ID =
  'SELECT role, type, created_at FROM lt_user_roles WHERE user_id = $1 ORDER BY created_at';

/** Fetch a user row by external_id. */
export const GET_USER_BY_EXTERNAL_ID =
  'SELECT * FROM lt_users WHERE external_id = $1';

// ─── User CRUD ───────────────────────────────────────────────────────────────

export const INSERT_USER =
  `INSERT INTO lt_users (external_id, email, display_name, status, metadata, password_hash)
   VALUES ($1, $2, $3, $4, $5, $6)
   RETURNING *`;

export const INSERT_USER_ROLE_IGNORE =
  `INSERT INTO lt_user_roles (user_id, role, type) VALUES ($1, $2, $3)
   ON CONFLICT DO NOTHING`;

export const GET_USER_BY_ID =
  'SELECT * FROM lt_users WHERE id = $1';

export const DELETE_USER_BY_ID =
  'DELETE FROM lt_users WHERE id = $1';

// ─── Role management ─────────────────────────────────────────────────────────

/** Batch-load roles for many users (avoids N+1). */
export const GET_ROLES_BY_USER_IDS =
  'SELECT user_id, role, type, created_at FROM lt_user_roles WHERE user_id = ANY($1) ORDER BY created_at';

/** Upsert a user–role assignment, promoting the type if the row exists. */
export const UPSERT_USER_ROLE =
  `INSERT INTO lt_user_roles (user_id, role, type) VALUES ($1, $2, $3)
   ON CONFLICT (user_id, role) DO UPDATE SET type = EXCLUDED.type
   RETURNING role, type, created_at`;

export const DELETE_USER_ROLE =
  'DELETE FROM lt_user_roles WHERE user_id = $1 AND role = $2';

export const HAS_ROLE =
  'SELECT 1 FROM lt_user_roles WHERE user_id = $1 AND role = $2 LIMIT 1';

export const HAS_ROLE_TYPE =
  'SELECT 1 FROM lt_user_roles WHERE user_id = $1 AND type = $2 LIMIT 1';

// ─── RBAC ────────────────────────────────────────────────────────────────────

/** Check if a user is an admin (or superadmin) of a specific role group. */
export const IS_GROUP_ADMIN =
  `SELECT 1 FROM lt_user_roles
   WHERE user_id = $1
     AND (
       (role = $2 AND type IN ('admin', 'superadmin'))
       OR type = 'superadmin'
     )
   LIMIT 1`;
