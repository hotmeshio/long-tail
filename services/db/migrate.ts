import * as fs from 'fs';
import * as path from 'path';

import { getPool, closePool } from './index';
import { loggerRegistry } from '../logger';

const SCHEMAS_DIR = path.join(__dirname, 'schemas');

export async function migrate(): Promise<void> {
  const pool = getPool();

  // ensure migration tracking table
  await pool.query(`
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
    const { rows } = await pool.query(
      'SELECT 1 FROM lt_migrations WHERE name = $1',
      [file],
    );

    if (rows.length === 0) {
      const sql = fs.readFileSync(path.join(SCHEMAS_DIR, file), 'utf-8');
      await pool.query(sql);
      await pool.query(
        'INSERT INTO lt_migrations (name) VALUES ($1)',
        [file],
      );
      loggerRegistry.info(`[migrate] applied: ${file}`);
    }
  }
}

// run directly: npx ts-node services/db/migrate.ts
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
