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
  private endTurn?: () => void;
  private readonly connect: () => Promise<PoolClient>;
  private readonly retryMs: number;

  constructor(readonly key: string, opts: LeadershipOptions = {}) {
    this.connect = opts.connect ?? (() => getPool().connect());
    this.retryMs = opts.retryMs ?? RETRY_MS;
  }

  /**
   * Wait for the lock, then call `lead`. When the connection is refused,
   * leading fails or the connection drops, `lost` runs before this replica lets
   * the lock go, so no other replica leads alongside a gateway that is
   * stopping; then the line contends again after a pause.
   */
  async run(lead: () => Promise<void>, lost: (err: Error) => Promise<void>): Promise<void> {
    while (!this.stopped) {
      await this.leadOnce(lead, lost);
      if (this.stopped) return;
      await new Promise((r) => setTimeout(r, this.retryMs));
    }
  }

  private async leadOnce(lead: () => Promise<void>, lost: (err: Error) => Promise<void>): Promise<void> {
    let client: PoolClient;
    try {
      client = await this.connect();
    } catch (err) {
      if (!this.stopped) await lost(err as Error);
      return;
    }
    if (this.stopped) {
      client.release(true);
      return;
    }
    this.client = client;
    const err = await this.holdLock(client, lead);
    this.leading = false;
    this.endTurn = undefined;
    // stop() has let the connection go.
    if (this.stopped) return;
    await lost(err);
    this.client = undefined;
    client.release(true);
  }

  /** Lead while the lock is held; the error that ended it. */
  private async holdLock(client: PoolClient, lead: () => Promise<void>): Promise<Error> {
    const ended = new Promise<Error>((resolve) => {
      client.once('error', resolve);
      this.endTurn = () => resolve(new Error('leadership stopped'));
    });
    try {
      await client.query(LOCK_SQL, [this.key]);
      if (this.stopped) return new Error('leadership stopped');
      this.leading = true;
      await lead();
      return await ended;
    } catch (err) {
      return err as Error;
    }
  }

  /** A leader unlocks; a replica still waiting drops its connection, which ends the wait. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.endTurn?.();
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
