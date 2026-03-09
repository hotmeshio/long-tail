/**
 * Vitest setupFile — runs before each test file (in its fork).
 *
 * Clears stale HotMesh scout roles from the `durable.roles` table
 * so no leftover TTL from a prior test file blocks scout acquisition.
 */

import { Client } from 'pg';
import { beforeAll } from 'vitest';

const SCHEMA = 'durable';

beforeAll(async () => {
  const client = new Client({
    host: process.env.POSTGRES_HOST || 'localhost',
    port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
    user: process.env.POSTGRES_USER || 'postgres',
    password: process.env.POSTGRES_PASSWORD || 'password',
    database: 'longtail_test',
  });

  try {
    await client.connect();
    await client.query(
      `DELETE FROM "${SCHEMA}".roles WHERE key LIKE $1`,
      [`hmsh:${SCHEMA}:w:%`],
    );
  } catch {
    // Schema/table may not exist — fine on first run
  } finally {
    await client.end();
  }
});
