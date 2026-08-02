import { describe, it, expect, vi, beforeEach } from 'vitest';

const query = vi.fn();
vi.mock('../../../lib/db', () => ({ getPool: () => ({ query }) }));
vi.mock('../../../services/escalation/facets', async (importOriginal) => ({
  ...(await importOriginal<any>()),
  ensureFacetReady: vi.fn().mockResolvedValue(undefined),
}));

import {
  aggregateByFacets,
  timelineByFacet,
  resolveEntitySystem,
  resetAnalyticsCaches,
  clearNowAnchoredAnalyticsCache,
} from '../../../services/escalation/aggregates';
import { AnalyticsInputError } from '../../../services/escalation/aggregate-validate';

const SYSTEM_ROWS = [
  { role: 'printer-fleet', entity_state_source: 'subtype' },
  { role: 'printer-harvest', entity_state_source: 'role' },
];

/** query() answers entity-system lookups from SYSTEM_ROWS and data reads with `dataRows`. */
function stubQueries(dataRows: any[]) {
  query.mockImplementation(async (sql: string) =>
    sql.includes('FROM lt_roles')
      ? { rows: SYSTEM_ROWS }
      : { rows: dataRows },
  );
}

beforeEach(() => {
  query.mockReset();
  resetAnalyticsCaches();
});

describe('resolveEntitySystem', () => {
  it('is loud when no role declares the key — a config gap, not an empty result', async () => {
    query.mockResolvedValue({ rows: [] });
    await expect(resolveEntitySystem('serialNumber')).rejects.toThrow(AnalyticsInputError);
    await expect(resolveEntitySystem('serialNumber')).rejects.toThrow(/no roles declare/);
  });

  it('returns each role with its state naming', async () => {
    query.mockResolvedValue({ rows: SYSTEM_ROWS });
    await expect(resolveEntitySystem('serialNumber')).resolves.toEqual([
      { role: 'printer-fleet', source: 'subtype' },
      { role: 'printer-harvest', source: 'role' },
    ]);
  });
});

describe('aggregateByFacets — caching', () => {
  const nowInput = () => ({
    query: { roles: ['printer-fleet'] },
    groupBy: {},
    measure: { kind: 'membership' } as const,
  });

  it('canonicalizes the cache key: key order does not double-compute', async () => {
    stubQueries([{ sample_count: 1, count: 1 }]);
    await aggregateByFacets({ ...nowInput(), query: { roles: ['printer-fleet'], exists: ['a'] } });
    const dataCalls = () => query.mock.calls.filter(([sql]) => !sql.includes('FROM lt_roles')).length;
    const after = dataCalls();
    await aggregateByFacets({ query: { exists: ['a'], roles: ['printer-fleet'] } as any, groupBy: {}, measure: { kind: 'membership' } });
    expect(dataCalls()).toBe(after);
  });

  it('now-anchored entries clear on escalation writes; fully-past entries survive', async () => {
    stubQueries([{ sample_count: 1, count: 1 }]);
    const past = {
      query: { roles: ['printer-fleet'] },
      groupBy: {},
      measure: {
        kind: 'dwell' as const,
        window: {
          from: new Date(Date.now() - 7_200_000).toISOString(),
          to: new Date(Date.now() - 3_600_000).toISOString(),
        },
      },
    };
    await aggregateByFacets(nowInput());
    await aggregateByFacets(past);
    const dataCalls = () => query.mock.calls.filter(([sql]) => !sql.includes('FROM lt_roles')).length;
    const before = dataCalls();

    clearNowAnchoredAnalyticsCache();
    await aggregateByFacets(nowInput()); // recomputes
    await aggregateByFacets(past); // still cached
    expect(dataCalls()).toBe(before + 1);
  });

  it('the resolved system joins the cache key — a role-config edit changes the key', async () => {
    stubQueries([{ sample_count: 1, count: 1 }]);
    const input = { query: { entity: 'serialNumber' }, groupBy: { state: true }, measure: { kind: 'membership' } as const };
    await aggregateByFacets(input);
    const dataCalls = () => query.mock.calls.filter(([sql]) => !sql.includes('FROM lt_roles')).length;
    const before = dataCalls();

    // Same input, same system → cache hit (no new data query).
    await aggregateByFacets(input);
    expect(dataCalls()).toBe(before);

    // The system changes (dial edit) → new key → recompute.
    SYSTEM_ROWS[0].entity_state_source = 'role';
    try {
      await aggregateByFacets(input);
      expect(dataCalls()).toBe(before + 1);
    } finally {
      SYSTEM_ROWS[0].entity_state_source = 'subtype';
    }
  });

  it('signals overflow when the SQL returns pageLimit + 1 rows', async () => {
    stubQueries([
      { sample_count: 1, count: 1 },
      { sample_count: 2, count: 2 },
      { sample_count: 3, count: 3 },
    ]);
    const result = await aggregateByFacets({ ...nowInput(), limit: 2 });
    expect(result.groups).toHaveLength(2);
    expect(result.overflow).toBe(true);
  });
});

describe('timelineByFacet', () => {
  it('maps rows to intervals with null endedAt for open rows', async () => {
    stubQueries([
      {
        role: 'printer-fleet', subtype: 'printing', status: 'resolved',
        started_at: '2026-08-01T10:00:00.000Z', ended_at: '2026-08-01T11:00:00.000Z', duration_seconds: 3600,
      },
      {
        role: 'printer-harvest', subtype: null, status: 'pending',
        started_at: '2026-08-01T11:05:00.000Z', ended_at: null, duration_seconds: 60,
      },
    ]);
    const result = await timelineByFacet({ facet: { key: 'serialNumber', value: 'SN-1' } });
    expect(result.intervals[0]).toMatchObject({
      role: 'printer-fleet', subtype: 'printing', endedAt: '2026-08-01T11:00:00.000Z', durationSeconds: 3600,
    });
    expect(result.intervals[1].endedAt).toBeNull();
    expect(result.overflow).toBe(false);
  });
});
