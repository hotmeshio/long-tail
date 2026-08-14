-- Migration 031: Dashboard announcements
--
-- Broadcast notices for the dashboard surface (system.surfaces.dashboard).
-- Role targeting is display scoping only — live events reach every
-- authenticated socket, so a body must never carry secrets. Rows expire by
-- timestamp; dismissal is per-browser on the client.

CREATE TABLE IF NOT EXISTS lt_announcements (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title      TEXT,
  body       TEXT NOT NULL,
  layout     TEXT NOT NULL DEFAULT 'banner',
  roles      TEXT[] NOT NULL DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours'
);

CREATE INDEX IF NOT EXISTS idx_lt_announcements_expires ON lt_announcements (expires_at);

-- The announcement topic (system.surfaces.dashboard) introduces the
-- 'surfaces' category to the topic catalog.
ALTER TABLE lt_topic_catalog
  DROP CONSTRAINT IF EXISTS lt_topic_catalog_category_check;

ALTER TABLE lt_topic_catalog
  ADD CONSTRAINT lt_topic_catalog_category_check
  CHECK (category IN (
    'task','workflow','escalation','activity','knowledge','file','agent','app','milestone','surfaces'
  ));
