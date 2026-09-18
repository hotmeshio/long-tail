import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';

const calls = vi.hoisted(() => ({
  available: [] as Record<string, unknown>[],
  list: [] as Record<string, unknown>[],
  listSchema: null as Record<string, unknown> | null,
  schemaFetched: true,
}));

vi.mock('../../api/escalations', () => ({
  useAvailableEscalations: (f: Record<string, unknown>) => {
    calls.available.push(f);
    return { data: f.enabled ? { escalations: [{ id: 'a' }], total: 7 } : undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
  },
  useEscalations: (f: Record<string, unknown>) => {
    calls.list.push(f);
    return { data: f.enabled ? { escalations: [{ id: 'l' }], total: 3 } : undefined, isLoading: false, isFetching: false, error: null, refetch: vi.fn() };
  },
}));
vi.mock('../../api/roles', () => ({
  useRoleListSchema: (role: string, _v: number | undefined, enabled: boolean) => ({
    data: enabled && role ? { list_schema: calls.listSchema } : undefined,
    isFetched: calls.schemaFetched,
  }),
}));

import { useEscalationListQuery } from '../useEscalationListQuery';
import type { EscalationListParams } from '../../lib/escalation-list-url';

const params = (over: Partial<EscalationListParams> = {}): EscalationListParams => ({
  statusFilter: 'available', role: 'fleet', facets: {}, view: null, layout: null, ...over,
});
const last = (arr: Record<string, unknown>[]) => arr[arr.length - 1];

beforeEach(() => {
  calls.available = [];
  calls.list = [];
  calls.listSchema = null;
  calls.schemaFetched = true;
});

describe('useEscalationListQuery', () => {
  it('routes the available pool and passes the shared filters', () => {
    const { result } = renderHook(() => useEscalationListQuery(
      params({ type: 'svc', priority: 2, search: 'q', facets: { facets: { region: 'nw' }, jeopardy: true } }),
      { limit: 25, offset: 50, staleTime: 15_000 },
    ));
    expect(last(calls.available)).toMatchObject({
      role: 'fleet', type: 'svc', priority: 2, search: 'q', limit: 25, offset: 50,
      facets: { region: 'nw' }, jeopardy: true, staleTime: 15_000, enabled: true,
    });
    expect(last(calls.list).enabled).toBe(false);
    expect(result.current.escalations).toEqual([{ id: 'a' }]);
    expect(result.current.total).toBe(7);
    expect(result.current.singleRole).toBe('fleet');
  });

  it('routes claimed and terminal statuses through the plain list', () => {
    renderHook(() => useEscalationListQuery(params({ statusFilter: 'claimed' }), { limit: 10, offset: 0 }));
    expect(last(calls.list)).toMatchObject({ status: 'pending', claimed: true, enabled: true });
    expect(last(calls.available).enabled).toBe(false);
    renderHook(() => useEscalationListQuery(params({ statusFilter: 'resolved' }), { limit: 10, offset: 0 }));
    expect(last(calls.list)).toMatchObject({ status: 'resolved', enabled: true });
    expect(last(calls.list).claimed).toBeUndefined();
  });

  it('waits for the single-role list schema before fetching rows, then asks for the envelope when the schema reads it', () => {
    calls.schemaFetched = false;
    renderHook(() => useEscalationListQuery(params(), { limit: 10, offset: 0 }));
    expect(last(calls.available).enabled).toBe(false);

    calls.schemaFetched = true;
    calls.listSchema = { 'x-lt-layout': 'facet-table', 'x-lt-columns': [{ label: 'Sku', value: '{{envelope.sku}}' }] };
    const { result } = renderHook(() => useEscalationListQuery(params(), { limit: 10, offset: 0 }));
    expect(last(calls.available)).toMatchObject({ enabled: true, include: 'envelope' });
    expect(result.current.hasRichView).toBe(true);
    expect(result.current.listSchema).toEqual(calls.listSchema);
  });

  it('a table list schema, or no scoped role, offers no rich view', () => {
    calls.listSchema = { 'x-lt-layout': 'table' };
    expect(renderHook(() => useEscalationListQuery(params(), { limit: 10, offset: 0 })).result.current.hasRichView).toBe(false);
    calls.listSchema = { 'x-lt-layout': 'facet-board' };
    const unscoped = renderHook(() => useEscalationListQuery(params({ role: undefined }), { limit: 10, offset: 0 }));
    expect(unscoped.result.current.singleRole).toBeNull();
    expect(unscoped.result.current.hasRichView).toBe(false);
    expect(last(calls.available).enabled).toBe(true);
  });

  it('enabled: false holds every query', () => {
    renderHook(() => useEscalationListQuery(params(), { limit: 10, offset: 0, enabled: false }));
    expect(last(calls.available).enabled).toBe(false);
    expect(last(calls.list).enabled).toBe(false);
  });
});
