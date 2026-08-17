import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import * as knowledge from '../../../system/activities/knowledge';
import { getKnowledgeVersion, listKnowledgeVersions } from '../../../services/knowledge';

const DOMAIN = 'test-kb-versions';

// Auto-versioning: every write that changes data bumps current_version and
// snapshots the new edition; writes that leave data unchanged mint nothing.

describe('knowledge versioning', () => {
  let client: Postgres;

  beforeAll(async () => {
    client = new Postgres(postgres_options);
    await client.connect();
    await migrate();
    await client.query('DELETE FROM lt_knowledge WHERE domain = $1', [DOMAIN]);
  });

  afterAll(async () => {
    await client.query('DELETE FROM lt_knowledge WHERE domain = $1', [DOMAIN]);
    await client.end();
  });

  it('a new entry starts at version 1 with a v1 snapshot', async () => {
    const stored = await knowledge.storeKnowledge({
      domain: DOMAIN, key: 'list', data: { items: ['a', 'b'] },
    });
    expect(stored.current_version).toBe(1);

    const v1 = await getKnowledgeVersion(DOMAIN, 'list', 1);
    expect(v1?.data).toEqual({ items: ['a', 'b'] });
  });

  it('a data-changing upsert bumps the version and snapshots the new edition', async () => {
    const stored = await knowledge.storeKnowledge({
      domain: DOMAIN, key: 'list', data: { items: ['a', 'b', 'c'] },
    });
    expect(stored.current_version).toBe(2);

    // The pinned v1 edition is untouched by the evolution.
    const v1 = await getKnowledgeVersion(DOMAIN, 'list', 1);
    expect(v1?.data).toEqual({ items: ['a', 'b'] });
    const v2 = await getKnowledgeVersion(DOMAIN, 'list', 2);
    expect(v2?.data).toEqual({ items: ['a', 'b', 'c'] });
  });

  it('an identical upsert does not bump (IS DISTINCT FROM guard)', async () => {
    const stored = await knowledge.storeKnowledge({
      domain: DOMAIN, key: 'list', data: { items: ['a', 'b', 'c'] },
    });
    expect(stored.current_version).toBe(2);
    expect(await listKnowledgeVersions(DOMAIN, 'list')).toHaveLength(2);
  });

  it('tags-only changes never bump — the version is the data identity', async () => {
    const stored = await knowledge.storeKnowledge({
      domain: DOMAIN, key: 'list', data: { items: ['a', 'b', 'c'] }, tags: ['new-tag'],
    });
    expect(stored.current_version).toBe(2);
  });

  it('replace, setField, append, and removeField each snapshot their change', async () => {
    await knowledge.storeKnowledge({ domain: DOMAIN, key: 'ops', data: { keep: 1 } });

    const replaced = await knowledge.storeKnowledge({
      domain: DOMAIN, key: 'ops', data: { keep: 2 }, replace: true,
    });
    expect(replaced.current_version).toBe(2);

    const set = await knowledge.setKnowledgeField({
      domain: DOMAIN, key: 'ops', path: 'flag', value: true,
    });
    expect(set.current_version).toBe(3);

    const appended = await knowledge.appendKnowledge({
      domain: DOMAIN, key: 'ops', path: 'log', value: 'first',
    });
    expect(appended.current_version).toBe(4);

    await knowledge.removeKnowledgeField({ domain: DOMAIN, key: 'ops', path: 'flag' });
    const entry = await knowledge.getKnowledge({ domain: DOMAIN, key: 'ops' });
    expect(entry.current_version).toBe(5);

    const versions = await listKnowledgeVersions(DOMAIN, 'ops');
    expect(versions.map((v) => v.version)).toEqual([5, 4, 3, 2, 1]);
    expect(versions[0].is_current).toBe(true);
    expect(versions[1].is_current).toBe(false);
  });

  it('an identical setField does not bump', async () => {
    await knowledge.setKnowledgeField({ domain: DOMAIN, key: 'ops', path: 'log', value: ['first'] });
    const before = await knowledge.getKnowledge({ domain: DOMAIN, key: 'ops' });
    const again = await knowledge.setKnowledgeField({ domain: DOMAIN, key: 'ops', path: 'log', value: ['first'] });
    expect(again.current_version).toBe(before.current_version);
  });

  it('a missing version answers null; delete cascades the snapshots', async () => {
    expect(await getKnowledgeVersion(DOMAIN, 'list', 99)).toBeNull();

    await knowledge.deleteKnowledge({ domain: DOMAIN, key: 'ops' });
    const { rows } = await client.query(
      'SELECT COUNT(*)::int AS n FROM lt_knowledge_versions WHERE domain = $1 AND key = $2',
      [DOMAIN, 'ops'],
    );
    expect(rows[0].n).toBe(0);
  });
});
