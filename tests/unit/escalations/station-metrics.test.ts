import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VALID_PERIODS } from '../../../services/escalation/types';

vi.mock('../../../lib/db', () => ({
  getPool: vi.fn(),
}));

// getStationMetrics awaits the compat-view ensure before querying (like every
// other read path); the view install is client.ts's concern, not this unit's.
vi.mock('../../../services/escalation/client', () => ({
  escalations: vi.fn(),
  ensureEscalationCompatView: vi.fn().mockResolvedValue(undefined),
}));

import { getPool } from '../../../lib/db';
import { getStationMetrics, resetStationMetricsCache } from '../../../services/escalation/queries';

const mockQuery = vi.fn();
vi.mocked(getPool).mockReturnValue({ query: mockQuery } as any);

// ── VALID_PERIODS ──────────────────────────────────────────────────────────────

describe('VALID_PERIODS', () => {
  it('includes 15m as a valid period', () => {
    expect(VALID_PERIODS['15m']).toBe('15 minutes');
  });

  it('includes the four standard periods', () => {
    expect(VALID_PERIODS['1h']).toBe('1 hour');
    expect(VALID_PERIODS['24h']).toBe('24 hours');
    expect(VALID_PERIODS['7d']).toBe('7 days');
    expect(VALID_PERIODS['30d']).toBe('30 days');
  });

  it('has exactly 5 entries', () => {
    expect(Object.keys(VALID_PERIODS)).toHaveLength(5);
  });
});

// ── getStationMetrics (service) ───────────────────────────────────────────────

describe('getStationMetrics', () => {
  // The period-metrics half is cached in-process; clear it so each test starts
  // from a cold cache and observes its own mock rows.
  beforeEach(() => { vi.clearAllMocks(); resetStationMetricsCache(); });

  function mockRow(overrides: Record<string, any> = {}): Record<string, any> {
    return {
      role: 'reviewer',
      pending: 5,
      claimed: 1,
      resolved: 42,
      priority_count: 0,
      throughput_pct: '87.5',
      p99_wait_min: '0.017',
      p50_wait_min: '0.012',
      avg_wait_min: '0.015',
      max_wait_min: '0.050',
      p99_work_min: '0.667',
      p50_work_min: '0.500',
      avg_work_min: '0.550',
      max_work_min: '0.900',
      ...overrides,
    };
  }

  it('maps throughput_pct from the SQL row to a number', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow()] });
    const result = await getStationMetrics(undefined, '24h');
    expect(result[0].throughput_pct).toBe(87.5);
  });

  it('sets throughput_pct to null when the SQL column returns null (no target configured)', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow({ throughput_pct: null })] });
    const result = await getStationMetrics(undefined, '24h');
    expect(result[0].throughput_pct).toBeNull();
  });

  it('maps wait and work sub-percentiles to numbers', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow()] });
    const [station] = await getStationMetrics(undefined, '1h');
    expect(station.wait.p99).toBeCloseTo(0.017);
    expect(station.work.p99).toBeCloseTo(0.667);
    expect(station.wait.avg).toBeCloseTo(0.015);
    expect(station.work.avg).toBeCloseTo(0.550);
  });

  it('preserves nulls for percentile columns when no resolved data in period', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow({
      p99_wait_min: null, p50_wait_min: null, avg_wait_min: null, max_wait_min: null,
      p99_work_min: null, p50_work_min: null, avg_work_min: null, max_work_min: null,
    })] });
    const [station] = await getStationMetrics(undefined, '15m');
    expect(station.wait.p99).toBeNull();
    expect(station.work.p99).toBeNull();
  });

  it('passes 15m as the interval when period is "15m"', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getStationMetrics(undefined, '15m');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['15 minutes']),
    );
  });

  it('defaults to 24h interval for an unknown period', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getStationMetrics(undefined, 'bogus');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      expect.arrayContaining(['24 hours']),
    );
  });

  it('passes role filter as first param when visibleRoles is given', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getStationMetrics(['reviewer', 'grinder'], '24h');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [['reviewer', 'grinder'], '24 hours'],
    );
  });

  it('passes null as first param for global (unrestricted) access', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await getStationMetrics(undefined, '24h');
    expect(mockQuery).toHaveBeenCalledWith(
      expect.any(String),
      [null, '24 hours'],
    );
  });

  it('returns an empty array when no rows match', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const result = await getStationMetrics(['nobody'], '24h');
    expect(result).toEqual([]);
  });

  it('merges live counts with period metrics into one station', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow()] });
    const [station] = await getStationMetrics(undefined, '24h');
    // counts come from the live query, percentiles/throughput from the period query
    expect(station.pending).toBe(5);
    expect(station.claimed).toBe(1);
    expect(station.resolved).toBe(42);
    expect(station.throughput_pct).toBe(87.5);
    expect(station.work.p99).toBeCloseTo(0.667);
  });

  it('maps priority_count from the live row to a number', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow({ priority_count: '3' })] });
    const [station] = await getStationMetrics(undefined, '24h');
    expect(station.priority_count).toBe(3);
  });

  it('defaults priority_count to 0 when the SQL column is absent', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow({ priority_count: undefined })] });
    const [station] = await getStationMetrics(undefined, '24h');
    expect(station.priority_count).toBe(0);
  });

  it('serves period metrics from cache on a repeat call but re-queries live counts', async () => {
    mockQuery.mockResolvedValue({ rows: [mockRow()] });

    await getStationMetrics(undefined, '24h');
    const afterFirst = mockQuery.mock.calls.length;   // 2: live counts + period metrics

    await getStationMetrics(undefined, '24h');
    const afterSecond = mockQuery.mock.calls.length;

    // Second call re-runs only the live-counts query; period metrics are cached.
    expect(afterFirst).toBe(2);
    expect(afterSecond - afterFirst).toBe(1);
  });
});
