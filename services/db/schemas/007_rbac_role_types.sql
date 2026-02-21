-- ─── Standardize role types to RBAC ───────────────────────────────────────────
-- Constrain lt_user_roles.type to: superadmin, admin, member.
-- Normalize any legacy data to 'member'.

UPDATE lt_user_roles
SET type = 'member'
WHERE type NOT IN ('superadmin', 'admin', 'member');

ALTER TABLE lt_user_roles
  ADD CONSTRAINT chk_lt_user_roles_type
  CHECK (type IN ('superadmin', 'admin', 'member'));
