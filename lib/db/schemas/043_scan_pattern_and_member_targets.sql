-- Migration 043: pattern scan schemes and list-valued target facets
--
-- encoding 'pattern': a scheme whose codes carry no scheme or category, such
-- as a carrier tracking number. A code matching one of `patterns` (regular
-- expressions over the whole code) parses with the code as the target, and
-- the scheme's single rule is category '0'. `precedes_gtin` declares which
-- reads a digits-only code first while an enabled gtin scheme exists: true,
-- the patterns; false, the gtin scheme. Beside an enabled gtin scheme the
-- declaration is required.
--
-- target_match:
--   'value'   the target facet holds one value equal to the target.
--   'member'  the target facet holds a list; a row matches when the list
--             contains the target (metadata @> {facet: [target]}).

ALTER TABLE lt_config_scan_schemes
  DROP CONSTRAINT IF EXISTS lt_config_scan_schemes_encoding_check;
ALTER TABLE lt_config_scan_schemes
  ADD CONSTRAINT lt_config_scan_schemes_encoding_check
    CHECK (encoding IN ('fixed', 'delimited', 'gtin', 'pattern'));

ALTER TABLE lt_config_scan_schemes
  ADD COLUMN IF NOT EXISTS patterns JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS precedes_gtin BOOLEAN,
  ADD COLUMN IF NOT EXISTS target_match TEXT NOT NULL DEFAULT 'value'
    CHECK (target_match IN ('value', 'member'));
