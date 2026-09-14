import { describe, it, expect, vi, beforeEach } from 'vitest';

// A pinned edition either exists or the message names what does.
const mockSnapshot = vi.fn();
const mockQuery = vi.fn();
vi.mock('../../../services/knowledge/lookup-cache', () => ({ getKnowledgeSnapshot: (...a: unknown[]) => mockSnapshot(...a) }));
vi.mock('../../../lib/db', () => ({ getPool: () => ({ query: (...a: unknown[]) => mockQuery(...a) }) }));

import { describeMissingLookupRefs } from '../../../services/knowledge/lookup-refs';

beforeEach(() => vi.clearAllMocks());

describe('describeMissingLookupRefs', () => {
  it('is silent when every pinned edition exists', async () => {
    mockSnapshot.mockResolvedValue({ data: {}, tags: [] });
    expect(await describeMissingLookupRefs([{ domain: 'fleet', key: 'serial-numbers', version: 1 }])).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('names the editions that exist when the pin misses', async () => {
    mockSnapshot.mockResolvedValue(null);
    mockQuery.mockResolvedValue({ rows: [{ version: 2 }, { version: 1 }] });
    expect(await describeMissingLookupRefs([{ domain: 'fleet', key: 'serial-numbers', version: 3 }]))
      .toEqual(['Lookup ref fleet/serial-numbers v3 names no edition (editions: v1, v2)']);
  });

  it('says so when the entry itself does not exist', async () => {
    mockSnapshot.mockResolvedValue(null);
    mockQuery.mockResolvedValue({ rows: [] });
    expect(await describeMissingLookupRefs([{ domain: 'fleet', key: 'serial-number', version: 1, as: 'serials' }]))
      .toEqual(['Lookup ref fleet/serial-number v1 names no edition (no knowledge entry fleet/serial-number)']);
  });
});
