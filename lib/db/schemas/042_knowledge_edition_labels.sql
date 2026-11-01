-- An edition may carry a label: a name a lookup ref pins instead of the
-- version number (a catalog revision, say). A label names one edition of an
-- entry; editions without one are reached by number or as current.
ALTER TABLE lt_knowledge_versions
  ADD COLUMN IF NOT EXISTS label TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS lt_knowledge_versions_label_idx
  ON lt_knowledge_versions (domain, key, label)
  WHERE label IS NOT NULL;
