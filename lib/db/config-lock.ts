import { getPool } from './index';

/**
 * Serializes multi-statement config writes (role-list replaces, escalation
 * target replaces, line declarations) across concurrently booting containers
 * and live API writes. Single-statement upserts are individually race-safe;
 * the lock exists for the replace transactions and keeps boot reports
 * coherent. Distinct from the migration lock so a slow migration on one
 * container never blocks another's config pass behind two locks at once.
 */
export const CONFIG_APPLY_LOCK_ID = 8675310;

export async function withConfigLock<T>(fn: () => Promise<T>): Promise<T> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query(`SELECT pg_advisory_lock(${CONFIG_APPLY_LOCK_ID})`);
    return await fn();
  } finally {
    await client
      .query(`SELECT pg_advisory_unlock(${CONFIG_APPLY_LOCK_ID})`)
      .catch(() => { /* connection lost; the lock died with the session */ });
    client.release();
  }
}
