import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/escalation', () => ({
  listEscalations: vi.fn(),
  listAvailableEscalations: vi.fn(),
  searchEscalationsFaceted: vi.fn(),
  listFacetKeys: vi.fn(),
  listDistinctTypes: vi.fn(),
  getEscalationStats: vi.fn(),
  getStationMetrics: vi.fn(),
}));

vi.mock('../../../api/escalations/helpers', () => ({
  getEscalationReadScope: vi.fn(),
}));

import * as svc from '../../../services/escalation';
import { getEscalationReadScope } from '../../../api/escalations/helpers';
import {
  listEscalations,
  listAvailableEscalations,
  listFacetKeys,
  getEscalationStats,
  getStationMetrics,
} from '../../../api/escalations/list';

const mockScope = vi.mocked(getEscalationReadScope);
const mockList = vi.mocked(svc.listEscalations);
const mockAvail = vi.mocked(svc.listAvailableEscalations);
const mockFaceted = vi.mocked(svc.searchEscalationsFaceted);
const mockFacetKeys = vi.mocked(svc.listFacetKeys);
const mockStats = vi.mocked(svc.getEscalationStats);
const mockStations = vi.mocked(svc.getStationMetrics);

const GLOBAL = { global: true, allRoles: [], selfRoles: [] };
const SCOPED = { global: false, allRoles: ['reviewer', 'grinder'], selfRoles: [] };
const EMPTY  = { global: false, allRoles: [], selfRoles: [] };
const SELF   = { global: false, allRoles: [], selfRoles: ['reviewer'] };
const AUTH   = { userId: 'user-1' };

beforeEach(() => { vi.clearAllMocks(); });

// ── listEscalations ───────────────────────────────────────────────────────────

describe('listEscalations', () => {
  it('returns empty immediately when user has no roles', async () => {
    mockScope.mockResolvedValue(EMPTY);
    const result = await listEscalations({}, AUTH);
    expect(result).toEqual({ status: 200, data: { escalations: [], total: 0 } });
    expect(mockList).not.toHaveBeenCalled();
  });

  it('passes global scope to service (no role filter) for superadmin', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockList.mockResolvedValue({ escalations: [], total: 0 });
    await listEscalations({ status: 'pending' }, AUTH);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'pending', visibleRoles: undefined }),
    );
  });

  it('narrows to allRoles for scoped user on plain path', async () => {
    mockScope.mockResolvedValue(SCOPED);
    mockList.mockResolvedValue({ escalations: [], total: 0 });
    await listEscalations({ status: 'pending' }, AUTH);
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ visibleRoles: ['reviewer', 'grinder'] }),
    );
  });

  it('routes to searchEscalationsFaceted when facets are present', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockFaceted.mockResolvedValue({ escalations: [], total: 0 });
    await listEscalations({ facets: { station: 'qa' } }, AUTH);
    expect(mockFaceted).toHaveBeenCalled();
    expect(mockList).not.toHaveBeenCalled();
  });

  it('routes to faceted path when roles[] is set (cross-role scoping)', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockFaceted.mockResolvedValue({ escalations: [], total: 0 });
    await listEscalations({ roles: ['reviewer'] }, AUTH);
    expect(mockFaceted).toHaveBeenCalled();
  });

  it('routes to faceted path when range is set', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockFaceted.mockResolvedValue({ escalations: [], total: 0 });
    await listEscalations({ range: [{ facet: 'score', op: '>=', value: 80 }] }, AUTH);
    expect(mockFaceted).toHaveBeenCalled();
  });

  it('routes to faceted path when orderBy is set', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockFaceted.mockResolvedValue({ escalations: [], total: 0 });
    await listEscalations({ orderBy: [{ field: 'priority', direction: 'desc' }] }, AUTH);
    expect(mockFaceted).toHaveBeenCalled();
  });

  it('passes selfRoles to service for self-scope user — plain path handles self-scope internally', async () => {
    mockScope.mockResolvedValue(SELF);
    mockList.mockResolvedValue({ escalations: [], total: 0 });
    await listEscalations({}, AUTH);
    // No facet query → goes through plain listEscalations service path which
    // routes self-scope to its internal searchEscalations SQL branch
    expect(mockList).toHaveBeenCalledWith(
      expect.objectContaining({ selfRoles: ['reviewer'] }),
    );
  });

  it('returns 500 when service throws', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockList.mockRejectedValue(new Error('db error'));
    const result = await listEscalations({}, AUTH);
    expect(result).toEqual({ status: 500, error: 'db error' });
  });
});

// ── listAvailableEscalations ──────────────────────────────────────────────────

