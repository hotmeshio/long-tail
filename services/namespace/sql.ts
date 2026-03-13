// ─── Namespace queries ──────────────────────────────────────────────────────

export const LIST_NAMESPACES = `
  SELECT * FROM lt_namespaces
  ORDER BY is_default DESC, name ASC`;

export const GET_DEFAULT_NAMESPACE = `
  SELECT * FROM lt_namespaces
  WHERE is_default = true
  LIMIT 1`;

export const GET_NAMESPACE_BY_NAME = `
  SELECT * FROM lt_namespaces
  WHERE name = $1
  LIMIT 1`;

export const UPSERT_NAMESPACE = `
  INSERT INTO lt_namespaces (name, schema_name, description, metadata)
  VALUES ($1, $2, $3, $4)
  ON CONFLICT (name) DO UPDATE SET
    description = COALESCE(EXCLUDED.description, lt_namespaces.description),
    metadata = COALESCE(EXCLUDED.metadata, lt_namespaces.metadata),
    updated_at = NOW()
  RETURNING *`;
