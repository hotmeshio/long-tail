import { describe, it, expect, vi, beforeEach } from 'vitest';

// Pure-unit: mock the DB pool/client and the compat-view ensure so no HotMesh/DB
// is booted. We assert the SQL each function issues and how it maps rows back.
const mockQuery = vi.fn();
const mockClientQuery = vi.fn();
const mockRelease = vi.fn();
const mockConnect = vi.fn(async () => ({ query: mockClientQuery, release: mockRelease }));

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(() => ({ query: mockQuery, connect: mockConnect })),
}));
vi.mock('../../../services/escalation/client', () => ({
  ensureEscalationCompatView: vi.fn(async () => {}),
}));

import {
  searchByFacets,
  searchGroups,
  countByFacets,
  claimGroups,
  claimByFacets,
} from '../../../services/escalation/facets';

beforeEach(() => {
  mockQuery.mockReset().mockResolvedValue({ rows: [] }); // covers the lazy CREATE INDEX
  mockClientQuery.mockReset();
  mockRelease.mockReset();
  mockConnect.mockClear();
});

/** Last pool.query call whose SQL matches a predicate. */
function poolCall(match: (sql: string) => boolean) {
  return [...mockQuery.mock.calls].reverse().find(([sql]) => match(String(sql)));
}
const clientSqls = () => mockClientQuery.mock.calls.map(([sql]) => String(sql));

describe('searchByFacets', () => {
  it('reads the view, maps rows, and returns the total', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('AS total')) return Promise.resolve({ rows: [{ total: 2 }] });
      if (sql.includes('SELECT *')) return Promise.resolve({ rows: [{ id: 'e1' }, { id: 'e2' }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await searchByFacets({ role: 'diabetic-print', status: 'pending', facets: { regulated: true } });

    expect(result.total).toBe(2);
    expect(result.escalations.map((e) => e.id)).toEqual(['e1', 'e2']);
    const select = poolCall((s) => s.includes('SELECT *'))!;
    expect(String(select[0])).toContain('FROM public.lt_escalations');
    expect(String(select[0])).toContain('role = $1');
    expect(String(select[0])).toContain('metadata @> $'); // GIN containment for facets
    expect(select[1]).toContain('diabetic-print');
  });
});

describe('searchGroups', () => {
  it('maps origin rows into group summaries', async () => {
    mockQuery.mockImplementation((sql: string) => {
      if (sql.includes('GROUP BY origin_id')) {
        return Promise.resolve({
          rows: [{ origin_id: 'o1', member_count: 3, order_size: 3, available: true, complete: true, min_priority: 2, created_at: new Date(0) }],
        });
      }
      return Promise.resolve({ rows: [] });
    });

    const groups = await searchGroups({ role: 'pond' }, { sizeFacet: 'orderSize' });

    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ originId: 'o1', memberCount: 3, orderSize: 3, available: true, complete: true, minPriority: 2 });
  });
});

describe('countByFacets', () => {
  it('returns the aggregate count', async () => {
    mockQuery.mockImplementation((sql: string) =>
      sql.includes('AS n') ? Promise.resolve({ rows: [{ n: 7 }] }) : Promise.resolve({ rows: [] }),
    );
    expect(await countByFacets({ role: 'pond', status: 'pending' })).toBe(7);
  });
});

