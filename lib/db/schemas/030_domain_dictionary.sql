-- Migration 030: The domain dictionary
--
-- One row per deployment: the ontology that maps the operation's jargon
-- ("printer", "reset", "kill the order") onto platform primitives (roles,
-- queues, workflows, escalations, metadata facets). The doc holds only the
-- SEMANTIC overlay the live registries can't express — terms, guidance,
-- runbooks; structural facts (an entity's id facet, a role's title) are
-- derived from lt_roles / lt_config_workflows at read time.
--
-- Seeded insert-if-absent from startConfig.mcp.domainDictionaryPath; edited
-- live via PUT /api/domain. `version` backs optimistic concurrency on writes.

CREATE TABLE IF NOT EXISTS lt_domain (
  id         INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  doc        JSONB NOT NULL,
  version    INT NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
