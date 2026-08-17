// ─── Knowledge CRUD ─────────────────────────────────────────────────────────
//
// Every write statement is a single CTE pipeline: the write computes the new
// data, bumps current_version ONLY when the data actually changes
// (IS DISTINCT FROM guard), and snapshots the new edition into
// lt_knowledge_versions in the same statement (ON CONFLICT DO NOTHING makes
// no-op writes snapshot-free). Tags-only changes never bump — the version is
// the data's identity.

// Upsert knowledge entry. On conflict (domain+key), merges JSONB data at
// the top level — new keys are added, existing keys are overwritten.
//
// Guard: if the existing `data` column is not a JSON object (e.g. it was
// corrupted into an array by a prior string merge), replace it entirely
// rather than appending to the array. The CASE expression ensures the
// `||` operator always receives object || object, which produces a merge.
export const UPSERT_KNOWLEDGE = `
  WITH upserted AS (
    INSERT INTO lt_knowledge (domain, key, data, tags)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (domain, key) DO UPDATE SET
      data = CASE
        WHEN jsonb_typeof(lt_knowledge.data) = 'object'
        THEN lt_knowledge.data || EXCLUDED.data
        ELSE EXCLUDED.data
      END,
      tags = ARRAY(SELECT DISTINCT unnest(lt_knowledge.tags || EXCLUDED.tags)),
      current_version = CASE
        WHEN (CASE
          WHEN jsonb_typeof(lt_knowledge.data) = 'object'
          THEN lt_knowledge.data || EXCLUDED.data
          ELSE EXCLUDED.data
        END) IS DISTINCT FROM lt_knowledge.data
        THEN lt_knowledge.current_version + 1
        ELSE lt_knowledge.current_version
      END
    RETURNING id, domain, key, data, tags, current_version, (xmax = 0) AS created, updated_at
  ), snapshot AS (
    INSERT INTO lt_knowledge_versions (domain, key, version, data, tags)
    SELECT domain, key, current_version, data, tags FROM upserted
    ON CONFLICT (domain, key, version) DO NOTHING
  )
  SELECT id, domain, key, current_version, created, updated_at FROM upserted`;

// Full replacement — overwrites data and tags entirely (no merge).
// Used when removing fields or tags.
export const REPLACE_KNOWLEDGE = `
  WITH upserted AS (
    INSERT INTO lt_knowledge (domain, key, data, tags)
    VALUES ($1, $2, $3, $4)
    ON CONFLICT (domain, key) DO UPDATE SET
      data = EXCLUDED.data,
      tags = EXCLUDED.tags,
      current_version = CASE
        WHEN EXCLUDED.data IS DISTINCT FROM lt_knowledge.data
        THEN lt_knowledge.current_version + 1
        ELSE lt_knowledge.current_version
      END
    RETURNING id, domain, key, data, tags, current_version, (xmax = 0) AS created, updated_at
  ), snapshot AS (
    INSERT INTO lt_knowledge_versions (domain, key, version, data, tags)
    SELECT domain, key, current_version, data, tags FROM upserted
    ON CONFLICT (domain, key, version) DO NOTHING
  )
  SELECT id, domain, key, current_version, created, updated_at FROM upserted`;

export const GET_KNOWLEDGE = `
  SELECT id, domain, key, data, tags, current_version, created_at, updated_at
  FROM lt_knowledge WHERE domain = $1 AND key = $2`;

export const DELETE_KNOWLEDGE = `
  DELETE FROM lt_knowledge WHERE domain = $1 AND key = $2`;

export const LIST_DOMAINS = `
  SELECT domain, COUNT(*)::int AS count, MAX(updated_at) AS latest
  FROM lt_knowledge GROUP BY domain ORDER BY latest DESC`;

// Set a value at a specific JSONB path without clobbering siblings.
// Creates the entry if it doesn't exist. Uses jsonb_set for surgical updates.
export const SET_KNOWLEDGE_FIELD = `
  WITH upserted AS (
    INSERT INTO lt_knowledge (domain, key, data, tags)
    VALUES ($1, $2, $3::jsonb, $4)
    ON CONFLICT (domain, key) DO UPDATE SET
      data = jsonb_set(lt_knowledge.data, $5::text[], $6::jsonb, true),
      tags = ARRAY(SELECT DISTINCT unnest(lt_knowledge.tags || EXCLUDED.tags)),
      current_version = CASE
        WHEN jsonb_set(lt_knowledge.data, $5::text[], $6::jsonb, true) IS DISTINCT FROM lt_knowledge.data
        THEN lt_knowledge.current_version + 1
        ELSE lt_knowledge.current_version
      END
    RETURNING id, domain, key, data, tags, current_version, (xmax = 0) AS created, updated_at
  ), snapshot AS (
    INSERT INTO lt_knowledge_versions (domain, key, version, data, tags)
    SELECT domain, key, current_version, data, tags FROM upserted
    ON CONFLICT (domain, key, version) DO NOTHING
  )
  SELECT id, domain, key, current_version, created, updated_at FROM upserted`;

// Remove a field at a specific JSONB path. Entry survives; only the targeted path is removed.
export const REMOVE_KNOWLEDGE_FIELD = `
  WITH updated AS (
    UPDATE lt_knowledge
    SET data = data #- $3::text[],
        current_version = CASE
          WHEN data #- $3::text[] IS DISTINCT FROM data
          THEN current_version + 1
          ELSE current_version
        END
    WHERE domain = $1 AND key = $2
    RETURNING id, domain, key, data, tags, current_version, updated_at
  ), snapshot AS (
    INSERT INTO lt_knowledge_versions (domain, key, version, data, tags)
    SELECT domain, key, current_version, data, tags FROM updated
    ON CONFLICT (domain, key, version) DO NOTHING
  )
  SELECT id, domain, key, current_version, updated_at FROM updated`;

// Append always grows the target array, so the conflict arm always bumps.
export const APPEND_KNOWLEDGE = `
  WITH upserted AS (
    INSERT INTO lt_knowledge (domain, key, data)
    VALUES ($1, $2, $3::jsonb)
    ON CONFLICT (domain, key) DO UPDATE SET
      data = CASE
        WHEN lt_knowledge.data #> $4::text[] IS NULL
        THEN jsonb_set(lt_knowledge.data, $4::text[], jsonb_build_array($5::jsonb))
        ELSE jsonb_set(lt_knowledge.data, $4::text[], (lt_knowledge.data #> $4::text[]) || jsonb_build_array($5::jsonb))
      END,
      current_version = lt_knowledge.current_version + 1
    RETURNING id, domain, key, data, tags, current_version, updated_at
  ), snapshot AS (
    INSERT INTO lt_knowledge_versions (domain, key, version, data, tags)
    SELECT domain, key, current_version, data, tags FROM upserted
    ON CONFLICT (domain, key, version) DO NOTHING
  )
  SELECT id, domain, key, current_version, updated_at FROM upserted`;
