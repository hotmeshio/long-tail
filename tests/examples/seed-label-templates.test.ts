import { describe, it, expect, beforeAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../setup';
import { migrate } from '../../lib/db/migrate';
import { seedScanCodes, seedBadgeScheme } from '../../examples/seed-scan-codes';
import { seedBinScanCodes } from '../../examples/seed-scan-bins';
import { EXAMPLE_LABEL_TEMPLATES, seedLabelTemplates } from '../../examples/seed-label-templates';
import { getLabelTemplate } from '../../services/labels';

const { Connection } = Durable;

// The example templates validate against the example schemes they print.

describe('example label templates', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await seedScanCodes();
    await seedBadgeScheme();
    await seedBinScanCodes();
    await seedLabelTemplates();
  }, 60_000);

  it('every example template is stored', async () => {
    for (const t of EXAMPLE_LABEL_TEMPLATES) {
      expect(await getLabelTemplate(t.name), t.name).not.toBeNull();
    }
  });

  it('the badge template is sensitive and prints a QR code', async () => {
    expect(await getLabelTemplate('associate-badge')).toMatchObject({ sensitive: true, symbology: 'qrcode', human_readable: false });
  });

  it('the printer template prints all four corner acts', async () => {
    expect((await getLabelTemplate('printer-corners'))?.codes.map((c) => c.category)).toEqual(['0', '1', '2', '3']);
  });
});
