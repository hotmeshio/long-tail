import { getPool } from '../../lib/db';
import {
  LIST_NAMESPACES,
  GET_DEFAULT_NAMESPACE,
  GET_NAMESPACE_BY_NAME,
  UPSERT_NAMESPACE,
} from './sql';
import type { LTNamespace } from './types';

/**
 * List all registered namespaces, ordered by default-first then name.
 */
export async function listNamespaces(): Promise<LTNamespace[]> {
  const pool = getPool();
  const { rows } = await pool.query(LIST_NAMESPACES);
  return rows;
}

/**
 * Get the default namespace.
 */
export async function getDefaultNamespace(): Promise<LTNamespace | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_DEFAULT_NAMESPACE);
  return rows[0] ?? null;
}

/**
 * Get a namespace by name.
 */
export async function getNamespace(name: string): Promise<LTNamespace | null> {
  const pool = getPool();
  const { rows } = await pool.query(GET_NAMESPACE_BY_NAME, [name]);
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
    UPSERT_NAMESPACE,
    [name, schemaName, description ?? null, metadata ? JSON.stringify(metadata) : null],
  );
  return rows[0];
}
