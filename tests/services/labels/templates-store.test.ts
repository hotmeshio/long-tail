import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import {
  applyLabelTemplate, getLabelTemplate, listLabelTemplates, seedLabelTemplate, upsertLabelTemplate,
  LabelTemplateConflictError, deleteLabelTemplate,
} from '../../../services/labels';
import { createLabelFixtures, type LabelFixtures } from '../../helpers/label-fixtures';

const { Connection } = Durable;

describe('label template storage', () => {
  let fx: LabelFixtures;
  const extra = 'tpl-store-extra';

  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    fx = await createLabelFixtures(88, 'tplstore');
  }, 60_000);

  afterAll(async () => {
    await deleteLabelTemplate(extra);
    await fx.cleanup();
  });

  it('lists templates by scheme and maps every field', async () => {
    const [item] = await listLabelTemplates(fx.itemScheme);
    expect(item).toMatchObject({
      name: fx.itemTemplate, scheme_version: fx.itemScheme, symbology: 'code128', human_readable: true,
      sensitive: false, enabled: true, source: 'api', revision: 1,
      codes: [{ category: '0', caption: null, tone: 'solid' }, { category: '1', caption: null, tone: 'outline' }],
    });
  });

  it('an identity scheme template is stored sensitive', async () => {
    expect((await getLabelTemplate(fx.badgeTemplate))?.sensitive).toBe(true);
  });

  it('every API write bumps the revision; a stale expected revision is a conflict', async () => {
    const current = (await getLabelTemplate(fx.itemTemplate))!;
    const next = await upsertLabelTemplate({ ...current, title: 'Renamed' }, current.revision);
    expect(next.revision).toBe(current.revision + 1);
    await expect(upsertLabelTemplate({ ...current, title: 'Stale' }, current.revision)).rejects.toBeInstanceOf(LabelTemplateConflictError);
  });

  it('seed inserts only when absent', async () => {
    const input = { name: extra, scheme_version: fx.itemScheme, title: 'Extra', codes: [{ category: '0', tone: 'plain' as const }] };
    expect(await seedLabelTemplate(input)).toBe(true);
    expect(await seedLabelTemplate({ ...input, title: 'Changed' })).toBe(false);
    expect((await getLabelTemplate(extra))?.title).toBe('Extra');
  });

  it('apply writes a changed declaration once and marks it code-owned', async () => {
    const input = { name: extra, scheme_version: fx.itemScheme, title: 'From code', codes: [{ category: '0', tone: 'plain' as const }] };
    expect(await applyLabelTemplate(input)).toBe('applied');
    expect(await applyLabelTemplate(input)).toBe('unchanged');
    expect(await getLabelTemplate(extra)).toMatchObject({ title: 'From code', source: 'code' });
  });

  it('deleting the scheme removes its templates', async () => {
    const { upsertScanScheme, upsertScanRule, deleteScanScheme } = await import('../../../services/scan-code');
    await upsertScanScheme({ version: 87, name: 'Cascade', target_facet: 'cascade_item', encoding: 'delimited', delimiter: ':' } as any);
    await upsertScanRule({ scheme_version: 87, category: '0', name: 'Go', steps: [], fallback: { markdown: 'go' } });
    await upsertLabelTemplate({ name: 'tpl-cascade', scheme_version: 87, title: 'Cascade', codes: [{ category: '0', tone: 'plain' }] });
    await deleteScanScheme(87);
    expect(await getLabelTemplate('tpl-cascade')).toBeNull();
  });
});
