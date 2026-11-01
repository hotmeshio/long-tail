-- Migration 041: The machine line registry
--
-- One row per line a deployment controls: the line definition as the
-- gateway reads it (site, line, machines in route order), who declared it,
-- and a version that advances on every change. Lines declared in code
-- (start({ machines })) are applied here at boot under the configSource
-- rules; lines declared through PUT /api/machines/lines live here alone.
-- Every replica reads the registry to know which lines to contend for, and
-- the Lines index reads it with the pending rows that say how each line is.
-- search_text is the service's lowercase projection of site, line, machine
-- ids, processes, roles and addresses, for the index's search.

CREATE TABLE IF NOT EXISTS lt_machine_lines (
  site_id     TEXT NOT NULL,
  line_id     TEXT NOT NULL,
  definition  JSONB NOT NULL,
  source      TEXT NOT NULL CHECK (source IN ('code', 'api')),
  version     INT NOT NULL DEFAULT 1,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  search_text TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (site_id, line_id)
);

CREATE INDEX IF NOT EXISTS lt_machine_lines_site_idx ON lt_machine_lines (site_id, line_id);
