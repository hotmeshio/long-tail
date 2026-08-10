// ─── Domain dictionary queries ──────────────────────────────────────────────
// One row per deployment (lt_domain, id=1). Reads are whole-doc; writes are
// whole-doc with optimistic concurrency on `version`.

export const GET_DOMAIN = `
  SELECT doc, version, updated_at FROM lt_domain WHERE id = 1`;

/**
 * Upsert the dictionary in ONE statement. When the caller supplies an
 * expected version ($2 non-null), the update applies only if the stored
 * version matches — zero rows back means a concurrent writer won (409).
 * A null $2 is last-write-wins. Fresh inserts always succeed at version 1.
 */
export const UPSERT_DOMAIN = `
  INSERT INTO lt_domain (id, doc, version, updated_at)
  VALUES (1, $1::jsonb, 1, NOW())
  ON CONFLICT (id) DO UPDATE
    SET doc = EXCLUDED.doc,
        version = lt_domain.version + 1,
        updated_at = NOW()
    WHERE $2::int IS NULL OR lt_domain.version = $2::int
  RETURNING version`;

/** Seed: first writer wins; an existing row is left untouched. */
export const SEED_DOMAIN = `
  INSERT INTO lt_domain (id, doc, version, updated_at)
  VALUES (1, $1::jsonb, 1, NOW())
  ON CONFLICT (id) DO NOTHING
  RETURNING version`;
