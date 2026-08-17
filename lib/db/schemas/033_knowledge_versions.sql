-- Migration 033: Versioned knowledge entries.
--
-- Every knowledge entry carries a current_version counter, and every write
-- that changes `data` snapshots the new edition into lt_knowledge_versions
-- (same pattern as lt_role_schemas). Snapshots are immutable: escalation
-- lookup refs pin {domain, key, version} and always resolve to the exact
-- edition the workflow was written against.
--
-- ON DELETE CASCADE is deliberate: a delete-then-recreate restarts the entry
-- at version 1, and stale snapshots must not misattribute the old entry's
-- data to the new lineage. A pinned ref to a deleted entry fails visible
-- (missing) rather than resolving to the wrong list.

CREATE TABLE IF NOT EXISTS lt_knowledge_versions (
  domain          TEXT NOT NULL,
  key             TEXT NOT NULL,
  version         INTEGER NOT NULL,
  data            JSONB NOT NULL DEFAULT '{}',
  tags            TEXT[] NOT NULL DEFAULT '{}',
  change_summary  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (domain, key, version),
  FOREIGN KEY (domain, key) REFERENCES lt_knowledge (domain, key) ON DELETE CASCADE
);

ALTER TABLE lt_knowledge
  ADD COLUMN IF NOT EXISTS current_version INTEGER NOT NULL DEFAULT 1;

-- Backfill: every existing entry becomes version 1 of its lineage.
INSERT INTO lt_knowledge_versions (domain, key, version, data, tags)
SELECT domain, key, current_version, data, tags
FROM lt_knowledge
ON CONFLICT (domain, key, version) DO NOTHING;
