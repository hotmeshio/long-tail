import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { writeFileSync, rmSync } from 'fs';
import path from 'path';
import os from 'os';

import { migrate } from '../../../lib/db/migrate';
import { getPool } from '../../../lib/db';
import {
  getDomainDictionary,
  seedDomainDictionary,
  domainCache,
} from '../../../services/domain';
import type { DomainDictionary } from '../../../types';

// ─────────────────────────────────────────────────────────────────────────────
// Startup domain apply — with the apply flag the file is compared against the
// stored document and written through the PUT upsert: one version bump per
// changed document, none for an identical one.
// ─────────────────────────────────────────────────────────────────────────────

const TMP = path.join(os.tmpdir(), `lt-domain-apply-${Date.now()}.json`);

const doc = (overview: string): DomainDictionary => ({
  name: 'apply-deployment',
  version: '1',
  overview,
  terms: [],
});

function writeDict(overview: string): void {
  writeFileSync(TMP, JSON.stringify(doc(overview)));
}

describe('domain dictionary — startup apply', () => {
  beforeAll(async () => {
    await migrate();
  }, 30_000);

  beforeEach(async () => {
    await getPool().query('DELETE FROM lt_domain');
    domainCache.invalidate();
  });

  afterAll(async () => {
    await getPool().query('DELETE FROM lt_domain');
    rmSync(TMP, { force: true });
  });

  it('a changed document bumps the version exactly once; an identical one never does', async () => {
    writeDict('first shape');
    await seedDomainDictionary(TMP, true);
    expect((await getDomainDictionary())?.version).toBe(1);

    // Identical file — no write, no bump.
    await seedDomainDictionary(TMP, true);
    domainCache.invalidate();
    expect((await getDomainDictionary())?.version).toBe(1);

    // Changed file — one bump.
    writeDict('second shape');
    await seedDomainDictionary(TMP, true);
    domainCache.invalidate();
    const record = await getDomainDictionary();
    expect(record?.version).toBe(2);
    expect(record?.doc.overview).toBe('second shape');
  });

  it('without the apply flag an existing document is never overwritten', async () => {
    writeDict('db owns this');
    await seedDomainDictionary(TMP);
    writeDict('code moved on');
    await seedDomainDictionary(TMP);
    domainCache.invalidate();
    const record = await getDomainDictionary();
    expect(record?.version).toBe(1);
    expect(record?.doc.overview).toBe('db owns this');
  });
});
