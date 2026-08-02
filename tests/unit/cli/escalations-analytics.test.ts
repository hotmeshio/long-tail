import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../lib/cli/client', () => ({ apiFetch: vi.fn() }));
vi.mock('../../../lib/cli/format', () => ({
  output: vi.fn(),
  formatTime: vi.fn((v: string) => v),
  formatStatus: vi.fn((v: string) => v),
}));

import { apiFetch } from '../../../lib/cli/client';
import { aggregateByFacets, timelineByFacet } from '../../../lib/cli/commands/escalations';

const fetchMock = vi.mocked(apiFetch);

function sentBody(): any {
  const [, init] = fetchMock.mock.calls[0];
  return JSON.parse((init as any).body);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockResolvedValue({ groups: [], intervals: [], overflow: false } as any);
});

describe('ltc esc aggregate-facets — flag → body mapping', () => {
  it('maps --entity and --group-state to the Q1 one-liner', async () => {
    await aggregateByFacets({
      entity: 'serialNumber',
      groupState: true,
      window: '{"from":"2026-08-01T00:00:00Z","to":"2026-08-01T12:00:00Z"}',
    });
    expect(fetchMock).toHaveBeenCalledWith('/escalations/aggregate-by-facets', expect.anything());
    expect(sentBody()).toEqual({
      query: { entity: 'serialNumber' },
      groupBy: { state: true },
      measure: { kind: 'dwell', window: { from: '2026-08-01T00:00:00Z', to: '2026-08-01T12:00:00Z' } },
    });
  });

  it('defaults to membership-now; --as-of anchors a past instant', async () => {
    await aggregateByFacets({ role: 'printer-fleet' });
    expect(sentBody().measure).toEqual({ kind: 'membership' });

    fetchMock.mockClear();
    fetchMock.mockResolvedValue({ groups: [], overflow: false } as any);
    await aggregateByFacets({ role: 'printer-fleet', asOf: '2026-08-01T09:00:00Z' });
    expect(sentBody().measure).toEqual({ kind: 'membership', asOf: '2026-08-01T09:00:00Z' });
  });

  it('splits comma lists and parses JSON options', async () => {
    await aggregateByFacets({
      roles: '["a","b"]',
      groupColumns: 'role, subtype',
      groupFacets: 'model,pdac',
      distinctBy: 'serialNumber',
      liveStatuses: 'pending,resolved',
      orderBy: '[{"field":"count","direction":"desc"}]',
      limit: '25',
      offset: '5',
    });
    expect(sentBody()).toEqual({
      query: { roles: ['a', 'b'] },
      groupBy: { columns: ['role', 'subtype'], facets: ['model', 'pdac'] },
      measure: { kind: 'membership' },
      distinctBy: 'serialNumber',
      liveStatuses: ['pending', 'resolved'],
      orderBy: [{ field: 'count', direction: 'desc' }],
      limit: 25,
      offset: 5,
    });
  });

  it('rejects malformed JSON options with a friendly error', async () => {
    await expect(aggregateByFacets({ roles: 'not-json' })).rejects.toThrow(/--roles/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('ltc esc timeline — flag → body mapping', () => {
  it('sends the positional facet and scopes via --entity over --roles', async () => {
    await timelineByFacet('serialNumber', 'SN-1', { entity: 'serialNumber', roles: '["ignored"]' });
    expect(fetchMock).toHaveBeenCalledWith('/escalations/timeline-by-facet', expect.anything());
    expect(sentBody()).toEqual({
      facet: { key: 'serialNumber', value: 'SN-1' },
      query: { entity: 'serialNumber' },
    });
  });

  it('maps window, select, and limit', async () => {
    await timelineByFacet('serialNumber', 'SN-1', {
      from: '2026-08-01T00:00:00Z',
      to: '2026-08-01T12:00:00Z',
      selectFacets: 'model, pdac',
      limit: '50',
    });
    expect(sentBody()).toEqual({
      facet: { key: 'serialNumber', value: 'SN-1' },
      window: { from: '2026-08-01T00:00:00Z', to: '2026-08-01T12:00:00Z' },
      select: { facets: ['model', 'pdac'] },
      limit: 50,
    });
  });
});
