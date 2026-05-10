// ─── Knowledge CRUD ─────────────────────────────────────────────────────────

// Upsert knowledge entry. On conflict (domain+key), merges JSONB data at
// the top level — new keys are added, existing keys are overwritten.
//
// Guard: if the existing `data` column is not a JSON object (e.g. it was
// corrupted into an array by a prior string merge), replace it entirely
// rather than appending to the array. The CASE expression ensures the
// `||` operator always receives object || object, which produces a merge.
export const UPSERT_KNOWLEDGE = `
  INSERT INTO lt_knowledge (domain, key, data, tags)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (domain, key) DO UPDATE SET
    data = CASE
      WHEN jsonb_typeof(lt_knowledge.data) = 'object'
      THEN lt_knowledge.data || EXCLUDED.data
      ELSE EXCLUDED.data
    END,
    tags = ARRAY(SELECT DISTINCT unnest(lt_knowledge.tags || EXCLUDED.tags))
  RETURNING id, domain, key, (xmax = 0) AS created, updated_at`;

// Full replacement — overwrites the data column entirely (no merge).
// Used when removing fields from the JSONB object.
export const REPLACE_KNOWLEDGE = `
  INSERT INTO lt_knowledge (domain, key, data, tags)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (domain, key) DO UPDATE SET
    data = EXCLUDED.data,
    tags = ARRAY(SELECT DISTINCT unnest(lt_knowledge.tags || EXCLUDED.tags))
  RETURNING id, domain, key, (xmax = 0) AS created, updated_at`;

export const GET_KNOWLEDGE = `
  SELECT id, domain, key, data, tags, created_at, updated_at
  FROM lt_knowledge WHERE domain = $1 AND key = $2`;

export const SEARCH_KNOWLEDGE = `
  SELECT id, domain, key, data, tags, created_at, updated_at
  FROM lt_knowledge
  WHERE domain = $1 AND data @> $2::jsonb`;

export const COUNT_KNOWLEDGE_SEARCH = `
  SELECT COUNT(*)::int AS total FROM lt_knowledge
  WHERE domain = $1 AND data @> $2::jsonb`;

export const LIST_KNOWLEDGE = `
  SELECT id, domain, key, data, tags, created_at, updated_at
  FROM lt_knowledge WHERE domain = $1`;

export const COUNT_KNOWLEDGE_LIST = `
  SELECT COUNT(*)::int AS total FROM lt_knowledge WHERE domain = $1`;

export const DELETE_KNOWLEDGE = `
  DELETE FROM lt_knowledge WHERE domain = $1 AND key = $2`;

export const LIST_DOMAINS = `
  SELECT domain, COUNT(*)::int AS count, MAX(updated_at) AS latest
  FROM lt_knowledge GROUP BY domain ORDER BY latest DESC`;

export const APPEND_KNOWLEDGE = `
  INSERT INTO lt_knowledge (domain, key, data)
  VALUES ($1, $2, $3::jsonb)
  ON CONFLICT (domain, key) DO UPDATE SET
    data = CASE
      WHEN lt_knowledge.data #> $4::text[] IS NULL
      THEN jsonb_set(lt_knowledge.data, $4::text[], jsonb_build_array($5::jsonb))
      ELSE jsonb_set(lt_knowledge.data, $4::text[], (lt_knowledge.data #> $4::text[]) || jsonb_build_array($5::jsonb))
    END
  RETURNING id, domain, key, updated_at`;
