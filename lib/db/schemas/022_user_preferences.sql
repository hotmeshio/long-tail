-- Migration 022: Per-user preferences + role default pins
--
-- lt_users.preferences is a generic per-user JSON store (pinned views are the
-- first tenant, not the schema): read via GET /api/me/preferences, written via
-- PATCH with shallow top-level merge (null deletes a key), size-capped at the
-- API layer. Preferences carry presentation state only — never data and never
-- authorization; read-scope enforcement stays with the queries a preference
-- may point at.
--
-- lt_roles.default_pins seeds a role's members with the persona's starting
-- pinned views ([{ label, url, badge? }]). Users promote, hide, or reorder
-- them through their own preferences.

ALTER TABLE lt_users
  ADD COLUMN IF NOT EXISTS preferences JSONB;

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS default_pins JSONB;
