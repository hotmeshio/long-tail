-- Migration 027: Scan-code numbering inversion
--
-- The scheme index moves to the leading TWO digits (10-99) and the category
-- (rule) index to a single digit (0-9): a code now reads ##:#:target. Two
-- reasons: a code never starts with a leading zero (some scanners choke on it),
-- and the top-level "named item" you organize by (the scheme) gets the wider
-- 90-slot space while each scheme's rules stay a small 0-9 set. The indices are
-- assigned automatically; operators name entries, never pick numbers.
--
-- Old rows (single-digit version, two-digit category) cannot satisfy the new
-- checks and their codes no longer parse, so the config is cleared and re-seeded.

TRUNCATE lt_config_scan_actions, lt_config_scan_schemes;

ALTER TABLE lt_config_scan_schemes
  DROP CONSTRAINT IF EXISTS lt_config_scan_schemes_version_check;
ALTER TABLE lt_config_scan_schemes
  ADD CONSTRAINT lt_config_scan_schemes_version_check CHECK (version BETWEEN 10 AND 99);

ALTER TABLE lt_config_scan_actions
  DROP CONSTRAINT IF EXISTS lt_config_scan_actions_category_check;
ALTER TABLE lt_config_scan_actions
  ADD CONSTRAINT lt_config_scan_actions_category_check CHECK (category ~ '^[0-9]$');
