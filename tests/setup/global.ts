/**
 * Vitest globalSetup — runs once before the entire test suite.
 *
 * Clears stale HotMesh scout roles from the `{schema}.roles` table.
 * Without this, a role left behind by a crashed or timed-out test
 * process blocks the next scout from acquiring the role until the
 * TTL expires (default 60s), causing tests to appear "stuck".
 */

import { Client } from 'pg';

const SCHEMA = 'durable';

export async function setup() {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'password',
    database: 'longtail_test',
  });

  try {
    await client.connect();

    // Clear all scout roles so no stale TTL blocks acquisition
    await client.query(
      `DELETE FROM "${SCHEMA}".roles WHERE key LIKE $1`,
      [`hmsh:${SCHEMA}:w:%`],
    );
  } catch (err: any) {
    // Schema/table may not exist on first run — that's fine
    if (!err.message?.includes('does not exist')) {
      console.warn('[test-global-setup] Failed to clear scout roles:', err.message);
    }
  } finally {
    await client.end();
  }
}
