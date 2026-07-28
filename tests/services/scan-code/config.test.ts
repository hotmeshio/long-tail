import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';
import { Durable } from '@hotmeshio/hotmesh';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as scanCodeService from '../../../services/scan-code';
import { SCAN_ENCODINGS, SCAN_VERBS } from '../../../types';

const { Connection } = Durable;

// Scheme/rule CRUD against real Postgres — the config store the execute
// path reads at scan time. Uses version 9 to stay clear of seeded demos.
const VERSION = 9;

const scheme = {
  version: VERSION,
  name: 'crud-case',
  target_facet: 'serialNumber',
  encoding: SCAN_ENCODINGS.DELIMITED,
  delimiter: ':',
};

describe('scan-code config CRUD (integration)', () => {
  beforeAll(async () => {
    await Connection.connect({ class: Postgres, options: postgres_options });
    await migrate();
    await scanCodeService.deleteScanScheme(VERSION);
  }, 60_000);

  afterAll(async () => {
    await scanCodeService.deleteScanScheme(VERSION);
    await getPool().end();
  });

  it('upserts and reads back a scheme', async () => {
    await scanCodeService.upsertScanScheme(scheme);
    const read = await scanCodeService.getScanScheme(VERSION);
    expect(read).not.toBeNull();
    expect(read!.name).toBe('crud-case');
    expect(read!.target_facet).toBe('serialNumber');
    expect(read!.encoding).toBe(SCAN_ENCODINGS.DELIMITED);
    expect(read!.enabled).toBe(true);
  });

  it('upsert replaces fields on conflict', async () => {
    await scanCodeService.upsertScanScheme({ ...scheme, name: 'renamed', enabled: false });
    const read = await scanCodeService.getScanScheme(VERSION);
    expect(read!.name).toBe('renamed');
    expect(read!.enabled).toBe(false);
    await scanCodeService.upsertScanScheme(scheme); // restore
  });

  it('rejects an invalid scheme loudly', async () => {
    await expect(
      scanCodeService.upsertScanScheme({ ...scheme, encoding: SCAN_ENCODINGS.FIXED, target_length: null }),
    ).rejects.toThrow(/target_length/);
  });

  it('upserts and reads back a rule with steps and fallback', async () => {
    await scanCodeService.upsertScanRule({
      scheme_version: VERSION,
      category: '07',
      name: 'Send to servicing',
      steps: [
        {
          query: { roles: ['crud-case-queue'] },
          verb: SCAN_VERBS.ESCALATE,
          params: { targetRole: 'crud-case-service', closeCurrent: 'resolve', resolverPayload: { moved: true } },
        },
        { query: {}, verb: SCAN_VERBS.SHOW_DETAIL },
      ],
      fallback: { markdown: 'Nothing here.' },
    });
    const rule = await scanCodeService.getScanRule(VERSION, '07');
    expect(rule).not.toBeNull();
    expect(rule!.name).toBe('Send to servicing');
    expect(rule!.steps).toHaveLength(2);
    expect(rule!.steps[0].verb).toBe(SCAN_VERBS.ESCALATE);
    expect(rule!.fallback.markdown).toBe('Nothing here.');
  });

  it('rejects an incoherent rule loudly', async () => {
    await expect(
      scanCodeService.upsertScanRule({
        scheme_version: VERSION,
        category: '08',
        name: 'broken',
        steps: [{ query: {}, verb: SCAN_VERBS.ESCALATE }],
      }),
    ).rejects.toThrow(/targetRole/);
  });

  it('rejects a rule with no steps and no fallback', async () => {
    await expect(
      scanCodeService.upsertScanRule({
        scheme_version: VERSION,
        category: '09',
        name: 'empty',
        steps: [],
      }),
    ).rejects.toThrow(/at least one step or a fallback/);
  });

  it('lists rules for a scheme and deletes one', async () => {
    const rules = await scanCodeService.listScanRules(VERSION);
    expect(rules.map((r) => r.category)).toContain('07');
    expect(await scanCodeService.deleteScanRule(VERSION, '07')).toBe(true);
    expect(await scanCodeService.getScanRule(VERSION, '07')).toBeNull();
  });

  it('cascades rule deletion when the scheme is deleted', async () => {
    await scanCodeService.upsertScanRule({
      scheme_version: VERSION,
      category: '11',
      name: 'cascade-case',
      steps: [{ query: {}, verb: SCAN_VERBS.SHOW_DETAIL }],
    });
    await scanCodeService.deleteScanScheme(VERSION);
    expect(await scanCodeService.getScanScheme(VERSION)).toBeNull();
    expect(await scanCodeService.getScanRule(VERSION, '11')).toBeNull();
  });
});
