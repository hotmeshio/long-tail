import { describe, it, expect, afterAll } from 'vitest';

import { setupRouteTest } from '../routes/setup';
import { deleteScanScheme, getScanScheme } from '../../services/scan-code';
import type { LTScanSchemeConfig } from '../../types';

// A scheme's binding settings are declared with it at boot, typed.

const owned: LTScanSchemeConfig = {
  version: 83,
  name: 'Boot plates',
  target_facet: 'serialNumber',
  encoding: 'delimited',
  delimiter: ':',
  reset: true,
  identifier: { binders: ['print-loader'], exclusiveTarget: true },
};

const seeded: LTScanSchemeConfig = {
  version: 84,
  name: 'Boot cartridges',
  target_facet: 'materialId',
  encoding: 'delimited',
  delimiter: ':',
  reset: false,
  identifier: { binders: ['material-loader'] },
};

describe('scan scheme identifier settings declared in code', () => {
  setupRouteTest(4659, { scanSchemes: [owned, seeded] });

  afterAll(async () => {
    await deleteScanScheme(83);
    await deleteScanScheme(84);
  });

  it('a code-owned scheme applies its identifier settings', async () => {
    expect((await getScanScheme(83))?.identifier).toEqual({ binders: ['print-loader'], exclusiveTarget: true });
  });

  it('a db-owned scheme is seeded with them', async () => {
    expect((await getScanScheme(84))?.identifier).toEqual({ binders: ['material-loader'] });
  });
});
