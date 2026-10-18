-- Migration 040: when a person last consented to a grant for an OAuth client
--
-- Registration needs no sign-in, so a client that never reaches consent is
-- deleted after the retention window. A client someone has consented to is
-- kept, so the app can always reconnect with the client id it holds.

ALTER TABLE lt_oauth_clients ADD COLUMN IF NOT EXISTS last_consent_at TIMESTAMPTZ;

-- Clients consented to before this migration: their newest grant.
UPDATE lt_oauth_clients c
SET last_consent_at = g.created_at
FROM (
  SELECT client_id, MAX(created_at) AS created_at FROM lt_oauth_grants GROUP BY client_id
) g
WHERE c.client_id = g.client_id AND c.last_consent_at IS NULL;
