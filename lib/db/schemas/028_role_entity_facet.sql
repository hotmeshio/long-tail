-- entity_facet — the lt_escalations.metadata key identifying the ENTITY that
-- moves through this role (e.g. serialNumber, orderId). A role's escalations
-- are the intervals that entity spends in the role's state, so declaring the
-- key powers the derived surfaces: distinct-entity counts on the Pace Board,
-- per-entity dwell in the station panel, entity timelines, and the entity
-- lens. Roles sharing an entity_facet form that entity's SYSTEM. FACET_KEY-
-- validated at the API (letters, digits, underscore). NULL = the role has no
-- entity notion; the surfaces simply don't render.
--
-- entity_state_source — how this role names its contribution to the entity's
-- state space: 'role' (the station itself is the state — one state per role,
-- e.g. a harvesting or servicing queue) or 'subtype' (the role's subtypes are
-- its states — one role holding several, e.g. a fleet role whose escalations
-- park as ready/printing). Only meaningful while entity_facet is set.
ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS entity_facet TEXT;
ALTER TABLE lt_roles
  ADD COLUMN IF NOT EXISTS entity_state_source TEXT NOT NULL DEFAULT 'role';
