import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Client as Postgres } from 'pg';

import { postgres_options } from '../../setup';
import { migrate } from '../../../lib/db/migrate';
import * as knowledge from '../../../system/activities/knowledge';

const DOMAIN = 'test-knowledge';
const DOMAIN_B = 'test-knowledge-isolated';

describe('knowledge store', () => {
  let client: Postgres;

  beforeAll(async () => {
    client = new Postgres(postgres_options);
    await client.connect();
    await migrate();
    // Clean slate
    await client.query('DELETE FROM lt_knowledge WHERE domain IN ($1, $2)', [DOMAIN, DOMAIN_B]);
  });

  afterAll(async () => {
    await client.query('DELETE FROM lt_knowledge WHERE domain IN ($1, $2)', [DOMAIN, DOMAIN_B]);
    await client.end();
  });

  // ── store + retrieve round-trip ──────────────────────────────────────────

  it('stores and retrieves a knowledge entry', async () => {
    const stored = await knowledge.storeKnowledge({
      domain: DOMAIN,
      key: 'entry-1',
      data: { type: 'test', value: 42 },
      tags: ['unit-test'],
    });
    expect(stored.domain).toBe(DOMAIN);
    expect(stored.key).toBe('entry-1');
    expect(stored.created).toBe(true);
    expect(stored.id).toBeDefined();

    const retrieved = await knowledge.getKnowledge({ domain: DOMAIN, key: 'entry-1' });
    expect(retrieved.data).toEqual({ type: 'test', value: 42 });
    expect(retrieved.tags).toEqual(['unit-test']);
  });

  // ── upsert merge semantics ─────────────────────────────────────────────

  it('merges data and unions tags on upsert', async () => {
    await knowledge.storeKnowledge({
      domain: DOMAIN,
      key: 'entry-1',
      data: { extra: 'field', value: 99 },
      tags: ['updated'],
    });

    const retrieved = await knowledge.getKnowledge({ domain: DOMAIN, key: 'entry-1' });
    // JSONB || merge: value overwritten, extra added, type preserved
    expect(retrieved.data.extra).toBe('field');
    expect(retrieved.data.value).toBe(99);
    expect(retrieved.data.type).toBe('test');
    // Tags unioned
    expect(retrieved.tags).toContain('unit-test');
    expect(retrieved.tags).toContain('updated');
  });

  // ── get returns found:false for missing ─────────────────────────────────

  it('returns found:false for missing entries', async () => {
    const result = await knowledge.getKnowledge({ domain: DOMAIN, key: 'nonexistent' });
    expect(result.found).toBe(false);
  });

  // ── search by JSONB containment ────────────────────────────────────────

  it('searches by JSONB containment', async () => {
    await knowledge.storeKnowledge({
      domain: DOMAIN,
      key: 'screenshot-1',
      data: { type: 'screenshot', url: 'https://google.com', doodle: true },
      tags: ['screenshot'],
    });
    await knowledge.storeKnowledge({
      domain: DOMAIN,
      key: 'screenshot-2',
      data: { type: 'screenshot', url: 'https://google.com', doodle: false },
      tags: ['screenshot'],
    });

    const doodles = await knowledge.searchKnowledge({
      domain: DOMAIN,
      query: { doodle: true },
    });
    expect(doodles.entries.length).toBe(1);
    expect(doodles.entries[0].key).toBe('screenshot-1');

    const allScreenshots = await knowledge.searchKnowledge({
      domain: DOMAIN,
      query: { type: 'screenshot' },
    });
    expect(allScreenshots.entries.length).toBe(2);
  });

  // ── tag filtering ──────────────────────────────────────────────────────

  it('filters by tags in list and search', async () => {
    const tagged = await knowledge.listKnowledge({
      domain: DOMAIN,
      tags: ['screenshot'],
    });
    expect(tagged.entries.length).toBe(2);

    const unitTests = await knowledge.listKnowledge({
      domain: DOMAIN,
      tags: ['unit-test'],
    });
    expect(unitTests.entries.length).toBe(1);
  });

  // ── append to array ────────────────────────────────────────────────────

  it('appends to an array field', async () => {
    await knowledge.appendKnowledge({
      domain: DOMAIN,
      key: 'catalog',
      path: 'items',
      value: { date: '2026-04-15', theme: 'Earth Day' },
    });
    await knowledge.appendKnowledge({
      domain: DOMAIN,
      key: 'catalog',
      path: 'items',
      value: { date: '2026-04-16', theme: 'Normal' },
    });

    const catalog = await knowledge.getKnowledge({ domain: DOMAIN, key: 'catalog' });
    expect(catalog.data.items).toHaveLength(2);
    expect(catalog.data.items[0].theme).toBe('Earth Day');
    expect(catalog.data.items[1].theme).toBe('Normal');
  });

  // ── domain isolation ───────────────────────────────────────────────────

  it('isolates entries by domain', async () => {
    await knowledge.storeKnowledge({
      domain: DOMAIN_B,
      key: 'entry-1',
      data: { isolated: true },
    });

    const fromA = await knowledge.listKnowledge({ domain: DOMAIN });
    const fromB = await knowledge.listKnowledge({ domain: DOMAIN_B });

    expect(fromB.entries.length).toBe(1);
    expect(fromB.entries[0].data.isolated).toBe(true);

    // Domain A should not see Domain B's entry
    const aKeys = fromA.entries.map((e) => e.domain);
    expect(aKeys.every((d) => d === DOMAIN)).toBe(true);
  });

  // ── list_domains aggregation ───────────────────────────────────────────

  it('lists domains with counts', async () => {
    const result = await knowledge.listDomains();
    const domainA = result.domains.find((d) => d.domain === DOMAIN);
    const domainB = result.domains.find((d) => d.domain === DOMAIN_B);

    expect(domainA).toBeDefined();
    expect(domainA!.count).toBeGreaterThanOrEqual(4);
    expect(domainB).toBeDefined();
    expect(domainB!.count).toBe(1);
  });

  // ── delete ─────────────────────────────────────────────────────────────

  it('deletes an entry', async () => {
    const result = await knowledge.deleteKnowledge({ domain: DOMAIN, key: 'catalog' });
    expect(result.deleted).toBe(true);

    const after = await knowledge.getKnowledge({ domain: DOMAIN, key: 'catalog' });
    expect(after.found).toBe(false);
  });

  it('returns deleted:false for nonexistent entries', async () => {
    const result = await knowledge.deleteKnowledge({ domain: DOMAIN, key: 'nope' });
    expect(result.deleted).toBe(false);
  });
});
