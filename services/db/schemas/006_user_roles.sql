-- ─── User roles (many-to-many) ────────────────────────────────────────────────
-- A user can have multiple roles. Each role has a `type` classification
-- (e.g., 'admin', 'reviewer') used for permission checks like isUserAdmin().

CREATE TABLE IF NOT EXISTS lt_user_roles (
  user_id    UUID NOT NULL REFERENCES lt_users(id) ON DELETE CASCADE,
  role       TEXT NOT NULL,
  type       TEXT NOT NULL DEFAULT 'custom',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, role)
);

CREATE INDEX IF NOT EXISTS idx_lt_user_roles_type ON lt_user_roles (type);
CREATE INDEX IF NOT EXISTS idx_lt_user_roles_user_id ON lt_user_roles (user_id);

-- Migrate existing role data from lt_users into lt_user_roles
INSERT INTO lt_user_roles (user_id, role, type)
SELECT id, role, role FROM lt_users
WHERE role IS NOT NULL
ON CONFLICT DO NOTHING;

-- Drop the old single-role column and its index
DROP INDEX IF EXISTS idx_lt_users_role;
ALTER TABLE lt_users DROP COLUMN IF EXISTS role;
