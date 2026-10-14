import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const calls = vi.hoisted(() => ({
  available: [] as Record<string, unknown>[],
  listSchema: null as Record<string, unknown> | null,
}));

vi.mock('../../api/escalations', () => ({
  useAvailableEscalations: (f: Record<string, unknown>) => {
    calls.available.push(f);
    return {
      data: f.enabled ? { escalations: [{ id: 'a' }], total: 1, groups: [{ key: 'A', ids: ['a'] }] } : undefined,
      isLoading: false, isFetching: false, error: null, refetch: vi.fn(),
    };
  },
  useEscalations: () => ({ data: undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() }),
}));
vi.mock('../../api/roles', () => ({
  useRoleListSchema: () => ({ data: { list_schema: calls.listSchema, version: 6 }, isFetched: true }),
}));

import { useEscalationListQuery } from '../useEscalationListQuery';
import type { EscalationListParams } from '../../lib/escalation-list-url';

const params = (over: Partial<EscalationListParams> = {}): EscalationListParams => ({
  statusFilter: 'available', role: 'consolidate', facets: {}, view: null, layout: null, ...over,
});
const last = () => calls.available[calls.available.length - 1];
const grouped = {
  'x-lt-layout': 'facet-table',
  'x-lt-group-by': 'metadata.binKey',
  'x-lt-related': { contents: { source: 'items' } },
  'x-lt-columns': [
    { label: 'Bin', value: '{{metadata.binKey}}' },
    { label: 'Holds', related: 'contents', splitBy: 'payload.serviceLevel' },
  ],
};

beforeEach(() => {
  calls.available = [];
  calls.listSchema = null;
});

describe('useEscalationListQuery with a grouped facet-table', () => {
  it('pages by the schema group key and returns the groups and schema version', () => {
    calls.listSchema = grouped;
    const { result } = renderHook(() => useEscalationListQuery(params(), { limit: 25, offset: 0 }));
    expect(last()).toMatchObject({ groupBy: 'binKey' });
    expect(result.current.groups).toEqual([{ key: 'A', ids: ['a'] }]);
    expect(result.current.listSchemaVersion).toBe(6);
  });

  it('reads flat rows in the table and timeline views', () => {
    calls.listSchema = grouped;
    const { result } = renderHook(() => useEscalationListQuery(params({ view: 'table' }), { limit: 25, offset: 0 }));
    expect(last().groupBy).toBeUndefined();
    expect(result.current.groups).toBeNull();
  });

  it('asks for the envelope only for host-row templates, not related declarations', () => {
    calls.listSchema = grouped;
    renderHook(() => useEscalationListQuery(params(), { limit: 25, offset: 0 }));
    expect(last().include).toBeUndefined();
    calls.listSchema = { ...grouped, 'x-lt-columns': [{ label: 'Lane', value: '{{envelope.data.lane}}' }] };
    renderHook(() => useEscalationListQuery(params(), { limit: 25, offset: 0 }));
    expect(last().include).toBe('envelope');
  });

  it('ignores a schema whose related declaration does not validate', () => {
    calls.listSchema = { 'x-lt-layout': 'facet-table', 'x-lt-group-by': 'envelope.bin' };
    renderHook(() => useEscalationListQuery(params(), { limit: 25, offset: 0 }));
    expect(last().groupBy).toBeUndefined();
  });
});
