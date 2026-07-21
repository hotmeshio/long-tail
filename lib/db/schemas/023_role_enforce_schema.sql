-- Migration 023: Role-level resolver schema enforcement
--
-- enforce_schema makes the role's form_schema an enforced API contract: every
-- resolve surface (by id, by signal key, by ids, all-or-none, by metadata, and
-- the MCP resolve tools) validates the submitted resolverPayload against the
-- escalation's resolved form schema (metadata.form_schema override, else the
-- pinned lt_role_schemas snapshot, else the role's latest) and rejects
-- violations with 422 before any state changes. The validation pass is the
-- same isomorphic code the dashboard runs pre-submission, so a payload that
-- passes the client panel passes the gate and a 422 carries the identical
-- field-error list.
--
-- Opt-in per role (default false) so surfaces migrate deliberately: flip it on
-- a role once its submitters (dashboard, sim workforce, webhooks) are known to
-- send complete payloads. Roles with it off resolve exactly as before.

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS enforce_schema BOOLEAN NOT NULL DEFAULT false;
