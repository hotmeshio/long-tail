import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({ getPool: vi.fn(() => ({ query: mockQuery })) }));
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(async () => ({})),
  ensureEscalationCompatView: vi.fn(async () => {}),
}));

import { listFacetValues } from '../../../services/escalation/queries';

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [{ value: 'north' }, { value: 'south' }] });
});

describe('listFacetValues — scoped distinct facet values', () => {
  it('binds the key as $1 and applies the read-scope predicate', async () => {
    const values = await listFacetValues('facility', { visibleRoles: ['gluer'], selfRoles: [], meUserId: 'u1' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('metadata->>$1 AS value');
    expect(sql).toContain('metadata ? $1');
    expect(sql).toContain('role = ANY($2)');
    expect(params[0]).toBe('facility');
    expect(params[1]).toEqual(['gluer']);
    expect(values).toEqual(['north', 'south']);
  });

  it('global access skips the scope predicate', async () => {
    await listFacetValues('facility', { global: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('role = ANY');
    expect(params).toEqual(['facility']);
  });

  it('rejects a malformed key before any query (open-input guard)', async () => {
    const values = await listFacetValues('bad key!; drop', { global: true });
    expect(values).toEqual([]);
    expect(mockQuery).not.toHaveBeenCalled();
  });
});
