-- Migration 046: identifier bindings
--
-- A binding pairs a scanned value (raw) with the thing it stands for (target)
-- under one scan scheme: a cartridge's tag with the material lot it carries,
-- a plate with the printer it is aboard. A raw has one live target at a time;
-- a rebind retires the old row and inserts the new one, and retired rows are
-- kept as history. A scheme that marks its targets exclusive also holds one
-- live raw per target. The partial unique indexes decide concurrent binds.
--
-- identifier on a scheme holds its binding settings (binders, exclusiveTarget).
-- Both are additive: nothing reads them until a deployment binds.

ALTER TABLE lt_config_scan_schemes
  ADD COLUMN IF NOT EXISTS identifier JSONB;

CREATE TABLE IF NOT EXISTS lt_identifier_bindings (
  id             BIGSERIAL PRIMARY KEY,
  scheme_version INT  NOT NULL REFERENCES lt_config_scan_schemes(version) ON DELETE CASCADE,
  raw            TEXT NOT NULL,
  target         TEXT NOT NULL,
  exclusive      BOOLEAN NOT NULL DEFAULT false,
  bound_by       UUID,
  bound_via      TEXT NOT NULL,
  bound_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  retired_at     TIMESTAMPTZ,
  retired_by     UUID
);

CREATE UNIQUE INDEX IF NOT EXISTS lt_identifier_bindings_live_raw
  ON lt_identifier_bindings (scheme_version, raw) WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS lt_identifier_bindings_live_target
  ON lt_identifier_bindings (scheme_version, target) WHERE retired_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lt_identifier_bindings_live_exclusive_target
  ON lt_identifier_bindings (scheme_version, target) WHERE retired_at IS NULL AND exclusive;
