import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import * as roleService from '../../../services/role';
import {
  getDomainDictionary,
  putDomainDictionary,
  seedDomainDictionary,
  domainCache,
} from '../../../services/domain';
import type { DomainDictionary } from '../../../types';

const ROLE = `domain-dict-role-${Date.now()}`;
const TMP = path.join(os.tmpdir(), `lt-domain-seed-${Date.now()}.json`);

const doc = (name: string): DomainDictionary => ({
  name,
  version: '1',
  overview: 'test deployment',
  terms: [{ term: 'widget', kind: 'entity', maps_to: { role: ROLE }, guidance: 'a thing' }],
});

describe('domain dictionary — read / write / seed', () => {
  beforeAll(async () => {
    await migrate();
    await roleService.createRole(ROLE);
  }, 30_000);

  beforeEach(async () => {
    await getPool().query('DELETE FROM lt_domain');
    domainCache.invalidate();
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_domain');
    await getPool().query('DELETE FROM lt_roles WHERE role = $1', [ROLE]);
    rmSync(TMP, { force: true });
  });

  it('put inserts at version 1, read reflects it immediately (cache invalidated)', async () => {
    const result = await putDomainDictionary(doc('farm'));
    expect(result).toMatchObject({ ok: true, version: 1 });
    const record = await getDomainDictionary();
    expect(record?.doc.name).toBe('farm');
    expect(record?.version).toBe(1);
  });

  it('put bumps the version; a stale expected_version conflicts', async () => {
    await putDomainDictionary(doc('v1'));
    const second = await putDomainDictionary(doc('v2'), 1);
    expect(second).toMatchObject({ ok: true, version: 2 });

    const stale = await putDomainDictionary(doc('v3'), 1);
    expect(stale).toEqual({ ok: false, reason: 'version_conflict' });
    domainCache.invalidate();
    expect((await getDomainDictionary())?.doc.name).toBe('v2');
  });

  it('put rejects unknown role references with the offending name', async () => {
    const bad: DomainDictionary = {
      ...doc('bad'),
      terms: [{ term: 'ghosty', kind: 'role', maps_to: { role: 'no-such-role-xyz' }, guidance: 'g' }],
    };
    const result = await putDomainDictionary(bad);
    expect(result.ok).toBe(false);
    if (!result.ok && result.reason === 'invalid') {
      expect(result.errors.some((e) => e.includes('no-such-role-xyz'))).toBe(true);
    }
  });

  it('put returns facet warnings alongside success', async () => {
    const soft: DomainDictionary = {
      ...doc('warned'),
      terms: [{ term: 'plant', kind: 'facet', maps_to: { facet: 'facet-that-does-not-exist-anywhere' }, guidance: 'g' }],
    };
    const result = await putDomainDictionary(soft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.warnings.some((w) => w.includes('facet-that-does-not-exist-anywhere'))).toBe(true);
    }
  });

  it('seed inserts when absent and never overwrites an existing row', async () => {
    writeFileSync(TMP, JSON.stringify(doc('from-file')));
    await seedDomainDictionary(TMP);
    expect((await getDomainDictionary())?.doc.name).toBe('from-file');

    // Second seed with a different name: DB is runtime truth, row untouched.
    writeFileSync(TMP, JSON.stringify(doc('file-drifted')));
    await seedDomainDictionary(TMP);
    domainCache.invalidate();
    expect((await getDomainDictionary())?.doc.name).toBe('from-file');
  });

  it('seed never throws: missing file, bad JSON, and unknown refs all warn only', async () => {
    await expect(seedDomainDictionary('/nope/missing.json')).resolves.toBeUndefined();

    writeFileSync(TMP, '{not json');
    await expect(seedDomainDictionary(TMP)).resolves.toBeUndefined();
    expect(await getDomainDictionary()).toBeNull();

    // Unknown role: seed still inserts (warn-only) — host may create the role later.
    writeFileSync(TMP, JSON.stringify({
      ...doc('early-bird'),
      terms: [{ term: 'x', kind: 'role', maps_to: { role: 'role-seeded-later' }, guidance: 'g' }],
    }));
    await seedDomainDictionary(TMP);
    domainCache.invalidate();
    expect((await getDomainDictionary())?.doc.name).toBe('early-bird');
  });
});
