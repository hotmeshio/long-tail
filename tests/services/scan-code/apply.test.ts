import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  applyScanScheme,
  applyScanRule,
  seedScanScheme,
  seedScanRule,
  upsertScanScheme,
  getScanScheme,
  getScanRule,
} from '../../../services/scan-code';

// ─────────────────────────────────────────────────────────────────────────────
// Startup scan-scheme apply — code is source of truth under the code-owned
// pass: an unchanged declaration is a no-op, a changed one overwrites, and
// db-owned schemes keep the insert-if-absent contract.
// Version 98 stays clear of the demo seeds.
// ─────────────────────────────────────────────────────────────────────────────

const VERSION = 98;
const DB_VERSION = 97;

const SCHEME = {
  version: VERSION,
  name: 'Fixture scheme',
  target_facet: 'serialNumber',
  encoding: 'fixed' as const,
  target_length: 8,
};

const RULE = {
  scheme_version: VERSION,
  category: '1',
  name: 'Locate',
  steps: [{ verb: 'show-detail' as any }],
};

describe('scan-code — startup apply', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE version = ANY($1)', [[VERSION, DB_VERSION]]);
  });

  it('registers a new scheme, then no-ops on an identical apply', async () => {
    expect(await applyScanScheme(SCHEME)).toBe('applied');
    expect(await applyScanScheme(SCHEME)).toBe('unchanged');
  });

  it('a changed scheme field overwrites the row', async () => {
    expect(await applyScanScheme({ ...SCHEME, name: 'Renamed scheme' })).toBe('applied');
    expect((await getScanScheme(VERSION))?.name).toBe('Renamed scheme');
  });

  it('rule apply detects jsonb step changes', async () => {
    expect(await applyScanRule(RULE)).toBe('applied');
    expect(await applyScanRule(RULE)).toBe('unchanged');

    const changed = { ...RULE, steps: [{ verb: 'claim' as any }, { verb: 'show-detail' as any }] };
    expect(await applyScanRule(changed)).toBe('applied');
    expect((await getScanRule(VERSION, '1'))?.steps).toHaveLength(2);
  });

  it('db-owned: an admin edit survives a re-seed', async () => {
    await seedScanScheme({ ...SCHEME, version: DB_VERSION, name: 'Original' });
    await seedScanRule({ ...RULE, scheme_version: DB_VERSION });
    // Admin edits through the config surface.
    await upsertScanScheme({ ...SCHEME, version: DB_VERSION, name: 'Admin Renamed' });

    // Next boot re-seeds the original declaration — insert-if-absent skips it.
    expect(await seedScanScheme({ ...SCHEME, version: DB_VERSION, name: 'Original' })).toBe(false);
    expect((await getScanScheme(DB_VERSION))?.name).toBe('Admin Renamed');
  });

  it('an invalid rule declaration throws from the service', async () => {
    await expect(applyScanRule({ ...RULE, category: '12' })).rejects.toThrow('single digit');
    await expect(applyScanRule({ ...RULE, category: '2', steps: [], fallback: undefined }))
      .rejects.toThrow('at least one step or a fallback');
  });
});
