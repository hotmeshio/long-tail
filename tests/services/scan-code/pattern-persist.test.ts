import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { applyScanScheme, getScanScheme, upsertScanScheme } from '../../../services/scan-code';

// The pattern encoding, its gtin precedence, and the list target round-trip
// through Postgres; an unchanged declaration stays a no-op.

const PARCEL = 92;
const BAG = 91;

describe('scan schemes — patterns and list targets persist', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  afterAll(async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE version = ANY($1)', [[PARCEL, BAG]]);
  });

  const parcel = {
    version: PARCEL, name: 'Parcel', target_facet: 'trackingNumbers', encoding: 'pattern' as const,
    patterns: ['1Z[0-9A-Z]{16}', '[0-9]{12}'], precedes_gtin: true, target_match: 'member' as const,
  };

  it('a pattern scheme stores its patterns, precedence and target match', async () => {
    await upsertScanScheme(parcel);
    expect(await getScanScheme(PARCEL)).toMatchObject({
      encoding: 'pattern', patterns: ['1Z[0-9A-Z]{16}', '[0-9]{12}'], precedes_gtin: true, target_match: 'member',
    });
  });

  it('a declaration applies once and then no-ops; a changed pattern applies again', async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE version = $1', [PARCEL]);
    expect(await applyScanScheme(parcel)).toBe('applied');
    expect(await applyScanScheme(parcel)).toBe('unchanged');
    expect(await applyScanScheme({ ...parcel, patterns: ['1Z[0-9A-Z]{16}'] })).toBe('applied');
  });

  it('a scheme without the new fields reads back with their defaults', async () => {
    await upsertScanScheme({ version: BAG, name: 'Bag', target_facet: 'orderId', encoding: 'delimited' });
    expect(await getScanScheme(BAG)).toMatchObject({ patterns: [], precedes_gtin: null, target_match: 'value' });
  });

  it('the database refuses an unknown target match', async () => {
    await expect(getPool().query(
      'UPDATE lt_config_scan_schemes SET target_match = $1 WHERE version = $2', ['any', BAG],
    )).rejects.toThrow(/check constraint/);
  });
});
