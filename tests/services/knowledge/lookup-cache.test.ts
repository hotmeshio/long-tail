import { describe, it, expect, vi, beforeEach } from 'vitest';

// Snapshots are immutable, so the cache asserts QUERY COUNTS: a repeat read
// of the same (domain, key, version) must not touch the pool. The module
// cache persists across tests — each test uses its own keys.
const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));

import {
  getKnowledgeSnapshot,
  resolveLookupContext,
  resolveLookupRefs,
} from '../../../services/knowledge/lookup-cache';

beforeEach(() => {
  vi.clearAllMocks();
});

function snapshotRow(data: Record<string, unknown>) {
  return { rows: [{ data, tags: [] }] };
}

describe('getKnowledgeSnapshot', () => {
  it('serves repeat reads from cache — one query per pinned edition, ever', async () => {
    mockQuery.mockResolvedValue(snapshotRow({ items: [1, 2] }));
    const first = await getKnowledgeSnapshot('cat-a', 'materials', 1);
    const second = await getKnowledgeSnapshot('cat-a', 'materials', 1);
    expect(first?.data).toEqual({ items: [1, 2] });
    expect(second).toBe(first);
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  it('does not cache missing snapshots — a later publish must become visible', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await getKnowledgeSnapshot('cat-b', 'ghost', 1)).toBeNull();
    expect(await getKnowledgeSnapshot('cat-b', 'ghost', 1)).toBeNull();
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });
});

describe('resolveLookupContext', () => {
  it('maps refs to { [as ?? key]: data } and skips missing snapshots', async () => {
    mockQuery
      .mockResolvedValueOnce(snapshotRow({ items: ['x'] }))
      .mockResolvedValueOnce({ rows: [] });
    const ctx = await resolveLookupContext([
      { domain: 'cat-c', key: 'materials', version: 1, as: 'mats' },
      { domain: 'cat-c', key: 'ghost', version: 1 },
    ]);
    expect(ctx).toEqual({ mats: { items: ['x'] } });
  });

  it('answers null for absent/empty/malformed refs without touching the pool', async () => {
    expect(await resolveLookupContext(undefined)).toBeNull();
    expect(await resolveLookupContext([])).toBeNull();
    expect(await resolveLookupContext('nope')).toBeNull();
    expect(await resolveLookupContext([{ domain: 'cat-d', key: 'k' }])).toBeNull();
    expect(await resolveLookupContext([{ domain: 'cat-d', key: 'k', version: 1.5 }])).toBeNull();
    expect(mockQuery).not.toHaveBeenCalled();
  });
});

describe('resolveLookupRefs', () => {
  it('answers every ref, marking missing snapshots instead of failing the batch', async () => {
    mockQuery
      .mockResolvedValueOnce(snapshotRow({ items: ['a'] }))
      .mockResolvedValueOnce({ rows: [] });
    const resolved = await resolveLookupRefs([
      { domain: 'cat-e', key: 'materials', version: 2, as: 'mats' },
      { domain: 'cat-e', key: 'ghost', version: 3 },
    ]);
    expect(resolved).toEqual([
      { domain: 'cat-e', key: 'materials', version: 2, as: 'mats', data: { items: ['a'] } },
      { domain: 'cat-e', key: 'ghost', version: 3, data: null, missing: true },
    ]);
  });
});
