import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure-unit: mock the DB pool and the escalation client so no HotMesh/DB is booted.
const mockQuery = vi.fn();
const mockList = vi.fn();
const mockCount = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery })),
}));
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(async () => ({ list: mockList, count: mockCount })),
  ensureEscalationCompatView: vi.fn(async () => {}),
}));

import { listEscalations, listAvailableEscalations } from '../../../services/escalation/queries';

beforeEach(() => {
  mockQuery.mockReset();
  mockList.mockReset().mockResolvedValue([]);
  mockCount.mockReset().mockResolvedValue(0);
});

/** Find the SELECT (paginated) call among the two issued by the search path. */
function selectCall() {
  return mockQuery.mock.calls.find(([sql]) => String(sql).includes('LIMIT'));
}
function countCall() {
  return mockQuery.mock.calls.find(([sql]) => String(sql).includes('COUNT('));
}

describe('listEscalations — server-side search path', () => {
  it('runs the ILIKE SQL (not the SDK list) when search is provided', async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })            // SELECT
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }); // COUNT

    const result = await listEscalations({ search: 'orderId', limit: 25, offset: 0 });
    expect(result).toEqual({ escalations: [], total: 0 });

    // SDK list path is bypassed
    expect(mockList).not.toHaveBeenCalled();

    const [sql, params] = selectCall()!;
    expect(sql).toContain('ILIKE');
    expect(sql).toContain('metadata::text ILIKE');
    expect(params[8]).toBe('orderId'); // search term ($9)
    expect(params[9]).toBeNull();      // selfRoles ($10) — no self scope
    expect(params[10]).toBeNull();     // meUserId ($11)
    expect(params[11]).toBeNull();     // metadata ($12) — no metadata filter
    expect(params[12]).toBe(25);       // limit ($13)
    expect(params[13]).toBe(0);        // offset ($14)

    // Count shares the 12 filter params (incl. selfRoles/meUserId/metadata), no limit/offset
    const [, countParams] = countCall()!;
    expect(countParams).toHaveLength(12);
    expect(countParams[8]).toBe('orderId');
  });

  it('maps claimed/assigned_to to available=false in the search params', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await listEscalations({ search: 'A1', claimed: true, limit: 10, offset: 0 });
    const [, params] = selectCall()!;
    expect(params[7]).toBe(false); // available ($8)
  });

  it('uses a whitelisted ORDER BY and ignores an unsafe sort_by', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await listEscalations({ search: 'x', sort_by: 'created_at', order: 'asc', limit: 5, offset: 0 });
    expect(selectCall()![0]).toContain('ORDER BY created_at ASC');

    mockQuery.mockClear();
    mockQuery.mockResolvedValue({ rows: [] });
    await listEscalations({ search: 'x', sort_by: 'col; DROP TABLE x', limit: 5, offset: 0 });
    // Falls back to the safe default — the injection string is never interpolated
    const sql = selectCall()![0];
    expect(sql).toContain('ORDER BY priority ASC, created_at ASC');
    expect(sql).not.toContain('DROP TABLE');
  });

  it('coerces empty-string filters to NULL so they do not match zero rows', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await listEscalations({ search: 'intake', role: '', type: '', assigned_to: '', visibleRoles: [], limit: 5, offset: 0 });
    const [, params] = selectCall()!;
    expect(params[1]).toBeNull(); // role ($2)
    expect(params[2]).toBeNull(); // roles ($3) — empty array → null
    expect(params[3]).toBeNull(); // type ($4)
    expect(params[6]).toBeNull(); // assigned_to ($7)
    expect(params[8]).toBe('intake');
  });

  it('takes the SDK list path (no raw SQL) when search is absent', async () => {
    await listEscalations({ status: 'pending', limit: 25, offset: 0 });
    expect(mockList).toHaveBeenCalled();
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it('routes through raw SQL (not the SDK) when read_self scope is present, even with no search', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await listEscalations({
      visibleRoles: ['reviewer'],
      selfRoles: ['customer-triage'],
      meUserId: 'user-9',
      limit: 25,
      offset: 0,
    });

    // SDK list cannot express (role ∈ selfRoles AND assigned_to = me) → SQL path
    expect(mockList).not.toHaveBeenCalled();
    const [sql, params] = selectCall()!;
    expect(sql).toContain('assigned_to = $11');
    expect(params[2]).toEqual(['reviewer']);          // allRoles ($3)
    expect(params[8]).toBeNull();                      // search ($9) — absent
    expect(params[9]).toEqual(['customer-triage']);    // selfRoles ($10)
    expect(params[10]).toBe('user-9');                 // meUserId ($11)
  });
});

describe('listAvailableEscalations — server-side search path', () => {
  it('forces status=pending and available=true in the search params', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await listAvailableEscalations({ search: 'ticket-9', limit: 25, offset: 0 });

    expect(mockList).not.toHaveBeenCalled();
    const [, params] = selectCall()!;
    expect(params[0]).toBe('pending'); // status ($1)
    expect(params[7]).toBe(true);      // available ($8)
    expect(params[8]).toBe('ticket-9');
  });
});
