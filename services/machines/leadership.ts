/**
 * One gateway per line across every replica. Each line contends for a
 * Postgres advisory lock on a dedicated connection; `pg_advisory_lock`
 * waits on the server, so standby replicas hold no timers and the next one
 * takes over the moment the leader's session ends.
 */

import type { PoolClient } from 'pg';

import { getPool } from '../../lib/db';

const LOCK_SQL = 'SELECT pg_advisory_lock(hashtext($1))';
const RETRY_MS = 5_000;
const UNLOCK_SQL = 'SELECT pg_advisory_unlock(hashtext($1))';

export class LineLeadership {
  private client?: PoolClient;
  private stopped = false;
  private leading = false;

  constructor(readonly key: string) {}

  /**
   * Wait for the lock, then call `lead`. When leading fails or the
   * connection drops, the lock is released, `lost` runs, and the line
   * contends again after a pause.
   */
  async run(lead: () => Promise<void>, lost: (err: Error) => Promise<void>): Promise<void> {
    while (!this.stopped) {
      const err = await this.leadOnce(lead);
      if (this.stopped) return;
      await lost(err);
      await new Promise((r) => setTimeout(r, RETRY_MS));
    }
  }

  private async leadOnce(lead: () => Promise<void>): Promise<Error> {
    const client = await getPool().connect();
    this.client = client;
    const dropped = new Promise<Error>((resolve) => client.once('error', resolve));
    try {
      await client.query(LOCK_SQL, [this.key]);
      this.leading = true;
      await lead();
      return await dropped;
    } catch (err) {
      return err as Error;
    } finally {
      this.leading = false;
      if (!this.stopped) {
        this.client = undefined;
        client.release(true);
      }
    }
  }

  /** A leader unlocks; a replica still waiting drops its connection, which ends the wait. */
  async stop(): Promise<void> {
    this.stopped = true;
    const client = this.client;
    this.client = undefined;
    if (!client) return;
    if (!this.leading) {
      client.release(true);
      return;
    }
    try {
      await client.query(UNLOCK_SQL, [this.key]);
      client.release();
    } catch {
      client.release(true);
    }
  }
}
