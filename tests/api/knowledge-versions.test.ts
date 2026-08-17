import { describe, it, expect, vi, beforeEach } from 'vitest';

// The knowledge version endpoints: immutable edition reads and the lineage
// list, with the api layer mapping absent editions to 404.

vi.mock('../../services/knowledge', () => ({
  getKnowledgeVersion: vi.fn(),
  listKnowledgeVersions: vi.fn(),
}));

import { getEntryVersion, listEntryVersions } from '../../api/knowledge';
import * as knowledgeService from '../../services/knowledge';

const mockGetVersion = vi.mocked(knowledgeService.getKnowledgeVersion);
const mockListVersions = vi.mocked(knowledgeService.listKnowledgeVersions);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getEntryVersion', () => {
  it('answers the immutable edition', async () => {
    mockGetVersion.mockResolvedValue({
      domain: 'catalog', key: 'materials', version: 1,
      data: { items: ['aluminum'] }, tags: ['lookup'], created_at: '2026-08-17T00:00:00Z',
    });
    const result = await getEntryVersion({ domain: 'catalog', key: 'materials', version: 1 });
    expect(result.status).toBe(200);
    expect(result.data).toMatchObject({ version: 1, data: { items: ['aluminum'] } });
    expect(mockGetVersion).toHaveBeenCalledWith('catalog', 'materials', 1);
  });

  it('404s an edition that does not exist', async () => {
    mockGetVersion.mockResolvedValue(null);
    const result = await getEntryVersion({ domain: 'catalog', key: 'materials', version: 99 });
    expect(result.status).toBe(404);
    expect(result.error).toContain('version 99');
  });

  it('maps a service failure to 500', async () => {
    mockGetVersion.mockRejectedValue(new Error('pool down'));
    const result = await getEntryVersion({ domain: 'catalog', key: 'materials', version: 1 });
    expect(result.status).toBe(500);
    expect(result.error).toBe('pool down');
  });
});

describe('listEntryVersions', () => {
  it('answers the lineage newest first with the current edition marked', async () => {
    mockListVersions.mockResolvedValue([
      { version: 2, change_summary: null, created_at: '2026-08-17T00:00:00Z', is_current: true },
      { version: 1, change_summary: null, created_at: '2026-08-16T00:00:00Z', is_current: false },
    ]);
    const result = await listEntryVersions({ domain: 'catalog', key: 'materials' });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({
      domain: 'catalog',
      key: 'materials',
      versions: [
        { version: 2, change_summary: null, created_at: '2026-08-17T00:00:00Z', is_current: true },
        { version: 1, change_summary: null, created_at: '2026-08-16T00:00:00Z', is_current: false },
      ],
    });
  });

  it('answers an empty lineage for an unknown entry', async () => {
    mockListVersions.mockResolvedValue([]);
    const result = await listEntryVersions({ domain: 'catalog', key: 'ghost' });
    expect(result.status).toBe(200);
    expect(result.data).toEqual({ domain: 'catalog', key: 'ghost', versions: [] });
  });

  it('maps a service failure to 500', async () => {
    mockListVersions.mockRejectedValue(new Error('pool down'));
    const result = await listEntryVersions({ domain: 'catalog', key: 'materials' });
    expect(result.status).toBe(500);
  });
});
