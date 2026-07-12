import { Client, Pool } from 'pg';

import { postgres_options } from '../../modules/config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      ...postgres_options,
      // Long-tail's shared tables live in public. Postgres's default
      // search_path is `"$user", public`: if any schema shares the connecting
      // role's name (e.g. a HotMesh app schema named after the DB user), every
      // unqualified statement — including CREATE TABLE in migrations — silently
      // resolves there instead of public, forking the data across two schemas.
      // Pinning the session search_path makes resolution independent of role
      // and schema naming. HotMesh connections (getConnection) are unaffected:
      // the engine fully qualifies its app schemas.
      options: '-c search_path=public',
    });
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
