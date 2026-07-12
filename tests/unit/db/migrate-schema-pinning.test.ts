import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { getPool } from '../../../lib/db';
import { migrate } from '../../../lib/db/migrate';

// ─────────────────────────────────────────────────────────────────────────────
// Schema pinning and split-brain detection
//
// Long-tail's shared tables live in public. Postgres's default search_path is
// `"$user", public`: when any schema shares the connecting role's name (e.g. a
// HotMesh app schema named after the DB user), unqualified statements resolve
// there instead of public — migrations silently fork the tables into two
// schemas. The contract:
//
//   - every pool session resolves unqualified names to public (pinned)
//   - migrate() refuses to run when lt_migrations exists in any other schema:
//     a pre-existing fork must be consolidated by an operator, never booted
//     through
// ─────────────────────────────────────────────────────────────────────────────

const SHADOW_SCHEMA = 'migrate_split_sim';

describe('db — schema pinning and split detection', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await getPool().query(`DROP SCHEMA IF EXISTS ${SHADOW_SCHEMA} CASCADE`);
  });

  it('pool sessions pin search_path to public', async () => {
    const { rows } = await getPool().query('SHOW search_path');
    expect(rows[0].search_path).toBe('public');
  });

  it('unqualified names resolve to public even when a shadow schema exists', async () => {
    const pool = getPool();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SHADOW_SCHEMA}`);
    await pool.query(`CREATE TABLE IF NOT EXISTS ${SHADOW_SCHEMA}.lt_roles (role TEXT PRIMARY KEY)`);
    // Unqualified read must hit public.lt_roles (migrated, full shape), not the
    // decoy — current_schema() proves where unqualified DDL would land.
    const { rows } = await pool.query('SELECT current_schema() AS s');
    expect(rows[0].s).toBe('public');
    await pool.query(`DROP TABLE ${SHADOW_SCHEMA}.lt_roles`);
  });

  it('migrate() fails loudly when lt_migrations exists in a non-public schema', async () => {
    const pool = getPool();
    await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SHADOW_SCHEMA}`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS ${SHADOW_SCHEMA}.lt_migrations (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);
    await expect(migrate()).rejects.toThrow(/non-public schema.*migrate_split_sim/s);
    await pool.query(`DROP SCHEMA ${SHADOW_SCHEMA} CASCADE`);
  });

  it('migrate() runs cleanly again once the split is consolidated', async () => {
    await expect(migrate()).resolves.toBeUndefined();
  });
});
