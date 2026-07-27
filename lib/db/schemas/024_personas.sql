-- Migration 024: Personas — named role bundles with per-role relationship scope
--
-- A persona is a suggestion, the same way a default pin is: shorthand for "add
-- this user to these roles with these scoped privileges." Assigning a persona
-- fans out to ordinary lt_user_roles memberships (one per linked role, mapped
-- from the persona's relationship onto the read/write scope lattice), so
-- lt_user_roles remains the single source of authorization truth — no second
-- ACL path, no hot-path changes.
--
-- lt_personas          — the bundle: stable key, display title, description.
-- lt_persona_roles     — the bundle's role links; relationship maps onto the
--                        membership scope lattice: write-all → (all, all),
--                        write-self → (all, self), read-all → (all, none).
-- lt_user_personas     — who holds which persona (the auditable "why").
-- lt_user_roles.granted_by_persona — provenance: NULL means the membership was
--                        granted directly; non-NULL names the persona currently
--                        sustaining the row. Unassigning a persona removes only
--                        rows it sustains (re-homing rows another held persona
--                        still grants); direct grants are never touched, and a
--                        direct grant on a persona-sustained role takes the row
--                        over (provenance flips to NULL).

CREATE TABLE IF NOT EXISTS lt_personas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key           TEXT NOT NULL UNIQUE,
  title         TEXT,
  description   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS lt_persona_roles (
  persona_id    UUID NOT NULL REFERENCES lt_personas(id) ON DELETE CASCADE,
  role          TEXT NOT NULL REFERENCES lt_roles(role) ON DELETE CASCADE,
  relationship  TEXT NOT NULL CHECK (relationship IN ('write-all', 'write-self', 'read-all')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (persona_id, role)
);

CREATE TABLE IF NOT EXISTS lt_user_personas (
  user_id       UUID NOT NULL REFERENCES lt_users(id) ON DELETE CASCADE,
  persona_id    UUID NOT NULL REFERENCES lt_personas(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, persona_id)
);

ALTER TABLE lt_user_roles
  ADD COLUMN IF NOT EXISTS granted_by_persona UUID REFERENCES lt_personas(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lt_persona_roles_role ON lt_persona_roles (role);
CREATE INDEX IF NOT EXISTS idx_lt_user_personas_persona ON lt_user_personas (persona_id);
CREATE INDEX IF NOT EXISTS idx_lt_user_roles_granted_by_persona
  ON lt_user_roles (granted_by_persona) WHERE granted_by_persona IS NOT NULL;
