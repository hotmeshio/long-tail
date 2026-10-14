import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const useRelatedAggregates = vi.fn();
const useRelatedRows = vi.fn();
const useRelatedSetEvents = vi.fn();
vi.mock('../../../../api/escalation-related', () => ({
  useRelatedAggregates: (...a: unknown[]) => useRelatedAggregates(...a),
  useRelatedRows: (...a: unknown[]) => useRelatedRows(...a),
}));
vi.mock('../../../../hooks/useEventHooks', () => ({ useRelatedSetEvents: (...a: unknown[]) => useRelatedSetEvents(...a) }));
vi.mock('../../../../api/escalations', () => ({ useClaimEscalation: () => ({ mutate: vi.fn(), isPending: false }) }));

const navigate = vi.fn();
vi.mock('react-router-dom', async (orig) => ({ ...(await orig<typeof import('react-router-dom')>()), useNavigate: () => navigate }));

import { FacetTable } from '../FacetTable';
import type { LTEscalationRecord } from '../../../../api/types';

const row = (id: string, metadata: Record<string, unknown>) => ({
  id, role: 'consolidate', status: 'pending', priority: 2, metadata, type: 'rollup', subtype: 'bin',
  envelope: '{}', escalation_payload: null, resolver_payload: null, assigned_to: null, assigned_until: null,
  created_at: '2026-10-13T12:00:00Z', updated_at: '2026-10-13T12:00:00Z',
}) as unknown as LTEscalationRecord;

const schema = {
  'x-lt-layout': 'facet-table',
  'x-lt-related': {
    contents: { source: 'items' },
    coming: { source: 'query', query: { roles: ['prep', 'check'], facets: { destination: '{{metadata.destination}}' } } },
  },
  'x-lt-columns': [
    { label: 'Bin', value: '{{metadata.binKey}}' },
    { label: 'Holds', related: 'contents', splitBy: 'reciprocal.metadata.serviceLevel', labels: { standard: 'Standard', express: 'Express' } },
    { label: 'Coming', related: 'coming', splitBy: 'role' },
  ],
  'x-lt-row-detail': [
    { related: 'contents', label: 'Holds', columns: [{ label: 'Item', value: '{{item.itemKey}}' }, { label: 'Service', value: '{{metadata.serviceLevel}}' }] },
  ],
};

const A = row('a', { binKey: 'A', destination: 'north' });
const B = row('b', { binKey: 'B', destination: 'south' });

beforeEach(() => {
  vi.clearAllMocks();
  useRelatedAggregates.mockReturnValue({
    isLoading: false,
    data: {
      version: 4,
      sets: {
        contents: { source: 'items', roles: ['stage'], aggregates: { 'reciprocal.metadata.serviceLevel': {
          a: { count: 3, splits: { standard: 2, express: 1 } },
          b: { count: 2, splits: {}, hidden: 2 },
        } } },
        coming: {
          source: 'query', roles: ['prep', 'check'], roleLabels: { prep: 'Prep', check: 'Check' }, restricted: [],
          aggregates: { role: { a: { count: 2, splits: { check: 1, prep: 1 } }, b: { count: 0, unresolved: true } } },
        },
      },
    },
  });
  useRelatedRows.mockReturnValue({
    isLoading: false,
    data: { source: 'items', total: 1, rows: [{ item: { itemKey: 'o-1', reciprocalId: 'r-1' }, escalation: { id: 'r-1', metadata: { serviceLevel: 'express' } } }] },
  });
});

const renderTable = (props: Record<string, unknown> = {}) =>
  render(<MemoryRouter><FacetTable schema={schema} rows={[A, B]} role="consolidate" version={4} {...props} /></MemoryRouter>);

describe('facet-table related columns', () => {
  it('reads the page once at the rendered version and subscribes to the related roles', () => {
    renderTable();
    expect(useRelatedAggregates).toHaveBeenCalledWith('consolidate', ['a', 'b'], 4);
    expect(useRelatedSetEvents).toHaveBeenLastCalledWith(['stage', 'prep', 'check']);
  });

  it('shows the count and labeled splits, role splits in sequence order', () => {
    renderTable();
    const cells = screen.getAllByTestId('related-cell');
    expect(cells[0].textContent).toBe('3Standard 2Express 1');
    expect(cells[1].textContent).toBe('2Prep 1Check 1');
  });

  it('marks a split the viewer cannot read and a host whose facets did not resolve', () => {
    renderTable();
    const rowB = screen.getAllByRole('row')[2];
    expect(within(rowB).getByTestId('related-restricted').textContent).toBe('split restricted');
    expect(within(rowB).getAllByText('—').length).toBeGreaterThan(0);
  });

  it('links a role chip to that role list with the host facets', () => {
    renderTable();
    const prep = screen.getAllByTestId('related-chip').find((c) => c.textContent === 'Prep 1')!;
    expect(prep.getAttribute('href')).toContain('role=prep');
    expect(decodeURIComponent(prep.getAttribute('href')!)).toContain('{"destination":"north"}');
  });
});

