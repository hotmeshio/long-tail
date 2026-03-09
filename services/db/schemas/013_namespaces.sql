-- Namespace registry for MCP YAML workflow isolation.
-- Each namespace maps to a HotMesh appId (and its own Postgres schema).
-- The default 'longtail' namespace is seeded automatically.

CREATE TABLE IF NOT EXISTS lt_namespaces (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  description TEXT,
  schema_name TEXT NOT NULL,
  is_default  BOOLEAN NOT NULL DEFAULT false,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO lt_namespaces (name, schema_name, is_default, description)
VALUES ('longtail', 'longtail', true, 'Default Long Tail namespace')
ON CONFLICT (name) DO NOTHING;
