import { describe, it, expect, beforeAll, afterAll } from 'vitest';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import { applyScanScheme, getScanScheme, upsertScanScheme } from '../../../services/scan-code';

// A scheme's binding settings round-trip; a save that leaves them out keeps them.

const TUB = 88;
const tub = { version: TUB, name: 'Tub', target_facet: 'tubCode', encoding: 'delimited' as const };

describe('scan schemes: identifier settings persist', () => {
  beforeAll(async () => { await migrate(); }, 30_000);
  afterAll(async () => {
    await getPool().query('DELETE FROM lt_config_scan_schemes WHERE version = $1', [TUB]);
  });

  it('a save names the settings, and a later save without them keeps them', async () => {
    await upsertScanScheme({ ...tub, identifier: { binders: ['loader'], exclusiveTarget: true } });
    expect((await getScanScheme(TUB))?.identifier).toEqual({ binders: ['loader'], exclusiveTarget: true });
    await upsertScanScheme({ ...tub, name: 'Tub renamed' });
    expect(await getScanScheme(TUB)).toMatchObject({ name: 'Tub renamed', identifier: { binders: ['loader'], exclusiveTarget: true } });
  });

  it('a save naming null clears them', async () => {
    await upsertScanScheme({ ...tub, identifier: { binders: ['loader'] } });
    await upsertScanScheme({ ...tub, identifier: null });
    expect((await getScanScheme(TUB))?.identifier).toBeNull();
  });

  it('a code-owned declaration is the source of truth, and an unchanged one is a no-op', async () => {
    expect(await applyScanScheme({ ...tub, identifier: { exclusiveTarget: true } })).toBe('applied');
    expect(await applyScanScheme({ ...tub, identifier: { exclusiveTarget: true } })).toBe('unchanged');
    expect(await applyScanScheme(tub)).toBe('applied');
    expect((await getScanScheme(TUB))?.identifier).toBeNull();
  });

  it('settings other than binders and exclusiveTarget are refused', async () => {
    await expect(upsertScanScheme({ ...tub, identifier: { codec: 'epc' } as any })).rejects.toThrow(/identifier takes/);
    await expect(upsertScanScheme({ ...tub, identifier: { binders: [''] } })).rejects.toThrow(/binders/);
    await expect(upsertScanScheme({ ...tub, identifier: { exclusiveTarget: 'yes' } as any })).rejects.toThrow(/exclusiveTarget/);
  });
});
