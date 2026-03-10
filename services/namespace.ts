import { getPool } from './db';

export interface LTNamespace {
  id: string;
  name: string;
  description: string | null;
  schema_name: string;
  is_default: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
}

/**
 * List all registered namespaces, ordered by default-first then name.
 */
export async function listNamespaces(): Promise<LTNamespace[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM lt_namespaces ORDER BY is_default DESC, name ASC`,
  );
  return rows;
}

/**
 * Get the default namespace.
 */
export async function getDefaultNamespace(): Promise<LTNamespace | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM lt_namespaces WHERE is_default = true LIMIT 1`,
  );
  return rows[0] ?? null;
}

/**
 * Get a namespace by name.
 */
export async function getNamespace(name: string): Promise<LTNamespace | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM lt_namespaces WHERE name = $1 LIMIT 1`,
    [name],
  );
  return rows[0] ?? null;
}

/**
 * Register (upsert) a namespace. Used by YAML deployer to auto-register.
 */
export async function registerNamespace(
  name: string,
  description?: string,
  metadata?: Record<string, unknown>,
): Promise<LTNamespace> {
  const pool = getPool();
  const schemaName = name; // HotMesh appId === Postgres schema name
  const { rows } = await pool.query(
    `INSERT INTO lt_namespaces (name, schema_name, description, metadata)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (name) DO UPDATE SET
       description = COALESCE(EXCLUDED.description, lt_namespaces.description),
       metadata = COALESCE(EXCLUDED.metadata, lt_namespaces.metadata),
       updated_at = NOW()
     RETURNING *`,
    [name, schemaName, description ?? null, metadata ? JSON.stringify(metadata) : null],
  );
  return rows[0];
}
