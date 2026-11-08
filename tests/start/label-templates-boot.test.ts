import { describe, it, expect, afterAll } from 'vitest';

import { setupRouteTest } from '../routes/setup';
import { getLabelTemplate, deleteLabelTemplate } from '../../services/labels';
import { deleteScanScheme } from '../../services/scan-code';
import type { LTScanSchemeConfig } from '../../types';

// Label templates declared with their scan scheme apply at boot, owned with it.

const scheme: LTScanSchemeConfig = {
  version: 81,
  name: 'Boot items',
  target_facet: 'boot_item',
  encoding: 'delimited',
  delimiter: ':',
  reset: true,
  rules: [{ category: '0', name: 'Check in', steps: [], fallback: { markdown: 'check in' } }],
  labels: [{
    name: 'boot-item',
    title: 'Boot two-code label',
    codes: [{ category: '0', tone: 'solid' }],
    text: { title: '{target}' },
    media: 'a4-l7163',
  }],
};

describe('label templates declared in code', () => {
  setupRouteTest(4658, { scanSchemes: [scheme] });

  afterAll(async () => {
    await deleteLabelTemplate('boot-item');
    await deleteScanScheme(81);
  });

  it('applies the template with its scheme, code-owned', async () => {
    expect(await getLabelTemplate('boot-item')).toMatchObject({
      scheme_version: 81, title: 'Boot two-code label', media: 'a4-l7163', source: 'code',
      codes: [{ category: '0', caption: null, tone: 'solid' }],
    });
  });
});
