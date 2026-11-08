-- Migration 044: label templates and the label ledger
--
-- lt_config_label_templates: what one printed label shows for a scan scheme.
-- `codes` lists the rules printed on the label, each beside its caption, in
-- order: [{ category, caption?, tone }]. `text` holds the title and up to two
-- lines, written in label tokens ({target}, {item.<facet>}, {user.<key>}).
-- `revision` advances on every change; `source` says who declared it.
-- Templates on an identity scheme are always sensitive.
--
-- lt_label_jobs: one row per credential event or label print, written before
-- any code leaves the server. It holds who asked, what template (snapshot),
-- and who or what the labels name. Identity codes are never stored: identity
-- jobs record subject_user_ids, item jobs record targets. Rows are never
-- deleted by the platform.

CREATE TABLE IF NOT EXISTS lt_config_label_templates (
  name            TEXT PRIMARY KEY CHECK (name ~ '^[a-z0-9][a-z0-9-]{0,62}$'),
  scheme_version  INT NOT NULL REFERENCES lt_config_scan_schemes(version) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  codes           JSONB NOT NULL,
  text            JSONB NOT NULL DEFAULT '{}'::jsonb,
  symbology       TEXT NOT NULL DEFAULT 'code128'
                    CHECK (symbology IN ('code128', 'qrcode', 'datamatrix')),
  human_readable  BOOLEAN NOT NULL DEFAULT true,
  media           TEXT,
  sensitive       BOOLEAN NOT NULL DEFAULT false,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  revision        INT NOT NULL DEFAULT 1,
  source          TEXT NOT NULL DEFAULT 'api' CHECK (source IN ('code', 'api')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lt_config_label_templates_scheme_idx
  ON lt_config_label_templates (scheme_version);

DROP TRIGGER IF EXISTS trg_lt_config_label_templates_updated_at ON lt_config_label_templates;
CREATE TRIGGER trg_lt_config_label_templates_updated_at
  BEFORE UPDATE ON lt_config_label_templates
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE TABLE IF NOT EXISTS lt_label_jobs (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action             TEXT NOT NULL CHECK (action IN ('print', 'reissue', 'bind')),
  requested_by       UUID,
  idempotency_key    TEXT UNIQUE,
  template_name      TEXT,
  template_revision  INT,
  template_snapshot  JSONB,
  scheme_version     INT,
  scheme_kind        TEXT,
  sensitive          BOOLEAN NOT NULL DEFAULT false,
  source             JSONB NOT NULL DEFAULT '{}'::jsonb,
  subject_user_ids   UUID[],
  targets            TEXT[],
  label_count        INT NOT NULL DEFAULT 0,
  media              JSONB,
  output             TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lt_label_jobs_created_idx ON lt_label_jobs (created_at DESC);
CREATE INDEX IF NOT EXISTS lt_label_jobs_requester_idx ON lt_label_jobs (requested_by, created_at DESC);
CREATE INDEX IF NOT EXISTS lt_label_jobs_subjects_idx ON lt_label_jobs USING GIN (subject_user_ids);
