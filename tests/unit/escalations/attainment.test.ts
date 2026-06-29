import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockQuery = vi.fn();

vi.mock('../../../lib/db', () => ({
  getPool: () => ({ query: mockQuery }),
}));
// Neutralize the compat-view ensure (it would touch the real DB / hotmesh client).
vi.mock('../../../services/escalation/client', () => ({
  ensureEscalationCompatView: vi.fn().mockResolvedValue(undefined),
}));

import { computeAttainment, computeServicerProfile } from '../../../services/escalation/attainment';

/** The aggregation query is the one running percentile_cont. */
const dataCalls = () => mockQuery.mock.calls.filter((c) => /percentile_cont/.test(c[0] as string));
const dataCall = () => dataCalls()[0];

beforeEach(() => {
  mockQuery.mockReset();
  mockQuery.mockResolvedValue({ rows: [] });
});

const NOW = 1_000_000; // fixed epoch so the window is deterministic

describe('computeAttainment (station lens)', () => {
  it('issues exactly ONE aggregation query — no N+1', async () => {
    await computeAttainment({ role: 'r', range: '1h', nowEpoch: NOW, scope: { global: true } });
    expect(dataCalls()).toHaveLength(1);
  });

  it('binds the leading params in order and derives the window from the range', async () => {
    await computeAttainment({ role: 'printer-pool-standard', range: '1h', nowEpoch: NOW, scope: { global: true } });
    const [, params] = dataCall();
    // role, stationFacet, start, end, bucketSeconds, nBuckets (no unitFacet here)
    expect(params.slice(0, 2)).toEqual(['printer-pool-standard', 'station']);
    expect(params[2]).toBe(NOW - 3600); // 1h window start
    expect(params[3]).toBe(NOW);        // window end
    expect(params[4]).toBe(300);        // 5-minute buckets
    expect(params[5]).toBe(12);         // 3600 / 300 buckets
  });

  it('omits the read-scope predicate for global access', async () => {
    await computeAttainment({ role: 'r', range: '1h', nowEpoch: NOW, scope: { global: true } });
    expect(dataCall()[0]).not.toMatch(/::text\[\]/);
  });

  it('folds the read-scope predicate into the WHERE for a scoped caller', async () => {
    await computeAttainment({
      role: 'r',
      range: '1h',
      nowEpoch: NOW,
      scope: { global: false, visibleRoles: ['r'], selfRoles: [], meUserId: 'u-1' },
    });
    const [sql, params] = dataCall();
    expect(sql).toMatch(/role = ANY\(/);
    expect(sql).toMatch(/assigned_to = \$/);
    expect(params).toContainEqual(['r']); // visibleRoles bound
    expect(params).toContain('u-1');      // meUserId bound
  });

  it('folds a FacetQuery containment filter into the same scan', async () => {
    await computeAttainment({
      role: 'r',
      range: '1h',
      nowEpoch: NOW,
      facet: { facets: { filament: 'pla' } },
      scope: { global: true },
    });
    const [sql, params] = dataCall();
    expect(sql).toMatch(/metadata @> \$/);
    expect(params).toContain(JSON.stringify({ filament: 'pla' }));
  });

  it('divides duration by a unit facet for per-unit TAT when provided', async () => {
    await computeAttainment({ role: 'r', range: '1h', nowEpoch: NOW, unitFacet: 'unitsPrinted', scope: { global: true } });
    const [sql, params] = dataCall();
    expect(sql).toMatch(/per_unit_secs/);
    expect(sql).toMatch(/GREATEST\(COALESCE\(\(metadata ->> \$/);
    expect(params).toContain('unitsPrinted');
  });

  it('computes attainment as target ÷ measured per-unit TAT (the 100% line)', async () => {
    await computeAttainment({ role: 'r', range: '1h', nowEpoch: NOW, scope: { global: true } });
    const [sql] = dataCall();
    expect(sql).toMatch(/target_tat_seconds \* 1000\) \/ a\.tat_p50_ms \* 100/);
    expect(sql).toMatch(/LEFT JOIN lt_role_dials/);
  });

  it('maps a row to a typed AttainmentBucket', async () => {
    const start = new Date();
    const end = new Date();
    mockQuery.mockResolvedValue({
      rows: [{
        station_key: 'gluing', idx: 0, bucket_start: start, bucket_end: end,
        target_tat_ms: 60000, tat_p50_ms: 50000, tat_p99_ms: 59000, attainment_pct: 120, count_resolved: 3,
      }],
    });
    const out = await computeAttainment({ role: 'r', range: '1h', nowEpoch: NOW, scope: { global: true } });
    expect(out[0]).toEqual({
      stationKey: 'gluing', bucketStart: start, bucketEnd: end,
      targetTatMs: 60000, tatP50Ms: 50000, tatP99Ms: 59000, attainmentPct: 120, countResolved: 3,
    });
  });
});

describe('computeServicerProfile (servicer lens)', () => {
  it('pivots the grouping key to assigned_to without a cohort join', async () => {
    await computeServicerProfile({ role: 'r', range: '1h', nowEpoch: NOW, scope: { global: true } });
    const [sql] = dataCall();
    expect(sql).toMatch(/GROUP BY s\.assigned_to/);
    expect(sql).not.toMatch(/lt_users/);
  });

  it('joins lt_users and groups by account_type for the AI-vs-human cohort', async () => {
    await computeServicerProfile({
      role: 'r', range: '1h', nowEpoch: NOW, cohortBy: 'account_type', scope: { global: true },
    });
    const [sql] = dataCall();
    expect(sql).toMatch(/LEFT JOIN lt_users u ON u\.id::text = s\.assigned_to/);
    expect(sql).toMatch(/GROUP BY u\.account_type/);
  });

  it('filters to a single identity when assignedTo is set', async () => {
    await computeServicerProfile({ role: 'r', range: '1h', nowEpoch: NOW, assignedTo: 'user-42', scope: { global: true } });
    expect(dataCall()[1]).toContain('user-42');
  });

  it('maps a row to a typed ServicerBucket', async () => {
    mockQuery.mockResolvedValue({
      rows: [{ servicer_key: 'bot', count_resolved: 12, tat_p50_ms: 800, tat_p99_ms: 3000 }],
    });
    const out = await computeServicerProfile({ role: 'r', range: '1h', nowEpoch: NOW, cohortBy: 'account_type', scope: { global: true } });
    expect(out[0]).toEqual({ servicerKey: 'bot', countResolved: 12, tatP50Ms: 800, tatP99Ms: 3000 });
  });
});
