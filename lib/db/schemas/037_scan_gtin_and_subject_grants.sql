-- Migration 037: GTIN scan schemes and subject-bound acting grants
--
-- encoding 'gtin': a scheme whose codes are manufacturer barcodes (UPC-A,
-- EAN-13, EAN-8, GTIN-14). The code carries no scheme or category; the
-- check digit identifies it, and the scheme's single rule is category '0'.
--
-- grant_scope (identity kind only):
--   'action'  each mutating act spends one use of the grant.
--   'subject' the first act binds the grant to the held subject (the item
--             the station is holding); further acts on that same subject do
--             not count, and the grant cannot act on any other subject.
--
-- lt_ephemeral_credentials.bind_on_use / bound_ref carry that binding.

ALTER TABLE lt_config_scan_schemes
  DROP CONSTRAINT IF EXISTS lt_config_scan_schemes_encoding_check;
ALTER TABLE lt_config_scan_schemes
  ADD CONSTRAINT lt_config_scan_schemes_encoding_check
    CHECK (encoding IN ('fixed', 'delimited', 'gtin'));

ALTER TABLE lt_config_scan_schemes
  ADD COLUMN IF NOT EXISTS grant_scope TEXT NOT NULL DEFAULT 'action'
    CHECK (grant_scope IN ('action', 'subject'));

ALTER TABLE lt_ephemeral_credentials
  ADD COLUMN IF NOT EXISTS bind_on_use BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS bound_ref TEXT;
