import { Client, Pool, type ClientConfig } from 'pg';

import { postgres_options } from '../../modules/config';
import { loggerRegistry } from '../logger';

/** A new connection that cannot be established within this window fails instead of hanging. */
const CONNECT_TIMEOUT_MS = 10_000;

let pool: Pool | null = null;

/** A lost socket fails the pending query; its 'error' event must never end the process. */
function onConnectionError(error: Error): void {
  loggerRegistry.debug(`[lt-db] connection error: ${error.message}`);
}

function onIdleConnectionLost(error: Error): void {
  loggerRegistry.warn(`[lt-db] pooled connection lost: ${error.message}`);
}

/** `pg.Client` that carries an 'error' listener from construction. */
class GuardedClient extends Client {
  constructor(config?: string | ClientConfig) {
    super(config);
    this.on('error', onConnectionError);
  }
}

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
      keepAlive: true,
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
    pool.on('error', onIdleConnectionLost);
    // pg-pool drops its own listener while a client is checked out
    pool.on('connect', (client) => client.on('error', onConnectionError));
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
 * HotMesh connection descriptor: `{ class: GuardedClient, options: postgres_options }`.
 * Use this everywhere HotMesh / Durable APIs need a connection config
 * instead of importing `pg` and `postgres_options` directly.
 */
export function getConnection() {
  return { class: GuardedClient, options: postgres_options };
}
