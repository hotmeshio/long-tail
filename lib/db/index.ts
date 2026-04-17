import { Client, Pool } from 'pg';

import { postgres_options } from '../../modules/config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool(postgres_options);
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * HotMesh connection descriptor: `{ class: Client, options: postgres_options }`.
 * Use this everywhere HotMesh / Durable APIs need a connection config
 * instead of importing `pg` and `postgres_options` directly.
 */
export function getConnection() {
  return { class: Client, options: postgres_options };
}
