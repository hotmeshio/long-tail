import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({ getPool: vi.fn(() => ({ query: mockQuery })) }));
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(async () => ({})),
  ensureEscalationCompatView: vi.fn(async () => {}),
}));

import { listFacetKeys } from '../../../services/escalation/queries';

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [{ key: 'confidence' }, { key: 'source' }] });
});

describe('listFacetKeys — scoped distinct metadata keys', () => {
  it('unpacks only object-typed metadata and applies the read-scope predicate', async () => {
    const keys = await listFacetKeys({ visibleRoles: ['reviewer'], selfRoles: [], meUserId: 'u1' });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain('jsonb_object_keys(metadata)');
    expect(sql).toContain("jsonb_typeof(metadata) = 'object'");
    expect(sql).toContain('role = ANY($1)');
    expect(params[0]).toEqual(['reviewer']);
    expect(keys).toEqual(['confidence', 'source']);
  });

  it('global access skips the scope predicate', async () => {
    await listFacetKeys({ global: true });
    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).not.toContain('role = ANY($1)');
    expect(params).toHaveLength(0);
  });
});
