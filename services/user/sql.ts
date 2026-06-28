// ─── Shared queries (used by multiple modules) ──────────────────────────────

/** Ensure a role name exists in the lt_roles lookup table (FK target). */
export const ENSURE_ROLE_EXISTS =
  'INSERT INTO lt_roles (role) VALUES ($1) ON CONFLICT DO NOTHING';

/** Fetch roles for a single user, ordered by creation time. */
export const GET_ROLES_BY_USER_ID =
  'SELECT role, type, read_scope, write_scope, created_at FROM lt_user_roles WHERE user_id = $1 ORDER BY created_at';

/** Fetch a user row by external_id. */
export const GET_USER_BY_EXTERNAL_ID =
  'SELECT * FROM lt_users WHERE external_id = $1';

// ─── User CRUD ───────────────────────────────────────────────────────────────

/**
 * Create a user and its role assignments in ONE atomic statement. The user row,
 * the lt_roles FK targets ($9 = role names), and the lt_user_roles links
 * ($9 names × $10 types × $11 read_scope × $12 write_scope) all commit together —
 * a failure can never leave a half-provisioned user with a partial role set, and
 * there is no per-role N+1. All four are passed as parallel text[] arrays (empty
 * arrays → no roles). Postgres checks the lt_user_roles→lt_roles FK at statement
 * end, after the sibling role-ensure CTE has run, so brand-new roles are valid
 * FK targets.
 */
export const CREATE_USER_WITH_ROLES =
  `WITH new_user AS (
     INSERT INTO lt_users (external_id, email, display_name, status, metadata, password_hash, oauth_provider, oauth_provider_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *
   ), ensured_roles AS (
     INSERT INTO lt_roles (role)
     SELECT DISTINCT unnest($9::text[])
     ON CONFLICT DO NOTHING
   ), assigned_roles AS (
     INSERT INTO lt_user_roles (user_id, role, type, read_scope, write_scope)
     SELECT (SELECT id FROM new_user), x.role, x.type, x.read_scope, x.write_scope
     FROM unnest($9::text[], $10::text[], $11::text[], $12::text[]) AS x(role, type, read_scope, write_scope)
     ON CONFLICT DO NOTHING
   )
   SELECT * FROM new_user`;

export const GET_USER_BY_EMAIL =
  `SELECT * FROM lt_users WHERE email = $1 LIMIT 1`;

export const GET_USER_BY_ID =
  'SELECT * FROM lt_users WHERE id = $1';

/** Check if a user exists by id. Lightweight — returns only the id column. */
export const VERIFY_USER_BY_ID =
  'SELECT id FROM lt_users WHERE id = $1 LIMIT 1';

/** Fetch user + roles in a single query. Returns one row per role (or one row with nulls if no roles). */
export const GET_USER_WITH_ROLES =
  `SELECT u.id, u.external_id, u.display_name, u.status, u.metadata,
          r.role, r.type AS role_type, r.read_scope, r.write_scope
   FROM lt_users u
   LEFT JOIN lt_user_roles r ON r.user_id = u.id
   WHERE u.external_id = $1
   ORDER BY r.created_at`;

export const DELETE_USER_BY_ID =
  'DELETE FROM lt_users WHERE id = $1';

// ─── Role management ─────────────────────────────────────────────────────────

/** Batch-load roles for many users (avoids N+1). */
export const GET_ROLES_BY_USER_IDS =
  'SELECT user_id, role, type, read_scope, write_scope, created_at FROM lt_user_roles WHERE user_id = ANY($1) ORDER BY created_at';

/** Upsert a user–role assignment, promoting the type/scope if the row exists. */
export const UPSERT_USER_ROLE =
  `INSERT INTO lt_user_roles (user_id, role, type, read_scope, write_scope) VALUES ($1, $2, $3, $4, $5)
   ON CONFLICT (user_id, role) DO UPDATE SET
     type = EXCLUDED.type,
     read_scope = EXCLUDED.read_scope,
     write_scope = EXCLUDED.write_scope
   RETURNING role, type, read_scope, write_scope, created_at`;

export const DELETE_USER_ROLE =
  'DELETE FROM lt_user_roles WHERE user_id = $1 AND role = $2';

export const HAS_ROLE =
  'SELECT 1 FROM lt_user_roles WHERE user_id = $1 AND role = $2 LIMIT 1';

export const HAS_ROLE_TYPE =
  'SELECT 1 FROM lt_user_roles WHERE user_id = $1 AND type = $2 LIMIT 1';

/** Fetch the management tier + scope for one (user, role) — used for write enforcement. */
export const GET_ROLE_SCOPE =
  'SELECT type, read_scope, write_scope FROM lt_user_roles WHERE user_id = $1 AND role = $2 LIMIT 1';

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
