-- Migration 026: Scan-code schemes and rules
--
-- A scan code arrives from a physical input source (barcode scanner, RFID
-- reader, manual entry) as a plain string encoding version:category:target.
-- The leading digit (1-9) selects a SCHEME: which escalation metadata facet
-- the target resolves against and how the string parses (delimited text or
-- fixed-width digits). The two-digit category selects a RULE: an ordered
-- list of condition/action steps evaluated against the escalation surface,
-- plus a fallback screen when no step matches.
--
-- Rules are plain config consulted at execute time (like lt_config_workflows);
-- nothing pins a historical rule, so there is no snapshot table. Provenance
-- is stamped into escalation metadata by the execute path instead.

CREATE TABLE IF NOT EXISTS lt_config_scan_schemes (
  version       SMALLINT PRIMARY KEY CHECK (version BETWEEN 1 AND 9),
  name          TEXT NOT NULL,
  description   TEXT,
  target_facet  TEXT NOT NULL,
  encoding      TEXT NOT NULL DEFAULT 'fixed'
                  CHECK (encoding IN ('fixed', 'delimited')),
  delimiter     TEXT NOT NULL DEFAULT ':',
  target_length SMALLINT,
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- fixed-width parsing needs to know where the target ends
  CONSTRAINT chk_scan_scheme_fixed_length
    CHECK (encoding <> 'fixed' OR target_length IS NOT NULL)
);

CREATE OR REPLACE TRIGGER trg_lt_config_scan_schemes_updated_at
  BEFORE UPDATE ON lt_config_scan_schemes
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();

CREATE TABLE IF NOT EXISTS lt_config_scan_actions (
  scheme_version SMALLINT NOT NULL
                   REFERENCES lt_config_scan_schemes(version) ON DELETE CASCADE,
  category       TEXT NOT NULL CHECK (category ~ '^[0-9]{2}$'),
  name           TEXT NOT NULL,
  steps          JSONB NOT NULL DEFAULT '[]',
  fallback       JSONB NOT NULL DEFAULT '{}',
  enabled        BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scheme_version, category)
);

CREATE OR REPLACE TRIGGER trg_lt_config_scan_actions_updated_at
  BEFORE UPDATE ON lt_config_scan_actions
  FOR EACH ROW EXECUTE FUNCTION lt_set_updated_at();
