import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure-unit: mock the DB pool + client so no HotMesh/DB boots.
const mockQuery = vi.fn();
vi.mock('../../../lib/db', () => ({ getPool: vi.fn(() => ({ query: mockQuery })) }));
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(async () => ({})),
  ensureEscalationCompatView: vi.fn(async () => {}),
}));

import { searchEscalationsFaceted } from '../../../services/escalation/queries';

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] });
});

const selectCall = () => mockQuery.mock.calls.find(([sql]) => String(sql).includes('LIMIT'));
const countCall = () => mockQuery.mock.calls.find(([sql]) => String(sql).includes('COUNT('));

describe('searchEscalationsFaceted — scoped faceted query', () => {
  it('composes the read-scope predicate with a metadata @> facet, both IN SQL', async () => {
    await searchEscalationsFaceted({
      visibleRoles: ['reviewer'], selfRoles: [], meUserId: 'u1',
      facet: { facets: { orderId: 'o-1' } },
      limit: 25, offset: 0,
    });
    const [sql, params] = selectCall()!;
    expect(sql).toContain('role = ANY($1)');        // read_all scope
    expect(sql).toContain('metadata @> $');         // facet — GIN-served
    expect(sql).toContain('LIMIT');
    expect(params[0]).toEqual(['reviewer']);        // $1 allRoles
    expect(params[3]).toBe(JSON.stringify({ orderId: 'o-1' })); // $4 facets
  });

  it('the COUNT shares the WHERE and omits limit/offset (totals stay correct)', async () => {
    await searchEscalationsFaceted({
      visibleRoles: ['reviewer'], selfRoles: [], meUserId: 'u1',
      facet: { facets: { orderId: 'o-1' } }, limit: 10, offset: 5,
    });
    const [csql, cparams] = countCall()!;
    expect(csql).toContain('COUNT(*)');
    expect(csql).not.toContain('LIMIT');
    expect(cparams).toHaveLength(4); // scope(3) + facet(1), no page params
  });

  it('global access skips the scope predicate entirely', async () => {
    await searchEscalationsFaceted({ global: true, facet: { facets: { a: 1 } }, limit: 10, offset: 0 });
    const [sql, params] = selectCall()!;
    expect(sql).not.toContain('role = ANY($1)');
    expect(params[0]).toBe(JSON.stringify({ a: 1 })); // facet is the first param
  });

  it('emits range, exists and block clauses', async () => {
    await searchEscalationsFaceted({
      global: true,
      facet: { range: [{ facet: 'size', op: '<=', value: 13 }], exists: ['flag'], block: [{ bad: true }] },
      limit: 10, offset: 0,
    });
    const [sql] = selectCall()!;
    expect(sql).toContain("(metadata->>'size')::numeric <=");
    expect(sql).toContain("metadata ? 'flag'");
    expect(sql).toContain('NOT (metadata @> ANY(');
  });

  it('self-scope adds the assigned_to ownership branch', async () => {
    await searchEscalationsFaceted({
      visibleRoles: [], selfRoles: ['reviewer'], meUserId: 'u1',
      facet: {}, limit: 10, offset: 0,
    });
    const [sql] = selectCall()!;
    expect(sql).toContain('assigned_to = $3');
  });
});
