-- ─── Users table ──────────────────────────────────────────────────────────────
-- Stores known users. Joinable with lt_escalations via:
--   lt_users.external_id = lt_escalations.assigned_to

CREATE TABLE IF NOT EXISTS lt_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  external_id   TEXT UNIQUE NOT NULL,
  email         TEXT,
  display_name  TEXT,
  role          TEXT NOT NULL DEFAULT 'reviewer',
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'suspended')),
  metadata      JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER lt_users_updated_at
  BEFORE UPDATE ON lt_users
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE INDEX IF NOT EXISTS idx_lt_users_role ON lt_users (role);
CREATE INDEX IF NOT EXISTS idx_lt_users_status ON lt_users (status);
