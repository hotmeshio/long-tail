-- ─── lt_user_roles: read/write work-surface scope ──────────────────────────
--
-- Open roles split the worker capability into two orthogonal axes so that
-- one-time and limited-surface users are first-class:
--
--   read_scope  (self | all)        → governs SEARCH (which items appear)
--   write_scope (none | self | all) → governs CLAIM / ACK / DELETE
--
-- `self` = escalations assigned to the user (assigned_to = userId); `all` = the
-- whole role queue. The only constraint is write ⊆ read (you cannot act on what
-- you cannot see). `type` (member/admin/superadmin) is unchanged — it remains the
-- management/global tier, and admin/superadmin ignore scope (always act on all).
--
-- Existing rows default to ('all','all') = today's `member` behavior, so this is
-- backward compatible with zero data backfill. Idempotent: no-op on fresh installs
-- where 001_schema.sql already created the columns and the named constraint.

ALTER TABLE lt_user_roles
  ADD COLUMN IF NOT EXISTS read_scope  TEXT NOT NULL DEFAULT 'all'
    CHECK (read_scope IN ('self', 'all'));

ALTER TABLE lt_user_roles
  ADD COLUMN IF NOT EXISTS write_scope TEXT NOT NULL DEFAULT 'all'
    CHECK (write_scope IN ('none', 'self', 'all'));

-- write ⊆ read: cannot act on the whole queue while only reading your own.
-- Guarded so a re-run (or a fresh install where 001 already added it) is a no-op.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_lt_user_roles_scope'
  ) THEN
    ALTER TABLE lt_user_roles
      ADD CONSTRAINT chk_lt_user_roles_scope
      CHECK (NOT (write_scope = 'all' AND read_scope = 'self'));
  END IF;
END $$;