describe('claimGroups', () => {
  it('claims a complete, available group inside one transaction', async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return Promise.resolve({});
      if (s.includes('GROUP BY origin_id')) return Promise.resolve({ rows: [{ origin_id: 'o1' }] }); // candidates
      if (s.includes('FOR UPDATE SKIP LOCKED')) return Promise.resolve({ rows: [{ id: 'm1', order_size: 1, avail: true }] });
      if (s.includes('SET assigned_to')) return Promise.resolve({ rows: [{ id: 'm1' }] });
      return Promise.resolve({ rows: [] });
    });

    const claimed = await claimGroups({ role: 'pond' }, 'broker-1', { limit: 1, sizeFacet: 'orderSize' });

    expect(claimed).toHaveLength(1);
    expect(claimed[0].originId).toBe('o1');
    expect(claimed[0].members.map((m) => m.id)).toEqual(['m1']);
    expect(clientSqls()).toContain('BEGIN');
    expect(clientSqls()).toContain('COMMIT');
    expect(mockRelease).toHaveBeenCalled();
  });

  it('skips an incomplete group (declared size exceeds members)', async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return Promise.resolve({});
      if (s.includes('GROUP BY origin_id')) return Promise.resolve({ rows: [{ origin_id: 'o1' }] });
      if (s.includes('FOR UPDATE SKIP LOCKED')) return Promise.resolve({ rows: [{ id: 'm1', order_size: 4, avail: true }] }); // 1 of 4
      return Promise.resolve({ rows: [] });
    });

    const claimed = await claimGroups({ role: 'pond' }, 'broker-1', { limit: 1 });
    expect(claimed).toEqual([]);
    expect(clientSqls()).toContain('COMMIT'); // transaction still closes cleanly
  });
});

describe('claimByFacets', () => {
  function withClaim(rows: Array<{ id: string }>) {
    mockClientQuery.mockImplementation((sql: string) => {
      const s = String(sql);
      if (s === 'BEGIN' || s === 'COMMIT' || s === 'ROLLBACK') return Promise.resolve({});
      if (s.includes('WITH locked AS')) return Promise.resolve({ rows });
      return Promise.resolve({ rows: [] });
    });
  }

  it('batch-claims up to the limit and commits, mapping the rows', async () => {
    withClaim([{ id: 'p1' }, { id: 'p2' }]);
    const claimed = await claimByFacets({ role: 'pool', facets: { state: 'ready' } }, 'broker-1', { limit: 2 });

    expect(claimed.map((e) => e.id)).toEqual(['p1', 'p2']);
    expect(clientSqls()).toContain('COMMIT');
    expect(clientSqls()).not.toContain('ROLLBACK');
    expect(mockRelease).toHaveBeenCalled();
    const update = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('WITH locked AS'))!;
    expect(String(update[0])).toContain('FOR UPDATE SKIP LOCKED');
    expect(String(update[0])).toContain('LIMIT 2');
  });

  it('allOrNone: rolls back and returns [] when fewer than the limit are lockable', async () => {
    withClaim([{ id: 'p1' }]); // only 1 of 2
    const claimed = await claimByFacets({ role: 'pool' }, 'broker-1', { limit: 2, allOrNone: true });

    expect(claimed).toEqual([]);
    expect(clientSqls()).toContain('ROLLBACK');
    expect(clientSqls()).not.toContain('COMMIT');
  });

  it('allOrNone: commits when the full set is acquired', async () => {
    withClaim([{ id: 'p1' }, { id: 'p2' }]);
    const claimed = await claimByFacets({ role: 'pool' }, 'broker-1', { limit: 2, allOrNone: true });

    expect(claimed.map((e) => e.id)).toEqual(['p1', 'p2']);
    expect(clientSqls()).toContain('COMMIT');
  });

  it('rolls back and returns [] when nothing is eligible', async () => {
    withClaim([]);
    const claimed = await claimByFacets({ role: 'pool' }, 'broker-1', { limit: 3 });

    expect(claimed).toEqual([]);
    expect(clientSqls()).toContain('ROLLBACK');
  });

  it('forces available-only, pending claims (the query the dispatcher wants)', async () => {
    withClaim([{ id: 'p1' }]);
    await claimByFacets({ role: 'pool', facets: { state: 'ready' } }, 'broker-1', { limit: 1 });

    const update = mockClientQuery.mock.calls.find(([sql]) => String(sql).includes('WITH locked AS'))!;
    const sql = String(update[0]);
    expect(sql).toContain('assigned_until <= NOW()'); // available = true forced
    expect(sql).toContain('status = $');
  });
});
