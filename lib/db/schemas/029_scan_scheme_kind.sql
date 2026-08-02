-- Scheme kind — what a code under this scheme IS:
--   'action'   the shipped ECA model: the target resolves against escalations
--              (scheme.target_facet names the escalation metadata key) and the
--              rule's steps run.
--   'identity' a badge: the target resolves against USERS (scheme.target_facet
--              names the lt_users.metadata key it matches, e.g. badge_id) and a
--              match mints a short-lived acting-identity grant through the
--              ephemeral keystore. Identity schemes never walk steps; the
--              rule's fallback is the unknown-badge screen.
--
-- Grant policy (identity kind only): grant_ttl_seconds bounds the elevation
-- window; grant_max_uses = 0 means TTL-bound (unlimited exchanges within the
-- window), 1 expresses a strict one-scan-one-grant policy (each scan request
-- consumes the grant), n > 1 an n-request budget.
ALTER TABLE lt_config_scan_schemes
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'action'
    CHECK (kind IN ('action', 'identity')),
  ADD COLUMN IF NOT EXISTS grant_ttl_seconds INT,
  ADD COLUMN IF NOT EXISTS grant_max_uses INT NOT NULL DEFAULT 0;

ALTER TABLE lt_config_scan_schemes
  ADD CONSTRAINT chk_scan_scheme_identity_grant
    CHECK (kind <> 'identity'
      OR (grant_ttl_seconds BETWEEN 1 AND 86400 AND grant_max_uses >= 0));

-- The rule-configured "scan your badge" screen: rendered when a step (or a
-- presented choice) requires an acting identity and the request carries none
-- the effective actor can satisfy. Mirrors `fallback` exactly — same shape
-- ({ markdown, route }), different moment.
ALTER TABLE lt_config_scan_actions
  ADD COLUMN IF NOT EXISTS not_primed JSONB NOT NULL DEFAULT '{}';