describe('listAvailableEscalations', () => {
  it('returns empty immediately when user has no roles', async () => {
    mockScope.mockResolvedValue(EMPTY);
    const result = await listAvailableEscalations({}, AUTH);
    expect(result.data).toEqual({ escalations: [], total: 0 });
    expect(mockAvail).not.toHaveBeenCalled();
  });

  it('forces available=true on faceted path (cannot be overridden)', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockFaceted.mockResolvedValue({ escalations: [], total: 0 });
    await listAvailableEscalations({ facets: { station: 'qa' } }, AUTH);
    expect(mockFaceted).toHaveBeenCalledWith(
      expect.objectContaining({ facet: expect.objectContaining({ available: true, status: 'pending' }) }),
    );
  });

  it('plain path call reaches service', async () => {
    mockScope.mockResolvedValue(SCOPED);
    mockAvail.mockResolvedValue({ escalations: [], total: 0 });
    const result = await listAvailableEscalations({ role: 'reviewer' }, AUTH);
    expect(result.status).toBe(200);
    expect(mockAvail).toHaveBeenCalled();
  });
});

// ── listFacetKeys ─────────────────────────────────────────────────────────────

describe('listFacetKeys', () => {
  it('returns empty keys when user has no roles', async () => {
    mockScope.mockResolvedValue(EMPTY);
    const result = await listFacetKeys({}, AUTH);
    expect(result.data).toEqual({ keys: [] });
    expect(mockFacetKeys).not.toHaveBeenCalled();
  });

  it('calls service with global=true for superadmin', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockFacetKeys.mockResolvedValue(['order_id', 'station']);
    const result = await listFacetKeys({}, AUTH);
    expect(result.data).toEqual({ keys: ['order_id', 'station'] });
    expect(mockFacetKeys).toHaveBeenCalledWith(expect.objectContaining({ global: true }));
  });
});

// ── getEscalationStats ────────────────────────────────────────────────────────

describe('getEscalationStats', () => {
  it('returns zero counts when user has no read_all roles', async () => {
    mockScope.mockResolvedValue(EMPTY);
    const result = await getEscalationStats({ period: '24h' }, AUTH);
    expect(result.data).toMatchObject({ pending: 0, claimed: 0, resolved: 0 });
    expect(mockStats).not.toHaveBeenCalled();
  });

  it('calls service for superadmin without role filter', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockStats.mockResolvedValue({ pending: 5, claimed: 2, created: 10, resolved: 8, by_role: [], by_type: [] });
    const result = await getEscalationStats({ period: '1h' }, AUTH);
    expect(result.status).toBe(200);
    expect(mockStats).toHaveBeenCalledWith(undefined, '1h');
  });

  it('passes scoped roles to service', async () => {
    mockScope.mockResolvedValue(SCOPED);
    mockStats.mockResolvedValue({ pending: 0, claimed: 0, created: 0, resolved: 0, by_role: [], by_type: [] });
    await getEscalationStats({ period: '7d' }, AUTH);
    expect(mockStats).toHaveBeenCalledWith(['reviewer', 'grinder'], '7d');
  });
});

// ── getStationMetrics ─────────────────────────────────────────────────────────

describe('getStationMetrics', () => {
  const stationRow = {
    role: 'reviewer', pending: 3, claimed: 1, resolved: 12, in_arrears: 0,
    throughput_pct: 96.5,
    wait: { p99: 0.5, p50: 0.3, avg: 0.4, max: 1.2 },
    work: { p99: 0.67, p50: 0.5, avg: 0.55, max: 0.9 },
  };

  it('returns empty stations when user has no read_all roles', async () => {
    mockScope.mockResolvedValue(EMPTY);
    const result = await getStationMetrics({ period: '24h' }, AUTH);
    expect(result.data).toEqual({ stations: [] });
    expect(mockStations).not.toHaveBeenCalled();
  });

  it('calls service with undefined roles for superadmin (all stations)', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockStations.mockResolvedValue([stationRow]);
    await getStationMetrics({ period: '24h' }, AUTH);
    expect(mockStations).toHaveBeenCalledWith(undefined, '24h');
  });

  it('passes scoped roles to service', async () => {
    mockScope.mockResolvedValue(SCOPED);
    mockStations.mockResolvedValue([stationRow]);
    await getStationMetrics({ period: '1h' }, AUTH);
    expect(mockStations).toHaveBeenCalledWith(['reviewer', 'grinder'], '1h');
  });

  it('includes throughput_pct in returned stations', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockStations.mockResolvedValue([stationRow]);
    const result = await getStationMetrics({ period: '15m' }, AUTH);
    expect((result.data as any).stations[0].throughput_pct).toBe(96.5);
  });

  it('returns 500 when service throws', async () => {
    mockScope.mockResolvedValue(GLOBAL);
    mockStations.mockRejectedValue(new Error('query failed'));
    const result = await getStationMetrics({ period: '24h' }, AUTH);
    expect(result).toEqual({ status: 500, error: 'query failed' });
  });
});
