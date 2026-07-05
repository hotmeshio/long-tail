-- Migration 018: Role upstream inputs
--
-- Execution is a graph; the Operations page tells its story as sequences.
-- lt_roles.parent_role stays the sequence membership — the single "prior
-- step" that places a station in one line. lt_role_upstreams carries the
-- other edges: the roles a station draws input from that live in OTHER
-- sequences (mixin-like, many allowed). The Operations chart renders these
-- as a merge affordance on the station rather than bending the line —
-- the table stays true to the queue, the SVG stays honest about the graph.
--
-- Example: a shoe side-quest (ordering → inserting) feeds shipping. ordering
-- roots its own sequence; shipping declares inserting as an upstream input
-- instead of pretending ordering descends from qa.

CREATE TABLE IF NOT EXISTS lt_role_upstreams (
  role          TEXT NOT NULL REFERENCES lt_roles(role) ON DELETE CASCADE,
  upstream_role TEXT NOT NULL REFERENCES lt_roles(role) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (role, upstream_role),
  CHECK (role <> upstream_role)
);
