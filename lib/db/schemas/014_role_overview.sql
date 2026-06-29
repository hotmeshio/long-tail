-- ─── Role overview: the lt_roles row IS the surface ────────────────────────
--
-- A role is the universal pivot — the queue (escalations waiting), the view (how
-- that work is presented), and the RBAC boundary (who may see/act). It is also
-- the human↔AI boundary: the contract is the verbs (claim / ack / resolve), not
-- the identity of the servicer. So the role row grows to describe itself, and to
-- carry the goal "dials" a time-series overview measures reality against.
--
-- Idempotent throughout (ADD COLUMN / CREATE TABLE IF NOT EXISTS); a re-run or a
-- fresh install where 001 already created lt_roles is a no-op. No data backfill:
-- existing rows get NULL config (the app reads NULL home_view as 'queue').

-- ── lt_roles: title / purpose / schema / home_view ─────────────────────────

ALTER TABLE lt_roles ADD COLUMN IF NOT EXISTS title           TEXT;
ALTER TABLE lt_roles ADD COLUMN IF NOT EXISTS purpose         TEXT;
ALTER TABLE lt_roles ADD COLUMN IF NOT EXISTS metadata_schema JSONB;
ALTER TABLE lt_roles ADD COLUMN IF NOT EXISTS home_view       TEXT;

-- home_view ∈ {queue, overview}; NULL = unset (app falls back to 'queue').
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_lt_roles_home_view'
  ) THEN
    ALTER TABLE lt_roles
      ADD CONSTRAINT chk_lt_roles_home_view
      CHECK (home_view IS NULL OR home_view IN ('queue', 'overview'));
  END IF;
END $$;

-- ── lt_role_dials: the declared per-unit TAT target per (role, station) ──────
--
-- The one measured truth is per-unit TAT: (resolved_at − created_at) / units.
-- The only legitimate target is the one a COO explicitly declares — the promised
-- per-unit turnaround. The overview's height is measured TAT vs this target
-- (100% = holding the promise). Quantity goals and upstream-flow modeling are
-- dynamic UI knobs, deliberately NOT persisted here.
--
-- One-to-N: a role can be overloaded across several stations, each with its own
-- promised per-unit time.

CREATE TABLE IF NOT EXISTS lt_role_dials (
  role               TEXT        NOT NULL REFERENCES lt_roles(role) ON DELETE CASCADE,
  station_key        TEXT        NOT NULL,
  target_tat_seconds NUMERIC     NOT NULL CHECK (target_tat_seconds > 0), -- promised sec/unit
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, station_key)
);

CREATE OR REPLACE TRIGGER lt_role_dials_updated_at
  BEFORE UPDATE ON lt_role_dials
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

-- ── lt_role_baselines: immutable "Set baseline" snapshots ───────────────────
--
-- Append-only. A baseline freezes the computed overview at a moment so "now vs
-- baseline" compares against exactly what the operator saw — not a reference
-- window that silently drifts as rows later resolve, cancel, or archive.

CREATE TABLE IF NOT EXISTS lt_role_baselines (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  role         TEXT        NOT NULL REFERENCES lt_roles(role) ON DELETE CASCADE,
  label        TEXT,
  range_key    TEXT        NOT NULL,                  -- '15m' | '1h' | '1d' | '7d' | '30d'
  window_start TIMESTAMPTZ NOT NULL,
  window_end   TIMESTAMPTZ NOT NULL,
  snapshot     JSONB       NOT NULL,                  -- the materialized overview result
  facet_query  JSONB,                                 -- FacetQuery used, for reproducibility
  created_by   UUID,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_lt_role_baselines_role
  ON lt_role_baselines (role, created_at DESC);