describe('facet-table row detail', () => {
  it('drops a detail column that only restates a facet the opened row carries', () => {
    useRelatedRows.mockReturnValue({
      isLoading: false,
      data: { source: 'items', total: 2, rows: [
        { item: { itemKey: 'o-1' }, escalation: { id: 'r-1', metadata: { serviceLevel: 'north' } } },
        { item: { itemKey: 'o-2' }, escalation: { id: 'r-2', metadata: { serviceLevel: 'north' } } },
      ] },
    });
    renderTable();
    fireEvent.click(screen.getAllByTestId('row-expand')[0]);
    const detail = screen.getByTestId('row-detail');
    expect(within(detail).queryByText('Service')).toBeNull();
    expect(within(detail).getByText('Item')).toBeTruthy();
  });

  it('keeps the identity column even when a host list names the only row', () => {
    useRelatedRows.mockReturnValue({
      isLoading: false,
      data: { source: 'items', total: 1, rows: [{ item: { itemKey: 'o-1' }, escalation: { id: 'r-1', metadata: { serviceLevel: 'express' } } }] },
    });
    render(<MemoryRouter><FacetTable schema={schema} rows={[{ ...A, metadata: { ...A.metadata, accumulate_keys: ['o-1'] } }]} role="consolidate" version={4} /></MemoryRouter>);
    fireEvent.click(screen.getAllByTestId('row-expand')[0]);
    const detail = screen.getByTestId('row-detail');
    expect(within(detail).getByText('Item')).toBeTruthy();
    expect(within(detail).getByText('o-1')).toBeTruthy();
    expect(within(detail).getByText('Service')).toBeTruthy();
  });

  it('expands a row into its detail sections, loaded on open, and opens a sub-row', () => {
    renderTable();
    expect(useRelatedRows).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByTestId('row-expand')[0]);
    expect(useRelatedRows).toHaveBeenCalledWith('consolidate', 'a', 'contents', 4, undefined);
    const detail = screen.getByTestId('row-detail');
    expect(detail.textContent).toContain('o-1');
    expect(detail.textContent).toContain('express');
    fireEvent.click(within(detail).getByText('o-1'));
    expect(navigate).toHaveBeenCalledWith('/escalations/detail/r-1');
  });
});

describe('facet-table groups', () => {
  const A2 = row('a2', { binKey: 'A', destination: 'north' });
  it('renders one line per group with merged related counts, expanding to members', () => {
    useRelatedAggregates.mockReturnValue({
      isLoading: false,
      data: { version: 4, sets: { contents: { source: 'items', aggregates: { 'reciprocal.metadata.serviceLevel': {
        a: { count: 2, splits: { standard: 2 } }, a2: { count: 1, splits: { express: 1 } },
      } } }, coming: { source: 'query', roles: [], aggregates: { role: {} } } } },
    });
    renderTable({ rows: [A, A2], groups: [{ key: 'A', ids: ['a', 'a2'] }] });
    expect(screen.getAllByRole('row')).toHaveLength(2);
    expect(screen.getByTestId('group-size').textContent).toBe('2');
    expect(screen.getAllByTestId('related-cell')[0].textContent).toBe('3Standard 2Express 1');
    fireEvent.click(screen.getByTestId('row-expand'));
    // Members join the same table as rows under their group: no repeated header.
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(4);
    expect(screen.getAllByRole('columnheader', { name: 'Bin' })).toHaveLength(1);
    // Members stand out on their own band, stepped in, with no rules.
    expect(rows[2].className).toContain('bg-surface-sunken');
    expect(rows[2].className).not.toContain('border-l');
    // A member shows only what differs from its group: the shared Bin is not repeated.
    expect(within(rows[1]).getByText('A')).toBeTruthy();
    expect(within(rows[2]).queryByText('A')).toBeNull();
    expect(screen.getAllByTestId('row-expand')).toHaveLength(3);
    // A member opens its own detail, indented past it.
    fireEvent.click(screen.getAllByTestId('row-expand')[1]);
    expect(screen.getByTestId('row-detail-block').className).toContain('pl-20');
  });

  it('counts a look-ahead once for members that share its facets', () => {
    useRelatedAggregates.mockReturnValue({
      isLoading: false,
      data: { version: 4, sets: {
        contents: { source: 'items', roles: ['stage'], aggregates: { 'reciprocal.metadata.serviceLevel': {} } },
        coming: { source: 'query', roles: ['prep'], roleLabels: { prep: 'Prep' }, restricted: [],
          aggregates: { role: { a: { count: 5, splits: { prep: 5 } }, a2: { count: 5, splits: { prep: 5 } } } } },
      } },
    });
    renderTable({ rows: [A, A2], groups: [{ key: 'A', ids: ['a', 'a2'] }] });
    expect(screen.getByTestId('related-cell').textContent).toBe('5Prep 5');
  });
});
