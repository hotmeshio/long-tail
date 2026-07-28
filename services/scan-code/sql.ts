// ------------------------------------------------------------------ //
// Read queries                                                       //
// ------------------------------------------------------------------ //

export const LIST_SCHEMES = `\
SELECT * FROM lt_config_scan_schemes ORDER BY version`;

export const GET_SCHEME = `\
SELECT * FROM lt_config_scan_schemes WHERE version = $1`;

export const LIST_ACTIONS = `\
SELECT * FROM lt_config_scan_actions WHERE scheme_version = $1 ORDER BY category`;

export const GET_ACTION = `\
SELECT * FROM lt_config_scan_actions WHERE scheme_version = $1 AND category = $2`;

// ------------------------------------------------------------------ //
// Write / upsert queries                                             //
// ------------------------------------------------------------------ //

export const UPSERT_SCHEME = `\
INSERT INTO lt_config_scan_schemes
  (version, name, description, target_facet, encoding, delimiter, target_length, enabled)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (version) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  target_facet = EXCLUDED.target_facet,
  encoding = EXCLUDED.encoding,
  delimiter = EXCLUDED.delimiter,
  target_length = EXCLUDED.target_length,
  enabled = EXCLUDED.enabled
RETURNING *`;

export const DELETE_SCHEME = `\
DELETE FROM lt_config_scan_schemes WHERE version = $1`;

export const UPSERT_ACTION = `\
INSERT INTO lt_config_scan_actions
  (scheme_version, category, name, steps, fallback, enabled)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (scheme_version, category) DO UPDATE SET
  name = EXCLUDED.name,
  steps = EXCLUDED.steps,
  fallback = EXCLUDED.fallback,
  enabled = EXCLUDED.enabled
RETURNING *`;

export const DELETE_ACTION = `\
DELETE FROM lt_config_scan_actions WHERE scheme_version = $1 AND category = $2`;

// ------------------------------------------------------------------ //
// Seed (insert-if-absent — used at startup, DB is source of truth)   //
// ------------------------------------------------------------------ //

export const SEED_SCHEME = `\
INSERT INTO lt_config_scan_schemes
  (version, name, description, target_facet, encoding, delimiter, target_length, enabled)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
ON CONFLICT (version) DO NOTHING`;

export const SEED_ACTION = `\
INSERT INTO lt_config_scan_actions
  (scheme_version, category, name, steps, fallback, enabled)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (scheme_version, category) DO NOTHING`;
