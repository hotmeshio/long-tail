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
    expect(await resolveLookupContext([{ domain: 'cat-d', key: 'k', version: 1.5 }])).toBeNull();
    expect(await resolveLookupContext([{ domain: 'cat-d', key: 'k', version: 'newest' }])).toBeNull();
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

describe('current refs', () => {
  const latestRow = (version: number, data: Record<string, unknown>) => ({ rows: [{ version, data, tags: [] }] });

  it('a ref with no version reads the newest edition and reports which', async () => {
    mockQuery.mockResolvedValueOnce(latestRow(4, { items: ['t4'] }));
    const resolved = await resolveLookupRefs([{ domain: 'cur-a', key: 'tables', as: 'tables' }]);
    expect(resolved).toEqual([{ domain: 'cur-a', key: 'tables', version: 4, current: true, as: 'tables', data: { items: ['t4'] } }]);
    expect(mockQuery.mock.calls[0][1]).toEqual(['cur-a', 'tables', null]);
  });

  it("'current' reads the same way, and a closed row reads the edition current when it closed", async () => {
    mockQuery.mockResolvedValueOnce(latestRow(2, { items: ['t2'] }));
    const ctx = await resolveLookupContext([{ domain: 'cur-b', key: 'tables', version: 'current' }], '2026-10-01T00:00:00.000Z');
    expect(ctx).toEqual({ tables: { items: ['t2'] } });
    expect(mockQuery.mock.calls[0][1]).toEqual(['cur-b', 'tables', '2026-10-01T00:00:00.000Z']);
  });

  it('asks the store each time, so a new edition shows on the next read', async () => {
    mockQuery.mockResolvedValueOnce(latestRow(1, { v: 1 })).mockResolvedValueOnce(latestRow(2, { v: 2 }));
    const ref = { domain: 'cur-c', key: 'boxes' };
    expect((await resolveLookupRefs([ref]))[0].data).toEqual({ v: 1 });
    expect((await resolveLookupRefs([ref]))[0].data).toEqual({ v: 2 });
  });

  it('an entry with no edition answers missing with no version', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [] });
    expect(await resolveLookupRefs([{ domain: 'cur-d', key: 'ghost' }]))
      .toEqual([{ domain: 'cur-d', key: 'ghost', version: null, current: true, data: null, missing: true }]);
  });
});
