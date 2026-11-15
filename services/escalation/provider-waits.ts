import type { PoolClient } from 'pg';

import { getPool } from '../../lib/db';
import { durableProviderRegistry } from '../durable-provider/registry';
import { WAIT_BY_SIGNAL_KEY } from '../durable-provider/sql';

/**
 * The escalation a Temporal or DBOS wait opened under `signalKey`, or null.
 * Those escalations carry no `signal_key` (the store would wake HotMesh for
 * it), so the signal-key surfaces resolve the key here, then act by id.
 * Under HotMesh no provider waits exist and nothing is queried.
 */
export async function providerEscalationIdFor(signalKey: string): Promise<string | null> {
  if (durableProviderRegistry.isNative || !signalKey) return null;
  const { rows } = await getPool().query(WAIT_BY_SIGNAL_KEY, [signalKey]);
  return rows[0]?.escalation_id ?? null;
}

const LOCK_SIGNAL_KEY = `SELECT pg_advisory_xact_lock(hashtextextended('lt:signal-key:' || $1, 0))`;

/**
 * Run `claim` while holding the lock for `signalKey`, inside a transaction on
 * `client`. Every Long Tail path that gives a key to a row claims under this
 * lock, so a wait and an escalation never both take the same key.
 */
export async function withSignalKeyLock<T>(signalKey: string, claim: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await client.query(LOCK_SIGNAL_KEY, [signalKey]);
    const claimed = await claim(client);
    await client.query('COMMIT');
    return claimed;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const PROVIDER_WAITS_AMONG = `
  SELECT escalation_id FROM lt_durable_waits WHERE escalation_id = ANY($1::uuid[])`;

/**
 * `ids` without the escalations a Temporal or DBOS workflow waits on. Whether
 * an escalation backs a wait is fixed when it is created, so filtering first
 * can't race the update that follows.
 */
export async function withoutProviderWaits(ids: string[]): Promise<string[]> {
  if (durableProviderRegistry.isNative || ids.length === 0) return ids;
  const { rows } = await getPool().query(PROVIDER_WAITS_AMONG, [ids]);
  const waits = new Set(rows.map((row) => row.escalation_id));
  return ids.filter((id) => !waits.has(id));
}
