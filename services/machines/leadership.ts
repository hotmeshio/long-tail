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

export interface LeadershipOptions {
  /** A dedicated connection for the lock; the shared pool's by default. */
  connect?: () => Promise<PoolClient>;
  /** The pause before contending again. */
  retryMs?: number;
}

export class LineLeadership {
  private client?: PoolClient;
  private stopped = false;
  private leading = false;
  private readonly connect: () => Promise<PoolClient>;
  private readonly retryMs: number;

  constructor(readonly key: string, opts: LeadershipOptions = {}) {
    this.connect = opts.connect ?? (() => getPool().connect());
    this.retryMs = opts.retryMs ?? RETRY_MS;
  }

  /**
   * Wait for the lock, then call `lead`. When the connection is refused,
   * leading fails or the connection drops, the lock is released, `lost`
   * runs, and the line contends again after a pause.
   */
  async run(lead: () => Promise<void>, lost: (err: Error) => Promise<void>): Promise<void> {
    while (!this.stopped) {
      const err = await this.leadOnce(lead);
      if (this.stopped) return;
      await lost(err);
      await new Promise((r) => setTimeout(r, this.retryMs));
    }
  }

  private async leadOnce(lead: () => Promise<void>): Promise<Error> {
    let client: PoolClient;
    try {
      client = await this.connect();
    } catch (err) {
      return err as Error;
    }
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
