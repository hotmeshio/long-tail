import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { applyScanScheme, getScanScheme, upsertScanScheme } from '../../../services/scan-code';

// grant_scope and the gtin encoding round-trip through Postgres, and an
// unchanged declaration that omits grant_scope stays a no-op (the column
// defaults to 'action', which is what an absent field writes).

const BADGE = 94;
const SHOE = 93;

describe('scan schemes — grant_scope and gtin persist', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  afterAll(async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE version = ANY($1)', [[BADGE, SHOE]]);
  });

  const badge = { version: BADGE, name: 'Badge', target_facet: 'badge_id', encoding: 'delimited' as const,
    kind: 'identity' as const, grant_ttl_seconds: 600, grant_max_uses: 0 };

  it('an identity scheme stores its grant scope', async () => {
    await upsertScanScheme({ ...badge, grant_scope: 'subject' });
    expect((await getScanScheme(BADGE))?.grant_scope).toBe('subject');
  });

  it('a declaration without grant_scope applies once and then no-ops', async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE version = $1', [BADGE]);
    expect(await applyScanScheme(badge)).toBe('applied');
    expect(await applyScanScheme(badge)).toBe('unchanged');
    expect((await getScanScheme(BADGE))?.grant_scope).toBe('action');
  });

  it('a gtin scheme stores and reads back', async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE encoding = $1 AND version <> $2', ['gtin', SHOE]);
    await upsertScanScheme({ version: SHOE, name: 'Shoe', target_facet: 'upc', encoding: 'gtin' });
    expect((await getScanScheme(SHOE))?.encoding).toBe('gtin');
  });
});
