import * as fs from 'fs';
import * as path from 'path';

import { getPool, closePool } from './index';
import { loggerRegistry } from '../logger';

// Both dev (lib/db/) and build (build/lib/db/) have schemas/ as a sibling.
// In dev it exists naturally; in build it's copied by the build script.
const SCHEMAS_DIR = path.join(__dirname, 'schemas');

export async function migrate(): Promise<void> {
  const pool = getPool();

  // Advisory lock prevents concurrent containers from racing on migrations.
  // Uses a dedicated client so the lock is held for the entire sequence.
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(8675309)');

    // ensure migration tracking table
    await client.query(`
      CREATE TABLE IF NOT EXISTS lt_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // find and sort migration files
    const files = fs.readdirSync(SCHEMAS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM lt_migrations WHERE name = $1',
        [file],
      );

      if (rows.length === 0) {
        const sql = fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf-8');
        await client.query(sql);
        await client.query(
          'INSERT INTO lt_migrations (name) VALUES ($1)',
          [file],
        );
        loggerRegistry.info(`[migrate] applied: ${file}`);
      }
    }
  } finally {
    // Advisory lock released when client is released (session-scoped),
    // but release explicitly for clarity
    await client.query('SELECT pg_advisory_unlock(8675309)').catch(() => {});
    client.release();
  }
}

// run directly: npx ts-node lib/db/migrate.ts
if (require.main === module) {
  require('dotenv').config();
  migrate()
    .then(() => {
      loggerRegistry.info('[migrate] done');
      return closePool();
    })
    .catch((err) => {
      loggerRegistry.error(`[migrate] failed: ${err}`);
      process.exit(1);
    });
}
