-- Migration 036: Role portals
--
-- portals is a role-owned list of named portal views. Each portal is a matrix
-- of pins: rows of cells, each cell a pinned view ({ label, url, badge? }).
-- The dashboard renders a portal as one page of live list panels at
-- /portal/:role/:portal, the visual form of the role's pinned views: one
-- portal for urgent items by facility, another for the team's focus of the
-- day, each cell named for a person and scoped to their facets. Unversioned
-- config, like default_pins; null means the role declares no portal.

ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS portals JSONB;
